import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { PERMISSIONS } from "../security/permissions.js";
import { writeCriticalRequestAudit, writeRequestAudit } from "../services/auditLog.js";
import {
  integrationAdapterCatalog,
  normalizeIntegrationPayload,
  supportedIntegrationResourceTypes
} from "../services/integrationAdapters.js";
import { materializeCanonicalClaim } from "../services/integrationClaimMaterializer.js";
import { buildIntegrationClaimDraft } from "../services/integrationClaimDraft.js";
import { isSelfPayClaim } from "../services/claimPaymentMode.js";
import {
  epicConfig,
  epicConfigurationStatus,
  fetchEpicPatientSnapshot,
  requestEpicAccessToken
} from "../services/epicFhirConnector.js";
import {
  athenaHealthConfig,
  athenaHealthConfigurationStatus,
  fetchAthenaHealthPatientSnapshot,
  requestAthenaHealthAccessToken,
  searchAthenaHealthPatients,
  testAthenaHealthConnection
} from "../services/athenaHealthFhirConnector.js";
import {
  discoverOracleHealthBillableEncounters,
  fetchOracleHealthPatientSnapshot,
  oracleHealthConfig,
  oracleHealthConfigurationStatus,
  searchOracleHealthPatients,
  testOracleHealthConnection
} from "../services/oracleHealthFhirConnector.js";

const router = express.Router();
const kinds = ["EHR", "PMS", "CLEARINGHOUSE", "PAYER", "HIE", "DATA_WAREHOUSE", "OTHER"];
const environments = ["SANDBOX", "TEST", "PRODUCTION"];
const healthStates = ["ACTIVE", "DEGRADED", "ERROR", "DISABLED"];

const connectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(kinds),
  provider: z.string().trim().min(1).max(120),
  environment: z.enum(environments).default("SANDBOX")
}).strict();

const healthSchema = z.object({
  status: z.enum(healthStates),
  errorCode: z.string().trim().max(100).nullable().optional()
}).strict();

const linkSchema = z.object({
  claimId: z.string().trim().min(1).max(100),
  externalClaimId: z.string().trim().min(1).max(200),
  recordType: z.string().trim().min(1).max(50).default("CLAIM")
}).strict();

const eventSchema = z.object({
  externalEventId: z.string().trim().min(1).max(200),
  eventType: z.string().trim().min(1).max(100),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  status: z.enum(["RECEIVED", "PROCESSED", "DUPLICATE", "FAILED"]),
  claimId: z.string().trim().min(1).max(100).nullable().optional(),
  externalClaimId: z.string().trim().min(1).max(200).nullable().optional(),
  sourceStatus: z.string().trim().max(100).nullable().optional(),
  correlationId: z.string().trim().max(200).nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
  errorCode: z.string().trim().max(100).nullable().optional()
}).strict();


const ingestSchema = z.object({
  format: z.enum(["FHIR_R4", "HL7_V2", "CANONICAL_JSON"]),
  externalEventId: z.string().trim().min(1).max(200),
  payload: z.any(),
  sourceUpdatedAt: z.string().datetime({ offset: true }).nullable().optional(),
  materializeClaims: z.boolean().default(false)
}).strict();

const epicSyncSchema = z.object({
  patientId: z.string().trim().min(1).max(250).optional()
}).strict();

const athenaHealthSyncSchema = z.object({
  patientId: z.string().trim().min(1).max(250).optional()
}).strict();

const oracleHealthSyncSchema = z.object({
  patientId: z.string().trim().min(1).max(250).optional(),
  encounterId: z.string().trim().min(1).max(250).optional()
}).strict();

const patientSearchSchema = z.object({
  patientId: z.string().trim().max(250).optional(),
  identifier: z.string().trim().max(250).optional(),
  identifierSystem: z.string().trim().max(500).optional(),
  name: z.string().trim().max(200).optional(),
  family: z.string().trim().max(120).optional(),
  given: z.string().trim().max(120).optional(),
  birthdate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  birthdateFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  birthdateTo: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().email().max(254).optional(),
  postalCode: z.string().trim().max(30).optional(),
  gender: z.enum(["male", "female", "other", "unknown"]).optional(),
  exactName: z.boolean().optional(),
  count: z.number().int().min(1).max(50).optional()
}).strict();

const billableEncounterSchema = z.object({
  patientId: z.string().trim().min(1).max(250),
  count: z.number().int().min(1).max(50).optional()
}).strict();

const claimDraftSchema = z.object({
  patientId: z.string().trim().min(1).max(250),
  encounterId: z.string().trim().min(1).max(250).optional()
}).strict();

const orgId = (req) => req.user.organizationId;
function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ":" + stableJson(value[key])
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}

const hashEvent = (value) =>
  crypto.createHash("sha256").update(stableJson(value)).digest("hex");

function connectionFor(req, id) {
  return prisma.integrationConnection.findFirst({
    where: { id, organizationId: orgId(req) }
  });
}


function assertEpicConnection(connection) {
  const provider = String(connection?.provider || "").trim().toLowerCase();
  if (connection?.kind !== "EHR" || !provider.includes("epic")) {
    const error = new Error("This operation requires an Epic EHR connection");
    error.code = "EPIC_CONNECTION_REQUIRED";
    error.status = 409;
    throw error;
  }
}

function epicHttpStatus(error) {
  if (error?.code === "EPIC_CONFIGURATION_REQUIRED") return 409;
  if (error?.code === "EPIC_OAUTH_FAILED") return 502;
  if (error?.code === "EPIC_FHIR_REQUEST_FAILED") return 502;
  return Number.isInteger(error?.status) ? error.status : 500;
}

function assertOracleHealthConnection(connection) {
  const provider = String(connection?.provider || "").trim().toLowerCase();
  const oracleProvider = provider.includes("oracle") || provider.includes("cerner");
  if (connection?.kind !== "EHR" || !oracleProvider) {
    const error = new Error("This operation requires an Oracle Health/Cerner EHR connection");
    error.code = "ORACLE_HEALTH_CONNECTION_REQUIRED";
    error.status = 409;
    throw error;
  }
}

function assertAthenaHealthConnection(connection) {
  const provider = String(connection?.provider || "").trim().toLowerCase();
  const athenaProvider = provider.includes("athena");
  if (connection?.kind !== "EHR" || !athenaProvider) {
    const error = new Error("This operation requires an athenahealth EHR connection");
    error.code = "ATHENAHEALTH_CONNECTION_REQUIRED";
    error.status = 409;
    throw error;
  }
}

function athenaHealthHttpStatus(error) {
  if (error?.code === "ATHENAHEALTH_CONFIGURATION_REQUIRED") return 409;
  if (error?.code === "ATHENAHEALTH_OAUTH_FAILED") return 502;
  if (error?.code === "ATHENAHEALTH_FHIR_REQUEST_FAILED") return 502;
  if (error?.code === "ATHENAHEALTH_CAPABILITY_INVALID") return 502;
  return Number.isInteger(error?.status) ? error.status : 500;
}

function oracleHealthHttpStatus(error) {
  if (error?.code === "ORACLE_HEALTH_CONFIGURATION_REQUIRED") return 409;
  if (error?.code === "ORACLE_HEALTH_FHIR_REQUEST_FAILED") return 502;
  if (error?.code === "ORACLE_HEALTH_FHIR_TIMEOUT") return 504;
  if (error?.code === "ORACLE_HEALTH_FHIR_CANCELLED") return 499;
  if (error?.code === "ORACLE_HEALTH_CAPABILITY_INVALID") return 502;
  return Number.isInteger(error?.status) ? error.status : 500;
}

async function claimFor(req, id) {
  if (!id) return null;
  return prisma.claim.findFirst({
    where: { id, organizationId: orgId(req), deletedAt: null },
    select: { id: true }
  });
}


router.get("/adapters/catalog", requirePermission(PERMISSIONS.INTEGRATION_VIEW), (_req, res) => {
  res.json({
    adapters: integrationAdapterCatalog(),
    resourceTypes: supportedIntegrationResourceTypes()
  });
});


router.post("/:id/patients/search", requirePermission(PERMISSIONS.INTEGRATION_VIEW), async (req, res) => {
  const parsed = patientSearchSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid patient search criteria",
      code: "INVALID_PATIENT_SEARCH"
    });
  }

  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  if (connection.kind !== "EHR") {
    return res.status(409).json({
      error: "Patient search requires an EHR connection",
      code: "EHR_CONNECTION_REQUIRED"
    });
  }
  if (connection.status !== "ACTIVE") {
    return res.status(409).json({
      error: "Patient search requires an active EHR connection",
      code: "INTEGRATION_CONNECTION_NOT_ACTIVE"
    });
  }

  const provider = String(connection.provider || "").trim().toLowerCase();
  try {
    let result;
    if (provider.includes("oracle") || provider.includes("cerner")) {
      result = await searchOracleHealthPatients(
        oracleHealthConfig(connection.environment),
        parsed.data
      );
    } else if (provider.includes("athena")) {
      result = await searchAthenaHealthPatients(
        athenaHealthConfig(connection.environment),
        parsed.data
      );
    } else if (provider.includes("epic")) {
      return res.status(501).json({
        error: "Patient search is not yet enabled for Epic",
        code: "EPIC_PATIENT_SEARCH_NOT_IMPLEMENTED"
      });
    } else {
      return res.status(501).json({
        error: "Patient search is not implemented for this EHR provider",
        code: "EHR_PATIENT_SEARCH_NOT_IMPLEMENTED"
      });
    }

    await writeRequestAudit(prisma, req, {
      action: "EHR_PATIENT_SEARCHED",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: {
        provider: connection.provider,
        environment: connection.environment,
        resultCount: result.count,
        hasMore: result.hasMore
      }
    });

    return res.json({
      provider: connection.provider,
      environment: connection.environment,
      ...result
    });
  } catch (error) {
    console.error("[ehr-search] patient search failed", {
      connectionId: connection.id,
      provider: connection.provider,
      httpStatus: error.status || null,
      code: error.code || null
    });

    if (error.status === 422) {
      return res.status(422).json({
        error: "Too many patients matched. Add more search criteria and try again.",
        code: "PATIENT_SEARCH_TOO_BROAD"
      });
    }

    return res.status(Number.isInteger(error.status) ? error.status : 502).json({
      error: error.message || "Patient search failed",
      code: error.code || "EHR_PATIENT_SEARCH_FAILED"
    });
  }
});

router.post("/:id/patients/billable-encounters", requirePermission(PERMISSIONS.INTEGRATION_VIEW), async (req, res) => {
  const parsed = billableEncounterSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid billable encounter request", code: "INVALID_BILLABLE_ENCOUNTER_REQUEST" });
  }
  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  assertOracleHealthConnection(connection);
  if (connection.status !== "ACTIVE") {
    return res.status(409).json({ error: "Connection must be active", code: "INTEGRATION_CONNECTION_NOT_ACTIVE" });
  }
  try {
    const result = await discoverOracleHealthBillableEncounters(
      oracleHealthConfig(connection.environment),
      parsed.data.patientId,
      { count: parsed.data.count || 25 }
    );
    await writeRequestAudit(prisma, req, {
      action: "EHR_BILLABLE_ENCOUNTERS_DISCOVERED",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: {
        provider: connection.provider,
        environment: connection.environment,
        encounterCount: result.encounterCount,
        billableCount: result.billableCount
      }
    });
    return res.json(result);
  } catch (error) {
    return res.status(oracleHealthHttpStatus(error)).json({
      error: error.message || "Unable to discover billable encounters",
      code: error.code || "EHR_BILLABLE_ENCOUNTER_DISCOVERY_FAILED"
    });
  }
});

router.get("/:id/oracle-health/status", requirePermission(PERMISSIONS.INTEGRATION_VIEW), async (req, res) => {
  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  assertOracleHealthConnection(connection);
  res.json({
    connectionId: connection.id,
    provider: connection.provider,
    environment: connection.environment,
    config: oracleHealthConfigurationStatus(connection.environment)
  });
});

router.post("/:id/oracle-health/test", requirePermission(PERMISSIONS.INTEGRATION_MANAGE), async (req, res) => {
  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  assertOracleHealthConnection(connection);
  if (connection.status === "DISABLED") {
    return res.status(409).json({ error: "Integration connection is disabled", code: "INTEGRATION_CONNECTION_DISABLED" });
  }

  const config = oracleHealthConfig(connection.environment);
  console.info("[oracle-health] connection test started", {
    connectionId: connection.id,
    environment: connection.environment,
    fhirBaseUrl: config.fhirBaseUrl
  });
  try {
    const result = await testOracleHealthConnection(config);
    console.info("[oracle-health] connection test succeeded", {
      connectionId: connection.id,
      environment: connection.environment,
      fhirVersion: result.fhirVersion || null
    });
    const now = new Date();
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: { status: "ACTIVE", lastHealthyAt: now, lastErrorAt: null, lastErrorCode: null }
    });
    await writeRequestAudit(prisma, req, {
      action: "ORACLE_HEALTH_CONNECTION_TESTED",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: { provider: "Oracle Health", environment: connection.environment, success: true }
    });
    return res.json({ ...result, environment: connection.environment });
  } catch (error) {
    console.error("[oracle-health] connection test failed", {
      environment: connection.environment,
      httpStatus: error.status || null,
      code: error.code || null
    });
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: { status: "ERROR", lastErrorAt: new Date(), lastErrorCode: error.code || "ORACLE_HEALTH_CONNECTION_TEST_FAILED" }
    });
    return res.status(oracleHealthHttpStatus(error)).json({
      error: error.message,
      code: error.code || "ORACLE_HEALTH_CONNECTION_TEST_FAILED"
    });
  }
});

router.post("/:id/oracle-health/sync", requirePermission(PERMISSIONS.INTEGRATION_INGEST), async (req, res) => {
  const parsed = oracleHealthSyncSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Oracle Health sync request", code: "INVALID_ORACLE_HEALTH_SYNC_REQUEST" });
  }

  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  assertOracleHealthConnection(connection);
  if (connection.status === "DISABLED") {
    return res.status(409).json({ error: "Integration connection is disabled", code: "INTEGRATION_CONNECTION_DISABLED" });
  }

  const config = oracleHealthConfig(connection.environment);
  const patientId = parsed.data.patientId || config.testPatientId;
  if (!patientId) {
    return res.status(409).json({
      error: "Configure an Oracle Health synthetic test patient ID or provide patientId",
      code: "ORACLE_HEALTH_TEST_PATIENT_REQUIRED"
    });
  }

  console.info("[oracle-health] patient sync started", {
    connectionId: connection.id,
    environment: connection.environment,
    patientId
  });
  const requestController = new AbortController();
  const cancelRequest = () => requestController.abort();
  req.once("aborted", cancelRequest);
  res.once("close", () => {
    if (!res.writableEnded) cancelRequest();
  });

  let snapshot;
  try {
    snapshot = await fetchOracleHealthPatientSnapshot(config, patientId, {
      encounterId: parsed.data.encounterId || null,
      signal: requestController.signal
    });
    console.info("[oracle-health] patient sync FHIR calls completed", {
      connectionId: connection.id,
      patientId,
      calls: snapshot.calls
    });
  } catch (error) {
    if (error?.code === "ORACLE_HEALTH_FHIR_CANCELLED" && requestController.signal.aborted) {
      console.info("[oracle-health] patient sync cancelled", {
        connectionId: connection.id,
        patientId
      });
      return;
    }
    console.error("[oracle-health] patient sync failed", {
      connectionId: connection.id,
      patientId,
      httpStatus: error.status || null,
      code: error.code || null,
      message: error.message
    });
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: { status: "ERROR", lastErrorAt: new Date(), lastErrorCode: error.code || "ORACLE_HEALTH_SYNC_FAILED" }
    });
    return res.status(oracleHealthHttpStatus(error)).json({
      error: error.message,
      code: error.code || "ORACLE_HEALTH_SYNC_FAILED"
    });
  }

  const normalized = [];
  for (const payload of snapshot.resources) {
    normalized.push(...normalizeIntegrationPayload("FHIR_R4", payload));
  }

  const now = new Date();
  const externalEventId = "oracle-health-sync-" + crypto.randomUUID();
  const records = await prisma.$transaction(async (tx) => {
    const saved = [];
    for (const item of normalized) {
      const dataHash = hashEvent(item.data);
      const existing = await tx.integrationRecord.findUnique({
        where: {
          connectionId_resourceType_externalId: {
            connectionId: connection.id,
            resourceType: item.resourceType,
            externalId: item.externalId
          }
        }
      });
      const record = await tx.integrationRecord.upsert({
        where: {
          connectionId_resourceType_externalId: {
            connectionId: connection.id,
            resourceType: item.resourceType,
            externalId: item.externalId
          }
        },
        create: {
          organizationId: orgId(req),
          connectionId: connection.id,
          resourceType: item.resourceType,
          externalId: item.externalId,
          sourceFormat: "FHIR_R4",
          sourceType: item.sourceType || null,
          dataHash,
          data: item.data,
          provenance: {
            sourceFormat: "FHIR_R4",
            sourceType: item.sourceType || null,
            vendor: "Oracle Health",
            environment: connection.environment,
            externalEventId
          }
        },
        update: {
          sourceFormat: "FHIR_R4",
          sourceType: item.sourceType || null,
          dataHash,
          data: item.data,
          lastSeenAt: now,
          provenance: {
            sourceFormat: "FHIR_R4",
            sourceType: item.sourceType || null,
            vendor: "Oracle Health",
            environment: connection.environment,
            externalEventId
          }
        }
      });
      saved.push({
        id: record.id,
        resourceType: record.resourceType,
        externalId: record.externalId,
        changed: existing ? existing.dataHash !== dataHash : true
      });
    }

    await tx.integrationEvent.create({
      data: {
        organizationId: orgId(req),
        connectionId: connection.id,
        externalEventId,
        eventType: "ORACLE_HEALTH_FHIR_PATIENT_SYNC",
        direction: "INBOUND",
        status: "PROCESSED",
        sourceStatus: connection.environment,
        correlationId: req.auditRequestId || null,
        payloadHash: hashEvent(normalized),
        occurredAt: now,
        processedAt: now,
        metadata: {
          vendor: "Oracle Health",
          patientId,
          resourceCount: saved.length,
          resourceTypes: [...new Set(saved.map((item) => item.resourceType))],
          apiCallCount: snapshot.calls.length,
          skippedCallCount: snapshot.calls.filter((item) => item.status === "SKIPPED").length
        }
      }
    });

    await tx.integrationConnection.update({
      where: { id: connection.id },
      data: { status: "ACTIVE", lastHealthyAt: now, lastErrorAt: null, lastErrorCode: null }
    });

    await writeCriticalRequestAudit(tx, req, {
      action: "ORACLE_HEALTH_SYNTHETIC_PATIENT_SYNCED",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: {
        provider: "Oracle Health",
        environment: connection.environment,
        patientId,
        resourceCount: saved.length,
        resourceTypes: [...new Set(saved.map((item) => item.resourceType))],
        skippedCallCount: snapshot.calls.filter((item) => item.status === "SKIPPED").length
      }
    });

    return saved;
  });

  console.info("[oracle-health] patient sync succeeded", {
    connectionId: connection.id,
    patientId,
    recordCount: records.length,
    calls: snapshot.calls
  });

  return res.json({
    ok: true,
    environment: connection.environment,
    patientId,
    records,
    calls: snapshot.calls
  });
});

async function integrationClaimDraft(req, connection, patientId, encounterId = null) {
  const records = await prisma.integrationRecord.findMany({
    where: {
      organizationId: orgId(req),
      connectionId: connection.id
    },
    select: {
      id: true,
      claimId: true,
      resourceType: true,
      externalId: true,
      sourceFormat: true,
      sourceType: true,
      data: true,
      lastSeenAt: true
    },
    orderBy: { lastSeenAt: "desc" },
    take: 2000
  });
  return buildIntegrationClaimDraft(records, { patientId, encounterId });
}

router.get("/:id/claim-draft/preview", requirePermission(PERMISSIONS.INTEGRATION_VIEW), async (req, res) => {
  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });

  const patientId = String(req.query.patientId || "").trim();
  const encounterId = String(req.query.encounterId || "").trim() || null;
  if (!patientId) {
    return res.status(400).json({
      error: "patientId is required",
      code: "INTEGRATION_CLAIM_PATIENT_REQUIRED"
    });
  }

  const preview = await integrationClaimDraft(req, connection, patientId, encounterId);
  return res.json(preview);
});

router.post("/:id/patient-balance", requirePermission(PERMISSIONS.INTEGRATION_INGEST), async (req, res) => {
  const parsed = claimDraftSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid patient balance request",
      code: "INVALID_INTEGRATION_PATIENT_BALANCE_REQUEST"
    });
  }

  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  if (connection.status === "DISABLED") {
    return res.status(409).json({ error: "Integration connection is disabled", code: "INTEGRATION_CONNECTION_DISABLED" });
  }

  const preview = await integrationClaimDraft(
    req,
    connection,
    parsed.data.patientId,
    parsed.data.encounterId || null
  );

  if (!preview.ready) {
    return res.status(409).json({
      error: preview.message,
      code: "INTEGRATION_PATIENT_BALANCE_NOT_READY",
      missing: preview.missing,
      preview
    });
  }
  if (!isSelfPayClaim(preview.claimData)) {
    return res.status(409).json({
      error: "This encounter is not self-pay and should continue through the insurance claim workflow",
      code: "INSURANCE_CLAIM_WORKFLOW_REQUIRED"
    });
  }

  const totalCharges = Number(preview.claimData.totalBilledAmount || preview.claimData.amount || 0);
  const externalKey = [
    "ehr",
    connection.id,
    preview.patientId,
    "encounter",
    preview.encounterId || "unknown"
  ].join(":");

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.patientBalance.findUnique({
      where: {
        organizationId_externalKey: {
          organizationId: orgId(req),
          externalKey
        }
      }
    });
    const paidAmount = Number(existing?.paidAmount || 0);
    const remaining = Math.max(0, totalCharges - paidAmount);
    const status = remaining <= 0.005 ? "PAID" : paidAmount > 0 ? "PARTIALLY_PAID" : "UNPAID";

    const balance = await tx.patientBalance.upsert({
      where: {
        organizationId_externalKey: {
          organizationId: orgId(req),
          externalKey
        }
      },
      create: {
        organizationId: orgId(req),
        createdById: req.user.id,
        sourceType: "EHR",
        sourceConnectionId: connection.id,
        externalKey,
        externalPatientId: preview.patientId,
        externalEncounterId: preview.encounterId,
        patientName: preview.claimData.patientName,
        medicalRecordNumber: preview.claimData.medicalRecordNumber || null,
        serviceDate: preview.claimData.dateOfService ? new Date(preview.claimData.dateOfService) : null,
        totalCharges,
        insuranceResponsibility: 0,
        patientResponsibility: totalCharges,
        paidAmount: 0,
        balanceAmount: totalCharges,
        status,
        chargeDetails: preview.serviceLines
      },
      update: {
        patientName: preview.claimData.patientName,
        medicalRecordNumber: preview.claimData.medicalRecordNumber || null,
        serviceDate: preview.claimData.dateOfService ? new Date(preview.claimData.dateOfService) : null,
        totalCharges,
        insuranceResponsibility: 0,
        patientResponsibility: totalCharges,
        balanceAmount: remaining,
        status,
        chargeDetails: preview.serviceLines
      }
    });

    await writeCriticalRequestAudit(tx, req, {
      action: existing ? "PATIENT_BALANCE_REFRESHED_FROM_EHR" : "PATIENT_BALANCE_CREATED_FROM_EHR",
      entityType: "PatientBalance",
      entityId: balance.id,
      metadata: {
        provider: connection.provider,
        environment: connection.environment,
        sourceType: "EHR",
        status
      }
    });

    return { balance, created: !existing };
  });

  return res.status(result.created ? 201 : 200).json({
    ok: true,
    created: result.created,
    patientBalanceId: result.balance.id,
    status: result.balance.status,
    patientResponsibility: Number(result.balance.patientResponsibility),
    balanceAmount: Number(result.balance.balanceAmount)
  });
});

router.post("/:id/claim-draft", requirePermission(PERMISSIONS.INTEGRATION_INGEST), async (req, res) => {
  const parsed = claimDraftSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid claim draft request",
      code: "INVALID_INTEGRATION_CLAIM_DRAFT_REQUEST"
    });
  }

  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  if (connection.status === "DISABLED") {
    return res.status(409).json({
      error: "Integration connection is disabled",
      code: "INTEGRATION_CONNECTION_DISABLED"
    });
  }

  const preview = await integrationClaimDraft(
    req,
    connection,
    parsed.data.patientId,
    parsed.data.encounterId || null
  );

  if (!preview.ready) {
    return res.status(409).json({
      error: preview.message,
      code: "INTEGRATION_CLAIM_NOT_READY",
      missing: preview.missing,
      preview
    });
  }

  if (isSelfPayClaim(preview.claimData)) {
    return res.status(409).json({
      error: "Self-pay encounters must be handled in Patient Payments rather than the insurance claim workflow",
      code: "SELF_PAY_PATIENT_BALANCE_REQUIRED",
      patientId: preview.patientId,
      encounterId: preview.encounterId
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const materialized = await materializeCanonicalClaim(tx, {
      organizationId: orgId(req),
      connectionId: connection.id,
      externalClaimId: preview.externalClaimId,
      data: preview.claimData,
      actorUserId: req.user.id
    });

    if (!materialized.materialized) {
      const error = new Error(materialized.reason || "Claim could not be materialized");
      error.code = "INTEGRATION_CLAIM_NOT_READY";
      error.status = 409;
      throw error;
    }

    const claimId = materialized.claim.id;

    await tx.serviceLine.deleteMany({
      where: { claimId, source: "INTEGRATION" }
    });

    if (preview.serviceLines.length) {
      await tx.serviceLine.createMany({
        data: preview.serviceLines.map((line) => ({
          claimId,
          cptHcpcsCode: line.cptHcpcsCode,
          modifiers: line.modifiers || [],
          units: line.units,
          charge: line.charge,
          diagnosisPointers: [],
          placeOfService: null,
          serviceDateFrom: line.serviceDateFrom ? new Date(line.serviceDateFrom) : null,
          serviceDateTo: line.serviceDateTo ? new Date(line.serviceDateTo) : null,
          revenueCode: line.revenueCode || null,
          poaIndicator: null,
          verified: false,
          source: "INTEGRATION"
        }))
      });
    }

    await tx.integrationRecord.updateMany({
      where: {
        organizationId: orgId(req),
        connectionId: connection.id,
        id: { in: preview.recordIds }
      },
      data: { claimId }
    });

    const externalEventId = "integration-claim-draft-" + crypto.randomUUID();
    await tx.integrationEvent.create({
      data: {
        organizationId: orgId(req),
        connectionId: connection.id,
        claimId,
        externalEventId,
        eventType: "INTEGRATION_CLAIM_DRAFT_CREATED",
        direction: "INBOUND",
        status: "PROCESSED",
        sourceStatus: connection.environment,
        correlationId: req.auditRequestId || null,
        payloadHash: hashEvent({
          patientId: preview.patientId,
          encounterId: preview.encounterId,
          externalClaimId: preview.externalClaimId
        }),
        occurredAt: new Date(),
        processedAt: new Date(),
        metadata: {
          provider: connection.provider,
          patientId: preview.patientId,
          encounterId: preview.encounterId,
          chargeCount: preview.serviceLines.length,
          totalBilledAmount: preview.claimData.totalBilledAmount,
          created: Boolean(materialized.created)
        }
      }
    });

    await writeCriticalRequestAudit(tx, req, {
      claimId,
      action: "INTEGRATION_DRAFT_CLAIM_MATERIALIZED",
      entityType: "Claim",
      entityId: claimId,
      metadata: {
        provider: connection.provider,
        connectionId: connection.id,
        patientId: preview.patientId,
        encounterId: preview.encounterId,
        sourceRecordCount: preview.recordIds.length,
        serviceLineCount: preview.serviceLines.length,
        created: Boolean(materialized.created)
      }
    });

    return {
      claimId,
      created: Boolean(materialized.created),
      status: materialized.claim.status,
      linkedRecordCount: preview.recordIds.length,
      serviceLineCount: preview.serviceLines.length
    };
  });

  console.info("[integration-claim] draft materialized", {
    connectionId: connection.id,
    provider: connection.provider,
    patientId: preview.patientId,
    encounterId: preview.encounterId,
    claimId: result.claimId,
    created: result.created
  });

  return res.status(result.created ? 201 : 200).json({
    ok: true,
    ...result,
    preview
  });
});

router.get("/:id/epic/status", requirePermission(PERMISSIONS.INTEGRATION_VIEW), async (req, res) => {
  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  assertEpicConnection(connection);

  res.json({
    connectionId: connection.id,
    provider: connection.provider,
    environment: connection.environment,
    oauthMode: "SMART_BACKEND_SERVICES_PRIVATE_KEY_JWT",
    config: epicConfigurationStatus(connection.environment)
  });
});

router.post("/:id/epic/test", requirePermission(PERMISSIONS.INTEGRATION_MANAGE), async (req, res) => {
  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  assertEpicConnection(connection);
  if (connection.status === "DISABLED") {
    return res.status(409).json({
      error: "Integration connection is disabled",
      code: "INTEGRATION_CONNECTION_DISABLED"
    });
  }

  const config = epicConfig(connection.environment);
  try {
    const token = await requestEpicAccessToken(config);
    const now = new Date();
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        status: "ACTIVE",
        lastHealthyAt: now,
        lastErrorAt: null,
        lastErrorCode: null
      }
    });
    await writeRequestAudit(prisma, req, {
      action: "EPIC_CONNECTION_TESTED",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: {
        provider: "Epic",
        environment: connection.environment,
        success: true,
        tokenScopePresent: Boolean(token.scope)
      }
    });
    return res.json({
      ok: true,
      environment: connection.environment,
      expiresIn: token.expiresIn,
      scope: token.scope
    });
  } catch (error) {
    console.error("[epic-oauth] connection test failed", {
      environment: connection.environment,
      httpStatus: error.status || null,
      code: error.code || null,
      epicError: error.epicError || null,
      epicErrorDescription: error.epicErrorDescription || null
    });
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        status: "ERROR",
        lastErrorAt: new Date(),
        lastErrorCode: error.code || "EPIC_CONNECTION_TEST_FAILED"
      }
    });
    await writeRequestAudit(prisma, req, {
      action: "EPIC_CONNECTION_TESTED",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      outcome: "FAILURE",
      metadata: {
        provider: "Epic",
        environment: connection.environment,
        success: false,
        errorCode: error.code || "EPIC_CONNECTION_TEST_FAILED"
      }
    });
    return res.status(epicHttpStatus(error)).json({
      error: error.message,
      code: error.code || "EPIC_CONNECTION_TEST_FAILED"
    });
  }
});

router.post("/:id/epic/sync", requirePermission(PERMISSIONS.INTEGRATION_INGEST), async (req, res) => {
  const parsed = epicSyncSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid Epic sync request",
      code: "INVALID_EPIC_SYNC_REQUEST"
    });
  }

  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  assertEpicConnection(connection);
  if (connection.status === "DISABLED") {
    return res.status(409).json({
      error: "Integration connection is disabled",
      code: "INTEGRATION_CONNECTION_DISABLED"
    });
  }

  const config = epicConfig(connection.environment);
  const patientId = parsed.data.patientId || config.testPatientId;
  if (!patientId) {
    return res.status(409).json({
      error: "Configure an Epic synthetic test patient ID or provide patientId",
      code: "EPIC_TEST_PATIENT_REQUIRED"
    });
  }

  let snapshot;
  try {
    snapshot = await fetchEpicPatientSnapshot(config, patientId);
  } catch (error) {
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        status: "ERROR",
        lastErrorAt: new Date(),
        lastErrorCode: error.code || "EPIC_SYNC_FAILED"
      }
    });
    return res.status(epicHttpStatus(error)).json({
      error: error.message,
      code: error.code || "EPIC_SYNC_FAILED"
    });
  }

  const normalized = [];
  for (const payload of snapshot.resources) {
    normalized.push(...normalizeIntegrationPayload("FHIR_R4", payload));
  }

  const now = new Date();
  const externalEventId = "epic-sync-" + crypto.randomUUID();
  const records = await prisma.$transaction(async (tx) => {
    const saved = [];
    for (const item of normalized) {
      const dataHash = hashEvent(item.data);
      const existing = await tx.integrationRecord.findUnique({
        where: {
          connectionId_resourceType_externalId: {
            connectionId: connection.id,
            resourceType: item.resourceType,
            externalId: item.externalId
          }
        }
      });
      const record = await tx.integrationRecord.upsert({
        where: {
          connectionId_resourceType_externalId: {
            connectionId: connection.id,
            resourceType: item.resourceType,
            externalId: item.externalId
          }
        },
        create: {
          organizationId: orgId(req),
          connectionId: connection.id,
          resourceType: item.resourceType,
          externalId: item.externalId,
          sourceFormat: "FHIR_R4",
          sourceType: item.sourceType || null,
          dataHash,
          data: item.data,
          provenance: {
            sourceFormat: "FHIR_R4",
            sourceType: item.sourceType || null,
            vendor: "Epic",
            environment: connection.environment,
            externalEventId
          }
        },
        update: {
          sourceFormat: "FHIR_R4",
          sourceType: item.sourceType || null,
          dataHash,
          data: item.data,
          lastSeenAt: now,
          provenance: {
            sourceFormat: "FHIR_R4",
            sourceType: item.sourceType || null,
            vendor: "Epic",
            environment: connection.environment,
            externalEventId
          }
        }
      });
      saved.push({
        id: record.id,
        resourceType: record.resourceType,
        changed: existing ? existing.dataHash !== dataHash : true
      });
    }

    await tx.integrationEvent.create({
      data: {
        organizationId: orgId(req),
        connectionId: connection.id,
        externalEventId,
        eventType: "EPIC_FHIR_PATIENT_SYNC",
        direction: "INBOUND",
        status: "PROCESSED",
        sourceStatus: connection.environment,
        correlationId: req.auditRequestId || null,
        payloadHash: hashEvent(normalized),
        occurredAt: now,
        processedAt: now,
        metadata: {
          vendor: "Epic",
          resourceCount: saved.length,
          resourceTypes: [...new Set(saved.map((item) => item.resourceType))],
          apiCallCount: snapshot.calls.length,
          skippedCallCount: snapshot.calls.filter((item) => item.status === "SKIPPED").length
        }
      }
    });

    await tx.integrationConnection.update({
      where: { id: connection.id },
      data: {
        status: "ACTIVE",
        lastHealthyAt: now,
        lastErrorAt: null,
        lastErrorCode: null
      }
    });

    await writeCriticalRequestAudit(tx, req, {
      action: "EPIC_SYNTHETIC_PATIENT_SYNCED",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: {
        provider: "Epic",
        environment: connection.environment,
        resourceCount: saved.length,
        resourceTypes: [...new Set(saved.map((item) => item.resourceType))],
        skippedCallCount: snapshot.calls.filter((item) => item.status === "SKIPPED").length
      }
    });

    return saved;
  });

  res.json({
    ok: true,
    environment: connection.environment,
    records,
    calls: snapshot.calls
  });
});


router.get("/:id/athenahealth/status", requirePermission(PERMISSIONS.INTEGRATION_VIEW), async (req, res) => {
  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  assertAthenaHealthConnection(connection);

  res.json({
    connectionId: connection.id,
    provider: connection.provider,
    environment: connection.environment,
    oauthMode: "CLIENT_CREDENTIALS",
    config: athenaHealthConfigurationStatus(connection.environment)
  });
});

router.post("/:id/athenahealth/test", requirePermission(PERMISSIONS.INTEGRATION_MANAGE), async (req, res) => {
  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  assertAthenaHealthConnection(connection);
  if (connection.status === "DISABLED") {
    return res.status(409).json({
      error: "Integration connection is disabled",
      code: "INTEGRATION_CONNECTION_DISABLED"
    });
  }

  const config = athenaHealthConfig(connection.environment);
  try {
    const result = await testAthenaHealthConnection(config);
    const now = new Date();
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        status: "ACTIVE",
        lastHealthyAt: now,
        lastErrorAt: null,
        lastErrorCode: null
      }
    });
    await writeRequestAudit(prisma, req, {
      action: "ATHENAHEALTH_CONNECTION_TESTED",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: {
        provider: "athenahealth",
        environment: connection.environment,
        success: true,
        fhirVersion: result.fhirVersion || null
      }
    });
    return res.json({
      ...result,
      environment: connection.environment,
      config: athenaHealthConfigurationStatus(connection.environment)
    });
  } catch (error) {
    console.error("[athenahealth] connection test failed", {
      environment: connection.environment,
      httpStatus: error.status || null,
      code: error.code || null,
      athenaError: error.athenaError || null
    });
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        status: "ERROR",
        lastErrorAt: new Date(),
        lastErrorCode: error.code || "ATHENAHEALTH_CONNECTION_TEST_FAILED"
      }
    });
    await writeRequestAudit(prisma, req, {
      action: "ATHENAHEALTH_CONNECTION_TESTED",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      outcome: "FAILURE",
      metadata: {
        provider: "athenahealth",
        environment: connection.environment,
        success: false,
        errorCode: error.code || "ATHENAHEALTH_CONNECTION_TEST_FAILED"
      }
    });
    return res.status(athenaHealthHttpStatus(error)).json({
      error: error.message,
      code: error.code || "ATHENAHEALTH_CONNECTION_TEST_FAILED"
    });
  }
});

router.post("/:id/athenahealth/sync", requirePermission(PERMISSIONS.INTEGRATION_INGEST), async (req, res) => {
  const parsed = athenaHealthSyncSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid athenahealth sync request",
      code: "INVALID_ATHENAHEALTH_SYNC_REQUEST"
    });
  }

  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  assertAthenaHealthConnection(connection);
  if (connection.status === "DISABLED") {
    return res.status(409).json({
      error: "Integration connection is disabled",
      code: "INTEGRATION_CONNECTION_DISABLED"
    });
  }

  const config = athenaHealthConfig(connection.environment);
  const patientId = parsed.data.patientId || config.testPatientId;
  if (!patientId) {
    return res.status(409).json({
      error: "Configure an athenahealth preview test patient ID or provide patientId",
      code: "ATHENAHEALTH_TEST_PATIENT_REQUIRED"
    });
  }

  let snapshot;
  try {
    snapshot = await fetchAthenaHealthPatientSnapshot(config, patientId);
  } catch (error) {
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        status: "ERROR",
        lastErrorAt: new Date(),
        lastErrorCode: error.code || "ATHENAHEALTH_SYNC_FAILED"
      }
    });
    return res.status(athenaHealthHttpStatus(error)).json({
      error: error.message,
      code: error.code || "ATHENAHEALTH_SYNC_FAILED"
    });
  }

  const normalized = [];
  for (const payload of snapshot.resources) {
    normalized.push(...normalizeIntegrationPayload("FHIR_R4", payload));
  }

  const now = new Date();
  const externalEventId = "athenahealth-sync-" + crypto.randomUUID();
  const records = await prisma.$transaction(async (tx) => {
    const saved = [];
    for (const item of normalized) {
      const dataHash = hashEvent(item.data);
      const existing = await tx.integrationRecord.findUnique({
        where: {
          connectionId_resourceType_externalId: {
            connectionId: connection.id,
            resourceType: item.resourceType,
            externalId: item.externalId
          }
        }
      });
      const record = await tx.integrationRecord.upsert({
        where: {
          connectionId_resourceType_externalId: {
            connectionId: connection.id,
            resourceType: item.resourceType,
            externalId: item.externalId
          }
        },
        create: {
          organizationId: orgId(req),
          connectionId: connection.id,
          resourceType: item.resourceType,
          externalId: item.externalId,
          sourceFormat: "FHIR_R4",
          sourceType: item.sourceType || null,
          dataHash,
          data: item.data,
          provenance: {
            sourceFormat: "FHIR_R4",
            sourceType: item.sourceType || null,
            vendor: "athenahealth",
            environment: connection.environment,
            externalEventId
          }
        },
        update: {
          sourceFormat: "FHIR_R4",
          sourceType: item.sourceType || null,
          dataHash,
          data: item.data,
          lastSeenAt: now,
          provenance: {
            sourceFormat: "FHIR_R4",
            sourceType: item.sourceType || null,
            vendor: "athenahealth",
            environment: connection.environment,
            externalEventId
          }
        }
      });
      saved.push({
        id: record.id,
        resourceType: record.resourceType,
        changed: existing ? existing.dataHash !== dataHash : true
      });
    }

    await tx.integrationEvent.create({
      data: {
        organizationId: orgId(req),
        connectionId: connection.id,
        externalEventId,
        eventType: "ATHENAHEALTH_FHIR_PATIENT_SYNC",
        direction: "INBOUND",
        status: "PROCESSED",
        sourceStatus: connection.environment,
        correlationId: req.auditRequestId || null,
        payloadHash: hashEvent(normalized),
        occurredAt: now,
        processedAt: now,
        metadata: {
          vendor: "athenahealth",
          resourceCount: saved.length,
          resourceTypes: [...new Set(saved.map((item) => item.resourceType))],
          apiCallCount: snapshot.calls.length,
          skippedCallCount: snapshot.calls.filter((item) => item.status === "SKIPPED").length
        }
      }
    });

    await tx.integrationConnection.update({
      where: { id: connection.id },
      data: {
        status: "ACTIVE",
        lastHealthyAt: now,
        lastErrorAt: null,
        lastErrorCode: null
      }
    });

    await writeCriticalRequestAudit(tx, req, {
      action: "ATHENAHEALTH_PATIENT_SYNCED",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: {
        provider: "athenahealth",
        environment: connection.environment,
        resourceCount: saved.length,
        resourceTypes: [...new Set(saved.map((item) => item.resourceType))],
        skippedCallCount: snapshot.calls.filter((item) => item.status === "SKIPPED").length
      }
    });

    return saved;
  });

  res.json({
    ok: true,
    environment: connection.environment,
    records,
    calls: snapshot.calls,
    billingApiEnabled: false,
    billingApiNote:
      "athenahealth FHIR patient data is synced. Claims, patient balances, statements, and payment APIs require separate athenaOne preview billing API mapping."
  });
});

router.post("/:id/ingest", requirePermission(PERMISSIONS.INTEGRATION_INGEST), async (req, res) => {
  const parsed = ingestSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid integration ingestion request",
      code: "INVALID_INTEGRATION_INGESTION"
    });
  }

  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  if (connection.status === "DISABLED") {
    return res.status(409).json({
      error: "Integration connection is disabled",
      code: "INTEGRATION_CONNECTION_DISABLED"
    });
  }

  const existingEvent = await prisma.integrationEvent.findUnique({
    where: {
      connectionId_externalEventId: {
        connectionId: connection.id,
        externalEventId: parsed.data.externalEventId
      }
    }
  });
  if (existingEvent) {
    return res.json({
      duplicate: true,
      eventId: existingEvent.id,
      status: existingEvent.status
    });
  }

  let normalized;
  try {
    normalized = normalizeIntegrationPayload(parsed.data.format, parsed.data.payload);
  } catch (error) {
    if (
      String(error?.code || "").startsWith("INTEGRATION_") ||
      error?.code === "INVALID_HL7_MESSAGE" ||
      error?.code === "INVALID_INTEGRATION_PAYLOAD"
    ) {
      return res.status(400).json({
        error: error.message,
        code: error.code || "INVALID_INTEGRATION_PAYLOAD"
      });
    }
    throw error;
  }

  if (normalized.length > 500) {
    return res.status(413).json({
      error: "Integration ingestion supports at most 500 canonical records per request",
      code: "INTEGRATION_BATCH_TOO_LARGE"
    });
  }

  const now = new Date();
  const sourceUpdatedAt = parsed.data.sourceUpdatedAt
    ? new Date(parsed.data.sourceUpdatedAt)
    : null;

  const result = await prisma.$transaction(async (tx) => {
    const records = [];
    const materializedClaims = [];

    for (const item of normalized) {
      const dataHash = hashEvent(item.data);
      let claimId = null;

      if (item.resourceType === "CLAIM" && parsed.data.materializeClaims) {
        const materialized = await materializeCanonicalClaim(tx, {
          organizationId: orgId(req),
          connectionId: connection.id,
          externalClaimId: item.externalId,
          data: item.data,
          actorUserId: req.user.id
        });
        if (materialized.materialized) {
          claimId = materialized.claim.id;
          materializedClaims.push({
            claimId,
            externalId: item.externalId,
            created: materialized.created
          });
        }
      } else if (item.resourceType === "CLAIM") {
        const identity = await tx.claimExternalIdentity.findUnique({
          where: {
            connectionId_externalClaimId: {
              connectionId: connection.id,
              externalClaimId: item.externalId
            }
          }
        });
        claimId = identity?.claimId || null;
      }

      const existing = await tx.integrationRecord.findUnique({
        where: {
          connectionId_resourceType_externalId: {
            connectionId: connection.id,
            resourceType: item.resourceType,
            externalId: item.externalId
          }
        }
      });

      const record = await tx.integrationRecord.upsert({
        where: {
          connectionId_resourceType_externalId: {
            connectionId: connection.id,
            resourceType: item.resourceType,
            externalId: item.externalId
          }
        },
        create: {
          organizationId: orgId(req),
          connectionId: connection.id,
          claimId,
          resourceType: item.resourceType,
          externalId: item.externalId,
          sourceFormat: parsed.data.format,
          sourceType: item.sourceType || null,
          dataHash,
          data: item.data,
          sourceUpdatedAt,
          provenance: {
            sourceFormat: parsed.data.format,
            sourceType: item.sourceType || null,
            externalEventId: parsed.data.externalEventId
          }
        },
        update: {
          claimId: claimId || existing?.claimId || null,
          sourceFormat: parsed.data.format,
          sourceType: item.sourceType || null,
          dataHash,
          data: item.data,
          lastSeenAt: now,
          sourceUpdatedAt,
          provenance: {
            sourceFormat: parsed.data.format,
            sourceType: item.sourceType || null,
            externalEventId: parsed.data.externalEventId
          }
        }
      });

      records.push({
        id: record.id,
        resourceType: record.resourceType,
        externalId: record.externalId,
        claimId: record.claimId,
        changed: existing ? existing.dataHash !== dataHash : true
      });
    }

    const event = await tx.integrationEvent.create({
      data: {
        organizationId: orgId(req),
        connectionId: connection.id,
        claimId: materializedClaims.length === 1 ? materializedClaims[0].claimId : null,
        externalEventId: parsed.data.externalEventId,
        eventType: "CANONICAL_INGESTION",
        direction: "INBOUND",
        status: "PROCESSED",
        sourceStatus: parsed.data.format,
        correlationId: req.auditRequestId || null,
        payloadHash: hashEvent(normalized),
        occurredAt: sourceUpdatedAt,
        processedAt: now,
        metadata: {
          format: parsed.data.format,
          recordCount: records.length,
          resourceTypes: [...new Set(records.map((item) => item.resourceType))],
          materializedClaimCount: materializedClaims.length
        }
      }
    });

    await writeCriticalRequestAudit(tx, req, {
      claimId: materializedClaims.length === 1 ? materializedClaims[0].claimId : null,
      action: "INTEGRATION_BATCH_INGESTED",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: {
        integrationKind: connection.kind,
        provider: connection.provider,
        format: parsed.data.format,
        recordCount: records.length,
        resourceTypes: [...new Set(records.map((item) => item.resourceType))],
        materializedClaimCount: materializedClaims.length
      }
    });

    return { event, records, materializedClaims };
  });

  res.status(201).json({
    duplicate: false,
    eventId: result.event.id,
    records: result.records,
    materializedClaims: result.materializedClaims
  });
});

router.get("/:id/records", requirePermission(PERMISSIONS.INTEGRATION_VIEW), async (req, res) => {
  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });

  const requestedType = String(req.query.resourceType || "").trim().toUpperCase();
  const allowedTypes = new Set(supportedIntegrationResourceTypes());
  if (requestedType && !allowedTypes.has(requestedType)) {
    return res.status(400).json({
      error: "Unsupported integration resource type",
      code: "INTEGRATION_RESOURCE_TYPE_UNSUPPORTED"
    });
  }

  const requestedLimit = Number(req.query.limit || 50);
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 50, 200));
  const items = await prisma.integrationRecord.findMany({
    where: {
      organizationId: orgId(req),
      connectionId: connection.id,
      ...(requestedType ? { resourceType: requestedType } : {})
    },
    select: {
      id: true,
      claimId: true,
      resourceType: true,
      externalId: true,
      sourceFormat: true,
      sourceType: true,
      dataHash: true,
      firstSeenAt: true,
      lastSeenAt: true,
      sourceUpdatedAt: true
    },
    orderBy: { lastSeenAt: "desc" },
    take: limit
  });

  res.json({ items, limit });
});

router.get("/", requirePermission(PERMISSIONS.INTEGRATION_VIEW), async (req, res) => {
  const items = await prisma.integrationConnection.findMany({
    where: { organizationId: orgId(req) },
    select: {
      id: true, name: true, kind: true, provider: true, environment: true,
      status: true, lastHealthyAt: true, lastErrorAt: true, lastErrorCode: true,
      createdAt: true, updatedAt: true,
      _count: { select: { externalIdentities: true, events: true, records: true } }
    },
    orderBy: [{ kind: "asc" }, { name: "asc" }]
  });
  await writeRequestAudit(prisma, req, {
    action: "INTEGRATION_CONNECTIONS_VIEWED",
    entityType: "IntegrationConnection",
    metadata: { count: items.length }
  });
  res.json({ items });
});

router.post("/", requirePermission(PERMISSIONS.INTEGRATION_MANAGE), async (req, res) => {
  const parsed = connectionSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid integration connection", code: "INVALID_INTEGRATION_CONNECTION" });
  }

  const connection = await prisma.$transaction(async (tx) => {
    const created = await tx.integrationConnection.create({
      data: { organizationId: orgId(req), ...parsed.data, status: "ACTIVE" }
    });
    await writeCriticalRequestAudit(tx, req, {
      action: "INTEGRATION_CONNECTION_CREATED",
      entityType: "IntegrationConnection",
      entityId: created.id,
      metadata: {
        integrationKind: created.kind,
        provider: created.provider,
        environment: created.environment,
        status: created.status
      }
    });
    return created;
  });

  res.status(201).json(connection);
});

router.patch("/:id/health", requirePermission(PERMISSIONS.INTEGRATION_MANAGE), async (req, res) => {
  const parsed = healthSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid integration health update", code: "INVALID_INTEGRATION_HEALTH" });
  }

  const existing = await connectionFor(req, req.params.id);
  if (!existing) return res.status(404).json({ error: "Integration connection not found" });
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.integrationConnection.update({
      where: { id: existing.id },
      data: {
        status: parsed.data.status,
        lastHealthyAt: parsed.data.status === "ACTIVE" ? now : existing.lastHealthyAt,
        lastErrorAt: ["ERROR", "DEGRADED"].includes(parsed.data.status) ? now : null,
        lastErrorCode: ["ERROR", "DEGRADED"].includes(parsed.data.status)
          ? parsed.data.errorCode || "UNSPECIFIED"
          : null
      }
    });
    await writeCriticalRequestAudit(tx, req, {
      action: "INTEGRATION_HEALTH_UPDATED",
      entityType: "IntegrationConnection",
      entityId: next.id,
      metadata: { status: next.status, errorCode: next.lastErrorCode || null }
    });
    return next;
  });

  res.json(updated);
});

router.post("/:id/claim-links", requirePermission(PERMISSIONS.INTEGRATION_MANAGE), async (req, res) => {
  const parsed = linkSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid external claim link", code: "INVALID_EXTERNAL_CLAIM_LINK" });
  }
  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  const claim = await claimFor(req, parsed.data.claimId);
  if (!claim) return res.status(404).json({ error: "Claim not found" });

  const existing = await prisma.claimExternalIdentity.findUnique({
    where: {
      connectionId_externalClaimId: {
        connectionId: connection.id,
        externalClaimId: parsed.data.externalClaimId
      }
    }
  });
  if (existing && existing.claimId !== claim.id) {
    return res.status(409).json({
      error: "External claim ID is already linked to another claim",
      code: "EXTERNAL_CLAIM_ID_CONFLICT"
    });
  }

  const link = existing || await prisma.claimExternalIdentity.create({
    data: {
      organizationId: orgId(req),
      connectionId: connection.id,
      claimId: claim.id,
      externalClaimId: parsed.data.externalClaimId,
      recordType: parsed.data.recordType
    }
  });

  await writeCriticalRequestAudit(prisma, req, {
    claimId: claim.id,
    action: "EXTERNAL_CLAIM_LINKED",
    entityType: "ClaimExternalIdentity",
    entityId: link.id,
    metadata: { integrationKind: connection.kind, provider: connection.provider, externalLinked: true }
  });

  res.status(existing ? 200 : 201).json(link);
});

router.post("/:id/events", requirePermission(PERMISSIONS.INTEGRATION_MANAGE), async (req, res) => {
  const parsed = eventSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid integration event",
      message: "Only operational correlation metadata is accepted; raw clinical or claim payloads are not accepted by this endpoint.",
      code: "INVALID_INTEGRATION_EVENT"
    });
  }

  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  if (connection.status === "DISABLED") {
    return res.status(409).json({ error: "Integration connection is disabled", code: "INTEGRATION_CONNECTION_DISABLED" });
  }

  const duplicate = await prisma.integrationEvent.findUnique({
    where: {
      connectionId_externalEventId: {
        connectionId: connection.id,
        externalEventId: parsed.data.externalEventId
      }
    }
  });
  if (duplicate) return res.json({ duplicate: true, event: duplicate });

  let claimId = parsed.data.claimId || null;
  if (parsed.data.externalClaimId) {
    const identity = await prisma.claimExternalIdentity.findUnique({
      where: {
        connectionId_externalClaimId: {
          connectionId: connection.id,
          externalClaimId: parsed.data.externalClaimId
        }
      }
    });
    if (identity) {
      if (claimId && identity.claimId !== claimId) {
        return res.status(409).json({
          error: "Event claim does not match the registered external claim identity",
          code: "INTEGRATION_CLAIM_CORRELATION_CONFLICT"
        });
      }
      claimId = identity.claimId;
    }
  }

  if (claimId) {
    const claim = await claimFor(req, claimId);
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    if (parsed.data.externalClaimId) {
      await prisma.claimExternalIdentity.upsert({
        where: {
          connectionId_externalClaimId: {
            connectionId: connection.id,
            externalClaimId: parsed.data.externalClaimId
          }
        },
        create: {
          organizationId: orgId(req),
          connectionId: connection.id,
          claimId,
          externalClaimId: parsed.data.externalClaimId,
          recordType: "CLAIM"
        },
        update: {}
      });
    }
  }

  const normalized = {
    externalEventId: parsed.data.externalEventId,
    eventType: parsed.data.eventType,
    direction: parsed.data.direction,
    status: parsed.data.status,
    claimId,
    externalClaimId: parsed.data.externalClaimId || null,
    sourceStatus: parsed.data.sourceStatus || null,
    correlationId: parsed.data.correlationId || null,
    occurredAt: parsed.data.occurredAt || null,
    errorCode: parsed.data.errorCode || null
  };

  const event = await prisma.integrationEvent.create({
    data: {
      organizationId: orgId(req),
      connectionId: connection.id,
      claimId,
      externalEventId: parsed.data.externalEventId,
      eventType: parsed.data.eventType,
      direction: parsed.data.direction,
      status: parsed.data.status,
      sourceStatus: parsed.data.sourceStatus || null,
      correlationId: parsed.data.correlationId || null,
      payloadHash: hashEvent(normalized),
      occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : null,
      processedAt: parsed.data.status === "PROCESSED" ? new Date() : null,
      errorCode: parsed.data.errorCode || null,
      metadata: {
        hasExternalClaimId: Boolean(parsed.data.externalClaimId),
        correlatedToClaim: Boolean(claimId)
      }
    }
  });

  await writeRequestAudit(prisma, req, {
    claimId,
    action: "INTEGRATION_EVENT_RECORDED",
    entityType: "IntegrationEvent",
    entityId: event.id,
    metadata: {
      integrationKind: connection.kind,
      provider: connection.provider,
      eventType: event.eventType,
      direction: event.direction,
      status: event.status,
      correlatedToClaim: Boolean(claimId),
      duplicate: false
    }
  });

  res.status(201).json({
    duplicate: false,
    event: {
      id: event.id,
      connectionId: event.connectionId,
      claimId: event.claimId,
      externalEventId: event.externalEventId,
      eventType: event.eventType,
      direction: event.direction,
      status: event.status,
      sourceStatus: event.sourceStatus,
      correlationId: event.correlationId,
      payloadHash: event.payloadHash,
      occurredAt: event.occurredAt,
      processedAt: event.processedAt,
      errorCode: event.errorCode,
      createdAt: event.createdAt
    }
  });
});

router.get("/:id/events", requirePermission(PERMISSIONS.INTEGRATION_VIEW), async (req, res) => {
  const connection = await connectionFor(req, req.params.id);
  if (!connection) return res.status(404).json({ error: "Integration connection not found" });
  const requestedLimit = Number(req.query.limit || 50);
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 50, 200));

  const items = await prisma.integrationEvent.findMany({
    where: { organizationId: orgId(req), connectionId: connection.id },
    select: {
      id: true, claimId: true, externalEventId: true, eventType: true,
      direction: true, status: true, sourceStatus: true, correlationId: true,
      payloadHash: true, occurredAt: true, processedAt: true, errorCode: true, createdAt: true
    },
    orderBy: { createdAt: "desc" },
    take: limit
  });
  res.json({ items, limit });
});

export default router;
