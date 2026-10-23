import crypto from "node:crypto";
import express from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { PERMISSIONS } from "../security/permissions.js";
import { writeCriticalRequestAudit, writeRequestAudit } from "../services/auditLog.js";

const router = express.Router();
const kinds = ["EHR", "PMS", "CLEARINGHOUSE", "PAYER"];
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

const orgId = (req) => req.user.organizationId;
const hashEvent = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

function connectionFor(req, id) {
  return prisma.integrationConnection.findFirst({
    where: { id, organizationId: orgId(req) }
  });
}

async function claimFor(req, id) {
  if (!id) return null;
  return prisma.claim.findFirst({
    where: { id, organizationId: orgId(req), deletedAt: null },
    select: { id: true }
  });
}

router.get("/", requirePermission(PERMISSIONS.PAYER_CONNECT), async (req, res) => {
  const items = await prisma.integrationConnection.findMany({
    where: { organizationId: orgId(req) },
    select: {
      id: true, name: true, kind: true, provider: true, environment: true,
      status: true, lastHealthyAt: true, lastErrorAt: true, lastErrorCode: true,
      createdAt: true, updatedAt: true,
      _count: { select: { externalIdentities: true, events: true } }
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

router.post("/", requirePermission(PERMISSIONS.PAYER_CONNECT), async (req, res) => {
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

router.patch("/:id/health", requirePermission(PERMISSIONS.PAYER_CONNECT), async (req, res) => {
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

router.post("/:id/claim-links", requirePermission(PERMISSIONS.PAYER_CONNECT), async (req, res) => {
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

router.post("/:id/events", requirePermission(PERMISSIONS.PAYER_CONNECT), async (req, res) => {
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

router.get("/:id/events", requirePermission(PERMISSIONS.PAYER_CONNECT), async (req, res) => {
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
