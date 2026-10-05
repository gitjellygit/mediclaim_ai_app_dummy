import { validMoney } from "../utils/money.js";
import { z } from "zod";
import { claimUpdateSchema, emptyMutationSchema, parseMutation, serviceLineInputSchema } from "../validation/claimMutations.js";
import { assertClaimTransition } from "../services/workflowStateMachine.js";
import { parseClaimDate } from "../utils/claimDate.js";
import { serveStoredDocument } from "../services/documentResponse.js";
import { deleteStoredDocument } from "../services/documentDeletion.js";
import express from "express";
import { requireRoles } from "../middleware/auth.js";
import { prisma } from "../db.js";
import claimPayerSimulationRouter from "./claimPayerSimulation.js";
import claimJourneyRouter from "./claimJourney.js";
import { removeManuallyEditedFields } from "../services/claimDocumentProvenance.js";
import {
  buildAutomationSummary,
  changedFields,
  manualProvenance,
  mergeProvenance
} from "../services/claimFieldProvenance.js";
import {
  compareReadinessChecks,
  markReadinessChecksStale
} from "../services/readinessHistory.js";
import {
  buildClaimCompleteness,
  completenessReadinessIssues
} from "../services/claimCompleteness.js";
import { analyzeMedicalConsistency } from "../services/medicalConsistency.js";
import { configuredReadinessIssue } from "../services/configuredReadinessRules.js";
import { evaluateUsReadinessRules, usReadinessRuleCodes } from "../services/usReadinessRules.js";
import { buildClaimPatch, changedPatchFields, serviceLinesDiffer } from "../services/claimPatch.js";
import { assertClaimEditable, isClaimLocked } from "../services/claimLock.js";
import { deletePurgedClaimFiles, resolveClaimDocumentFiles } from "../services/claimPurge.js";

const router = express.Router();

function orgId(req) {
  return req.user.organizationId;
}

function normalizeServiceLines(lines = []) {
  const parsed = z.array(serviceLineInputSchema).max(500).safeParse(lines);
  if (!parsed.success) {
    return { ok: false, response: { error: "Invalid service line input", code: "INVALID_SERVICE_LINE" } };
  }

  const normalized = [];
  for (const line of parsed.data) {
    const charge =
      line.charge == null || line.charge === ""
        ? null
        : validMoney(line.charge);
    if (line.charge != null && line.charge !== "" && charge == null) {
      return {
        ok: false,
        response: {
          error: "Invalid service line charge",
          message: "Service line charge must have at most two decimal places",
          code: "INVALID_SERVICE_LINE_CHARGE"
        }
      };
    }

    const units =
      line.units == null || line.units === ""
        ? null
        : Number(line.units);
    if (units != null && (!Number.isFinite(units) || units <= 0)) {
      return {
        ok: false,
        response: {
          error: "Invalid service line units",
          message: "Service line units must be greater than 0",
          code: "INVALID_SERVICE_LINE_UNITS"
        }
      };
    }

    const serviceDateFrom = line.serviceDateFrom ? parseClaimDate(line.serviceDateFrom) : null;
    const serviceDateTo = line.serviceDateTo ? parseClaimDate(line.serviceDateTo) : null;
    if ((line.serviceDateFrom && !serviceDateFrom) || (line.serviceDateTo && !serviceDateTo)) {
      return {
        ok: false,
        response: {
          error: "Invalid service line date",
          code: "INVALID_SERVICE_LINE_DATE"
        }
      };
    }

    normalized.push({
      cptHcpcsCode: line.cptHcpcsCode.toUpperCase(),
      modifiers: line.modifiers || [],
      units,
      charge,
      diagnosisPointers: line.diagnosisPointers || [],
      placeOfService: line.placeOfService || null,
      serviceDateFrom,
      serviceDateTo,
      revenueCode: line.revenueCode || null,
      poaIndicator: line.poaIndicator || null,
      verified: true,
      source: "USER",
      sourceDocumentId: null
    });
  }

  return { ok: true, data: normalized };
}

async function auditClaim(req, { claimId, action, outcome = "SUCCESS", metadata = {} }) {
  try {
    await prisma.auditEvent.create({
      data: {
        organizationId: orgId(req),
        claimId,
        actorUserId: req.user?.id || null,
        action,
        entityType: "Claim",
        entityId: claimId,
        outcome,
        metadata
      }
    });
  } catch (error) {
    console.error("[audit] claim event write failed", {
      claimId,
      action,
      name: error?.name || "Error",
      code: error?.code || null
    });
  }
}


router.get("/", async (req, res) => {
  try {
    const claims = await prisma.claim.findMany({
      where: {
        organizationId: orgId(req),
        deletedAt: null
      },
      include: {
        documents: {
          orderBy: { createdAt: "desc" }
        },
        serviceLines: {
          orderBy: { createdAt: "asc" }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    res.json(claims);
  } catch (error) {
    console.error("Error fetching claims:", error);
    res.status(500).json({ error: "Unable to load claims", code: "CLAIM_LIST_FAILED" });
  }
});

/**
 * Claim Journey endpoints
 *
 * Eligibility and prior-auth actions are deterministic local pre-checks / recorded
 * workflow decisions. They do not claim to be live payer responses. A payer/clearinghouse
 * connector can replace these calls later without changing the UI workflow.
 */
/**
 * Server-side claim search for production-scale selectors.
 * Empty query returns recent claims; non-empty query searches common operational identifiers.
 * Results are intentionally capped so the browser never needs to load the full claim table.
 */
router.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const requestedLimit = Number(req.query.limit || 20);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 20, 50));

    const where = q
      ? {
          organizationId: orgId(req),
          deletedAt: null,
          OR: [
            { id: { equals: q } },
            { patientName: { contains: q, mode: "insensitive" } },
            { payerName: { contains: q, mode: "insensitive" } },
            { policyNo: { contains: q, mode: "insensitive" } },
            { memberId: { contains: q, mode: "insensitive" } },
            { medicalRecordNumber: { contains: q, mode: "insensitive" } },
            { payerReferenceNo: { contains: q, mode: "insensitive" } },
            { groupNumber: { contains: q, mode: "insensitive" } },
            { subscriberId: { contains: q, mode: "insensitive" } },
            { payerEdiId: { contains: q, mode: "insensitive" } },
            { insurerClaimNo: { contains: q, mode: "insensitive" } },
            { authorizationNo: { contains: q, mode: "insensitive" } }
          ]
        }
      : { organizationId: orgId(req), deletedAt: null };

    const claims = await prisma.claim.findMany({
      where,
      select: {
        id: true,
        patientName: true,
        payerName: true,
        policyNo: true,
        memberId: true,
        medicalRecordNumber: true,
        payerReferenceNo: true,
        groupNumber: true,
        subscriberId: true,
        payerEdiId: true,
        insurerClaimNo: true,
        authorizationNo: true,
        status: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    res.json({
      items: claims,
      query: q,
      limit,
      recent: !q
    });
  } catch (error) {
    console.error("[claim-search] failed", {
      message: error.message
    });
    res.status(500).json({
      error: "Unable to search claims"
    });
  }
});

router.use(claimPayerSimulationRouter);
router.use(claimJourneyRouter);

router.get("/medical-consistency/summary", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const requestedLimit = Number(req.query.limit || 50);
    const limit = Math.max(
      1,
      Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 50, 100)
    );

    const where = q
      ? {
          organizationId: orgId(req),
          deletedAt: null,
          OR: [
            { id: { equals: q } },
            { patientName: { contains: q, mode: "insensitive" } },
            { payerName: { contains: q, mode: "insensitive" } },
            { policyNo: { contains: q, mode: "insensitive" } },
            { memberId: { contains: q, mode: "insensitive" } }
          ]
        }
      : { organizationId: orgId(req), deletedAt: null };

    const claims = await prisma.claim.findMany({
      where,
      include: {
        documents: {
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    const items = claims.map((claim) => ({
      claim: {
        id: claim.id,
        patientName: claim.patientName,
        payerName: claim.payerName,
        policyNo: claim.policyNo,
        status: claim.status,
        diagnosisText: claim.diagnosisText,
        icd10Codes: claim.icd10Codes,
        admissionDate: claim.admissionDate,
        dischargeDate: claim.dischargeDate,
        dateOfService: claim.dateOfService,
        roomCategory: claim.roomCategory,
        icuDays: claim.icuDays
      },
      analysis: analyzeMedicalConsistency(claim)
    }));

    const metrics = {
      total: items.length,
      consistent: items.filter((item) => item.analysis.status === "CONSISTENT").length,
      needsReview: items.filter((item) => item.analysis.status === "NEEDS_REVIEW").length,
      blocked: items.filter((item) => item.analysis.status === "BLOCKED").length,
      averageScore:
        items.length > 0
          ? Math.round(
              items.reduce((sum, item) => sum + item.analysis.score, 0) /
                items.length
            )
          : 0
    };

    res.json({ items, metrics, query: q, limit });
  } catch (error) {
    console.error("[medical-consistency] summary failed", {
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({
      error: "Unable to load medical consistency analysis"
    });
  }
});

router.get("/:id/medical-consistency", async (req, res) => {
  try {
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: {
        documents: {
          orderBy: { createdAt: "desc" }
        }
      }
    });

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    res.json({
      claim,
      analysis: analyzeMedicalConsistency(claim)
    });
  } catch (error) {
    console.error("[medical-consistency] claim analysis failed", {
      claimId: req.params.id,
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({
      error: "Unable to analyze medical consistency"
    });
  }
});

router.get("/:id/audit", async (req, res) => {
  const claim = await prisma.claim.findFirst({
    where: {
      id: req.params.id,
      organizationId: orgId(req),
      deletedAt: null
    },
    select: { id: true }
  });

  if (!claim) {
    return res.status(404).json({ error: "Claim not found" });
  }

  const events = await prisma.auditEvent.findMany({
    where: {
      organizationId: orgId(req),
      claimId: claim.id
    },
    select: {
      id: true,
      createdAt: true,
      actorUserId: true,
      action: true,
      entityType: true,
      entityId: true,
      outcome: true,
      metadata: true
    },
    orderBy: { createdAt: "desc" },
    take: 250
  });

  res.json({ items: events });
});

router.get("/:id", async (req, res) => {
  const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
    include: {
      documents: true,
      serviceLines: { orderBy: { createdAt: "asc" } },
      checks: { orderBy: { createdAt: "desc" } }
    }
  });

  if (!claim) {
    return res.status(404).json({ error: "Claim not found" });
  }

  const checks = (claim.checks || []).map((check, index, all) => ({
    ...check,
    comparison: compareReadinessChecks(check, all[index + 1] || null)
  }));

  res.json({
    ...claim,
    checks,
    automationSummary: buildAutomationSummary(claim),
    completenessSummary: buildClaimCompleteness(claim)
  });
});

router.post("/", async (req, res) => {
  try {
    if (!req.body.patientName || !req.body.payerName) {
      return res.status(400).json({
        error: "patientName and payerName are required"
      });
    }

    const amount = Number(req.body.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: "amount must be a valid number greater than 0"
      });
    }

    // Explicit input allowlist: never accept caller-supplied lifecycle, payer,
    // monetary-adjudication, provenance, relationship IDs or audit fields.
    const claimCreateSchema = z.object({
      patientName: z.string().trim().min(1).max(250),
      payerName: z.string().trim().min(1).max(250),
      amount: z.coerce.number().positive().finite(),
      totalBilledAmount: z.coerce.number().positive().finite().nullish(),
      policyNo: z.string().trim().max(100).nullish(),
      memberId: z.string().trim().max(100).nullish(),
      medicalRecordNumber: z.string().trim().max(100).nullish(),
      planAdministratorName: z.string().trim().max(250).nullish(),
      groupNumber: z.string().trim().max(100).nullish(),
      subscriberId: z.string().trim().max(100).nullish(),
      subscriberName: z.string().trim().max(250).nullish(),
      subscriberRelationship: z.enum(["SELF", "SPOUSE", "CHILD", "OTHER"]).nullish(),
      coordinationOfBenefits: z.enum(["PRIMARY", "SECONDARY", "TERTIARY"]).nullish(),
      payerEdiId: z.string().trim().max(100).nullish(),
      coverageLimit: z.coerce.number().nonnegative().finite().nullish(),
      remainingCoverageLimit: z.coerce.number().nonnegative().finite().nullish(),
      payerReferenceNo: z.string().trim().max(100).nullish(),
      patientDob: z.string().nullish(),
      hospitalName: z.string().trim().max(250).nullish(),
      doctorName: z.string().trim().max(250).nullish(),
      billingProviderNpi: z.string().trim().max(10).nullish(),
      renderingProviderNpi: z.string().trim().max(10).nullish(),
      referringProviderNpi: z.string().trim().max(10).nullish(),
      providerTin: z.string().trim().max(20).nullish(),
      providerTaxonomyCode: z.string().trim().max(20).nullish(),
      diagnosisText: z.string().max(6000).nullish(),
      icd10Codes: z.array(z.string().max(20)).max(100).optional(),
      inpatientProcedureCodes: z.array(z.string().max(20)).max(100).optional(),
      procedureText: z.string().max(6000).nullish(),
      dateOfService: z.string().nullish(),
      admissionDate: z.string().nullish(),
      dischargeDate: z.string().nullish(),
      procedureDate: z.string().nullish(),
      admissionType: z.enum(["PLANNED", "EMERGENCY"]).nullish(),
      roomCategory: z.enum(["GENERAL", "SEMI_PRIVATE", "PRIVATE", "ICU"]).nullish(),
      icuDays: z.coerce.number().int().nonnegative().nullish(),
      typeOfBill: z.string().trim().max(10).nullish(),
      drgCode: z.string().trim().max(10).nullish(),
      claimFrequencyCode: z.enum(["ORIGINAL", "CORRECTED", "VOID"]).optional(),
      timelyFilingDeadline: z.string().nullish(),
      serviceLines: z.array(serviceLineInputSchema).max(500).optional(),
      claimType: z.enum(["PROVIDER_BILLED", "MEMBER_REIMBURSEMENT"]).optional(),
      claimForm: z.enum(["PROFESSIONAL", "INSTITUTIONAL"]).nullish()
    }).strict();
    const parsed = claimCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid claim input",
        message: "Only supported claim-creation fields are accepted",
        code: "INVALID_CLAIM_INPUT"
      });
    }
    const { serviceLines: rawServiceLines = [], ...claimInput } = parsed.data;
    const normalizedServiceLines = normalizeServiceLines(rawServiceLines);
    if (!normalizedServiceLines.ok) {
      return res.status(400).json(normalizedServiceLines.response);
    }

    const createPayload = {
      ...claimInput,
      status: "DRAFT"
    };
    for (const key of ["amount", "totalBilledAmount", "coverageLimit", "remainingCoverageLimit"]) {
      if (createPayload[key] == null) continue;
      const canonical = validMoney(createPayload[key]);
      if (canonical == null) {
        return res.status(400).json({
          error: "Invalid money",
          message: `${key} must have at most two decimal places`,
          code: "INVALID_MONEY"
        });
      }
      createPayload[key] = canonical;
    }
    for (const field of ["patientDob", "dateOfService", "admissionDate", "dischargeDate", "procedureDate", "timelyFilingDeadline"]) {
      if (!createPayload[field]) continue;
      const parsedDate = parseClaimDate(createPayload[field]);
      if (!parsedDate) {
        return res.status(400).json({
          error: "Invalid date",
          message: `Invalid value for ${field}`,
          code: "INVALID_DATE"
        });
      }
      createPayload[field] = parsedDate;
    }

    const manuallyEnteredFields = Object.keys(createPayload).filter(
      (field) => !["status", "createdAt", "id"].includes(field)
    );

    const claim = await prisma.claim.create({
      data: {
        ...createPayload,
        organizationId: orgId(req),
        createdById: req.user.id,
        fieldProvenance: manualProvenance(
          manuallyEnteredFields,
          "Entered at Claim Creation"
        ),
        serviceLines: normalizedServiceLines.data.length
          ? { create: normalizedServiceLines.data }
          : undefined
      }
    });

    await auditClaim(req, {
      claimId: claim.id,
      action: "CLAIM_CREATED",
      metadata: { status: claim.status }
    });

    const createdClaim = await prisma.claim.findUnique({
      where: { id: claim.id },
      include: { serviceLines: { orderBy: { createdAt: "asc" } } }
    });

    res.json(createdClaim);
  } catch (e) {
    console.error("[claim-create] failed", { name: e.name, code: e.code || null });
    res.status(500).json({ error: "Unable to create claim", code: "CLAIM_CREATE_FAILED" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const parsedInput = parseMutation(claimUpdateSchema, req.body);
    if (!parsedInput.ok) {
      return res.status(400).json(parsedInput.response);
    }
    const input = parsedInput.data;

    const existing = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: {
        serviceLines: { orderBy: { createdAt: "asc" } }
      }
    });

    if (!existing) {
      return res.status(404).json({ error: "Claim not found" });
    }

    assertClaimEditable(
      existing,
      "Submitted or finalized claims are locked. Reopen or amend the claim before editing."
    );

    const payload = buildClaimPatch(input);

    const effectivePatientName =
      Object.prototype.hasOwnProperty.call(payload, "patientName")
        ? payload.patientName
        : existing.patientName;
    const effectivePayerName =
      Object.prototype.hasOwnProperty.call(payload, "payerName")
        ? payload.payerName
        : existing.payerName;

    if (!effectivePatientName) {
      return res.status(400).json({ error: "Patient name is required" });
    }

    if (!effectivePayerName) {
      return res.status(400).json({ error: "Insurance company is required" });
    }

    if (
      Object.prototype.hasOwnProperty.call(input, "patientDob") &&
      input.patientDob &&
      !payload.patientDob
    ) {
      return res.status(400).json({ error: "Patient date of birth is invalid" });
    }

    for (const [label, field] of [
      ["Timely filing deadline", "timelyFilingDeadline"],
      ["Date of service", "dateOfService"],
      ["Admission date", "admissionDate"],
      ["Discharge date", "dischargeDate"],
      ["Procedure date", "procedureDate"]
    ]) {
      if (
        Object.prototype.hasOwnProperty.call(input, field) &&
        input[field] &&
        !payload[field]
      ) {
        return res.status(400).json({ error: `${label} is invalid` });
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, "icuDays") &&
      payload.icuDays != null &&
      (!Number.isFinite(payload.icuDays) || payload.icuDays < 0)
    ) {
      return res.status(400).json({
        error: "ICU days must be zero or a positive number"
      });
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, "amount") &&
      payload.amount != null &&
      (!Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0)
    ) {
      return res.status(400).json({
        error: "Claimed amount must be a valid number greater than 0"
      });
    }

    for (const name of ["amount", "totalBilledAmount", "coverageLimit", "remainingCoverageLimit"]) {
      if (!Object.prototype.hasOwnProperty.call(input, name)) continue;
      const supplied = input[name];
      if (supplied != null && supplied !== "" && validMoney(supplied) == null) {
        return res.status(400).json({
          error: "Invalid money",
          message: `${name} must have at most two decimal places`,
          code: "INVALID_MONEY"
        });
      }
    }

    const normalizedServiceLines =
      input.serviceLines === undefined ? null : normalizeServiceLines(input.serviceLines);
    if (normalizedServiceLines && !normalizedServiceLines.ok) {
      return res.status(400).json(normalizedServiceLines.response);
    }

    const patchChangedFields = changedPatchFields(existing, payload);
    const serviceLinesChanged = normalizedServiceLines
      ? serviceLinesDiffer(existing.serviceLines || [], normalizedServiceLines.data)
      : false;
    const anyClaimDataChanged =
      patchChangedFields.length > 0 || serviceLinesChanged;

    const manuallyChangedFields = changedFields(existing, payload);
    const documentDerivedFields = removeManuallyEditedFields(
      existing.documentDerivedFields,
      Object.fromEntries(
        manuallyChangedFields.map((field) => [field, payload[field]])
      )
    );
    const fieldProvenance = mergeProvenance(
      existing.fieldProvenance,
      manualProvenance(manuallyChangedFields)
    );

    const nextStatus = anyClaimDataChanged
      ? assertClaimTransition(existing.status, "DRAFT")
      : existing.status;

    if (anyClaimDataChanged) {
      await prisma.$transaction(async (tx) => {
        if (patchChangedFields.length > 0) {
          await tx.claim.update({
            where: { id: req.params.id },
            data: {
              ...payload,
              documentDerivedFields,
              fieldProvenance,
              status: nextStatus
            }
          });
        } else if (serviceLinesChanged && existing.status !== nextStatus) {
          await tx.claim.update({
            where: { id: req.params.id },
            data: { status: nextStatus }
          });
        }

        if (serviceLinesChanged) {
          await tx.serviceLine.deleteMany({ where: { claimId: req.params.id } });
          if (normalizedServiceLines.data.length > 0) {
            await tx.serviceLine.createMany({
              data: normalizedServiceLines.data.map((line) => ({
                ...line,
                claimId: req.params.id
              }))
            });
          }
        }
      });

      await markReadinessChecksStale(
        prisma,
        req.params.id,
        serviceLinesChanged && patchChangedFields.length === 0
          ? "Claim service lines changed"
          : "Claim details changed"
      );
    }

    const updated = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: {
        documents: true,
        serviceLines: { orderBy: { createdAt: "asc" } },
        checks: { orderBy: { createdAt: "desc" } }
      }
    });

    if (anyClaimDataChanged) {
      await auditClaim(req, {
        claimId: updated.id,
        action: "CLAIM_UPDATED",
        metadata: {
          changedFields: patchChangedFields,
          serviceLinesChanged
        }
      });
    }

    res.json({
      ...updated,
      unchanged: !anyClaimDataChanged,
      automationSummary: buildAutomationSummary(updated),
      completenessSummary: buildClaimCompleteness(updated)
    });
  } catch (e) {
    console.error("[claim-edit] failed", { name: e.name, code: e.code || null });
    res.status(500).json({ error: "Unable to update claim", code: "CLAIM_UPDATE_FAILED" });
  }
});

router.delete("/:id/purge", requireRoles(["ADMIN"]), async (req, res) => {
  try {
    const id = req.params.id;
    const claim = await prisma.claim.findFirst({
      where: {
        id,
        organizationId: orgId(req),
        deletedAt: { not: null }
      },
      include: {
        documents: {
          select: { id: true, path: true }
        }
      }
    });

    if (!claim) {
      return res.status(404).json({
        error: "Deleted claim not found",
        message: "Only an already soft-deleted claim can be permanently purged."
      });
    }

    const files = resolveClaimDocumentFiles(claim.documents);

    await prisma.$transaction(async (tx) => {
      await tx.auditEvent.create({
        data: {
          organizationId: orgId(req),
          claimId: claim.id,
          actorUserId: req.user?.id || null,
          action: "CLAIM_PERMANENTLY_PURGED",
          entityType: "Claim",
          entityId: claim.id,
          outcome: "SUCCESS",
          metadata: {
            patientName: claim.patientName,
            previousStatus: claim.status,
            softDeletedAt: claim.deletedAt,
            documentCount: claim.documents.length
          }
        }
      });

      await tx.claim.delete({ where: { id: claim.id } });
    });

    const fileCleanup = deletePurgedClaimFiles(files);
    if (fileCleanup.failures.length > 0) {
      console.error("[claim-purge] file cleanup incomplete", {
        claimId: id,
        failures: fileCleanup.failures
      });
    }

    res.json({
      success: true,
      permanentlyPurged: true,
      deletedFiles: fileCleanup.deleted,
      fileCleanupWarnings: fileCleanup.failures.length
    });
  } catch (error) {
    console.error("[claim-purge] failed", {
      claimId: req.params.id,
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({ error: "Unable to permanently purge claim" });
  }
});

router.delete("/:id", requireRoles(["ADMIN", "CASHIER"]), async (req, res) => {
  try {
    const id = req.params.id;

    const claim = await prisma.claim.findFirst({ where: { id, organizationId: orgId(req), deletedAt: null } });
    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    if (isClaimLocked(claim)) {
      return res.status(409).json({
        error: "Submitted or finalized claims are locked and cannot be deleted."
      });
    }

    await prisma.claim.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    await auditClaim(req, {
      claimId: id,
      action: "CLAIM_SOFT_DELETED",
      metadata: { previousStatus: claim.status }
    });

    res.json({ success: true, softDeleted: true });
  } catch (error) {
    console.error("Delete claim error:", error);
    res.status(400).json({ error: "Unable to delete claim" });
  }
});

// Legacy URLs delegate to the same implementation as /api/documents.
router.get("/:id/preview", (req, res) => serveStoredDocument(prisma, req, res));
router.get("/:id/download", (req, res) => serveStoredDocument(prisma, req, res, { download: true }));



router.delete("/documents/:id", requireRoles(["ADMIN", "CASHIER"]), (req, res) =>
  deleteStoredDocument(prisma, req, res, { legacy: true })
);

router.post("/:id/check", async (req, res) => {
  try {
    const parsedInput = parseMutation(emptyMutationSchema, req.body);
    if (!parsedInput.ok) {
      return res.status(400).json(parsedInput.response);
    }
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: {
        documents: true,
        serviceLines: { orderBy: { createdAt: "asc" } }
      }
    });

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    assertClaimEditable(
      claim,
      "Submitted or finalized claims are locked. Reopen or amend the claim before running a new AI check."
    );

    // Only recognized rule codes alter live readiness. Mandatory gates remain mandatory.
    const rules = await prisma.rule.findMany({
      where: {
        code: {
          in: ["REQ_POLICY_NO", "RECOMMENDED_ICD", ...usReadinessRuleCodes()]
        }
      }
    });
    const issues = [];

    if (!claim.policyNo) {
      issues.push(configuredReadinessIssue(rules, {
        code: "REQ_POLICY_NO",
        severity: "BLOCK",
        message: "Policy number missing",
        mandatory: true
      }));
    }

    if (!claim.icd10Codes?.length) {
      const icdIssue = configuredReadinessIssue(rules, {
        code: "RECOMMENDED_ICD",
        severity: "WARN",
        message: "ICD-10 codes missing"
      });
      if (icdIssue) issues.push(icdIssue);
    }

    if (!claim.documents?.length) {
      issues.push({
        severity: "BLOCK",
        message: "No supporting documents uploaded"
      });
    }

    if (!claim.amount || Number(claim.amount) <= 0) {
      issues.push({
        severity: "BLOCK",
        message: "Claimed amount missing or invalid"
      });
    }

    const verifiedServiceLines = (claim.serviceLines || []).filter(
      (line) => line.verified !== false
    );

    if (claim.claimForm === "PROFESSIONAL") {
      if (!claim.renderingProviderNpi) {
        issues.push({
          severity: "BLOCK",
          message: "837P professional claim requires rendering provider NPI",
          source: "CLAIM_FORM",
          fixTarget: "claim"
        });
      }
      if (verifiedServiceLines.length && verifiedServiceLines.some((line) => !line.placeOfService)) {
        issues.push({
          severity: "BLOCK",
          message: "837P professional service lines require Place of Service",
          source: "CLAIM_FORM",
          fixTarget: "claim"
        });
      }
    }

    if (claim.claimForm === "INSTITUTIONAL") {
      if (!claim.typeOfBill) {
        issues.push({
          severity: "BLOCK",
          message: "837I institutional claim requires Type of Bill",
          source: "CLAIM_FORM",
          fixTarget: "claim"
        });
      }
      if (verifiedServiceLines.length && verifiedServiceLines.some((line) => !line.revenueCode)) {
        issues.push({
          severity: "BLOCK",
          message: "837I institutional service lines require revenue code",
          source: "CLAIM_FORM",
          fixTarget: "claim"
        });
      }
    }

    if (claim.eligibilityStatus !== "VERIFIED") {
      issues.push({
        severity: "BLOCK",
        message: "Eligibility has not been verified"
      });
    }

    if (
      claim.priorAuthRequired == null ||
      (claim.priorAuthRequired === false && claim.priorAuthStatus !== "NOT_REQUIRED")
    ) {
      issues.push({
        severity: "BLOCK",
        message: "Prior authorization requirement is unresolved"
      });
    }

    issues.push(...evaluateUsReadinessRules(claim, rules));

    const completeness = completenessReadinessIssues(claim);
    issues.push(...completeness.issues);

    // Medical-consistency findings feed the same pre-submission readiness gate.
    // Keep the module deterministic and evidence-based; no diagnosis or payer
    // policy is inferred here.
    const medicalConsistency = analyzeMedicalConsistency(claim);
    for (const finding of medicalConsistency.issues) {
      const message = `${finding.title}: ${finding.message}`;
      if (!issues.some((existing) => existing.message === message)) {
        issues.push({
          severity: finding.severity,
          message,
          source: "MEDICAL_CONSISTENCY",
          category: finding.category,
          fields: finding.fields,
          fixTarget: finding.fixTarget
        });
      }
    }

    let riskScore = 0;
    const riskFactors = [];

    if (!claim.policyNo) {
      riskScore += 0.25;
      riskFactors.push(
        "Claims without policy number historically show elevated rejection trends"
      );
    }

    if (issues.some((issue) => issue.rule === "RECOMMENDED_ICD")) {
      riskScore += 0.15;
      riskFactors.push(
        "Unstructured diagnosis increases manual review probability"
      );
    }

    if (
      claim.totalBilledAmount &&
      claim.amount &&
      Number(claim.amount) > Number(claim.totalBilledAmount)
    ) {
      riskScore += 0.3;
      riskFactors.push(
        "Claimed amount exceeds billed amount, increasing audit likelihood"
      );
    }

    if (issues.some((i) => i.severity === "BLOCK")) {
      riskScore += 0.1;
      riskFactors.push("Blocking compliance failures present");
    }

    let readinessScore = 100;

    issues.forEach((issue) => {
      if (issue.severity === "BLOCK") readinessScore -= 30;
      if (issue.severity === "WARN") readinessScore -= 10;
    });

    readinessScore = Math.max(readinessScore, 0);

    // Keep readiness and rejection-risk signals directionally consistent.
    // This remains a rules-based estimate, not a payer probability.
    const readinessRiskFloor = (100 - readinessScore) / 100;
    if (readinessRiskFloor > riskScore) {
      riskScore = readinessRiskFloor;
      if (readinessRiskFloor >= 0.3) {
        riskFactors.push("Readiness gaps indicate elevated submission risk");
      }
    }

    riskScore = Math.min(riskScore, 0.95);

    const riskLevel =
      riskScore >= 0.6 ? "HIGH" : riskScore >= 0.3 ? "MED" : "LOW";

    const hasBlock = issues.some((i) => i.severity === "BLOCK");

    const previousCheck = await prisma.check.findFirst({
      where: { claimId: claim.id },
      orderBy: { createdAt: "desc" }
    });

    const readinessStatus = assertClaimTransition(
      claim.status,
      !hasBlock && readinessScore >= 80 ? "READY" : "DRAFT"
    );

    const check = await prisma.$transaction(async (tx) => {
      const created = await tx.check.create({
        data: {
          claimId: claim.id,
          score: readinessScore,
          riskScore,
          riskLevel,
          riskFactors,
          issues,
          isStale: false,
          staleAt: null,
          staleReason: null
        }
      });

      await tx.claim.update({
        where: { id: claim.id },
        data: { status: readinessStatus }
      });

      return created;
    });

    res.json({
      ...check,
      comparison: compareReadinessChecks(check, previousCheck),
      completenessSummary: completeness.summary,
      medicalConsistency: {
        score: medicalConsistency.score,
        status: medicalConsistency.status,
        blockingIssues: medicalConsistency.blockingIssues,
        warnings: medicalConsistency.warnings
      }
    });
  } catch (e) {
    if (e?.status) throw e;
    console.error("[claim-readiness] failed", { name: e?.name, code: e?.code || null });
    res.status(500).json({ error: "Unable to check claim readiness", code: "CLAIM_READINESS_FAILED" });
  }
});



router.post("/:id/submit", requireRoles(["ADMIN", "CASHIER"]), async (req, res) => {
  try {
    const parsedInput = parseMutation(emptyMutationSchema, req.body);
    if (!parsedInput.ok) {
      return res.status(400).json(parsedInput.response);
    }
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: {
        checks: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    });

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    const latestCheck = claim.checks?.[0];

    if (claim.eligibilityStatus !== "VERIFIED") {
      return res.status(400).json({
        error: "Verify eligibility before submitting the claim"
      });
    }

    if (
      claim.priorAuthStatus !== "APPROVED" &&
      claim.priorAuthStatus !== "NOT_REQUIRED"
    ) {
      return res.status(400).json({
        error: "Resolve prior authorization before submitting the claim"
      });
    }

    if (!latestCheck) {
      return res.status(400).json({
        error: "Run AI Check before submitting the claim"
      });
    }

    if (latestCheck.isStale) {
      return res.status(400).json({
        error:
          "Claim changed after the last AI Check. Refresh AI readiness before submitting."
      });
    }

    const issues = Array.isArray(latestCheck.issues)
      ? latestCheck.issues
      : [];

    const hasBlock = issues.some((i) => i.severity === "BLOCK");

    if (hasBlock) {
      return res.status(400).json({
        error: "Claim has blocking issues. Fix them before submission"
      });
    }

    if (latestCheck.score < 80) {
      return res.status(400).json({
        error: "Claim readiness score must be at least 80 to submit"
      });
    }

    if (isClaimLocked(claim)) {
      assertClaimEditable(
        claim,
        "Submitted or finalized claims cannot be submitted again."
      );
    }

    const submittedStatus = assertClaimTransition(claim.status, "SUBMITTED");
    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        status: submittedStatus,
        claimSubmissionDate: new Date(),
        payerClaimStatus: "SUBMITTED",
        claimStatusCheckedAt: new Date(),
        remittanceStatus: "AWAITING"
      },
      include: {
        documents: true,
        checks: { orderBy: { createdAt: "desc" } }
      }
    });

    await auditClaim(req, {
      claimId: claim.id,
      action: "CLAIM_SUBMITTED",
      metadata: { payerClaimStatus: updated.payerClaimStatus }
    });

    res.json({
      success: true,
      message: "Claim submitted successfully",
      claim: updated
    });
  } catch (e) {
    if (e?.status) throw e;
    console.error("[claim-submit] failed", { name: e?.name, code: e?.code || null });
    res.status(500).json({ error: "Unable to submit claim", code: "CLAIM_SUBMISSION_FAILED" });
  }
});

export default router;