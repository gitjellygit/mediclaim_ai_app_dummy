const SAFE_METADATA_KEYS = new Set([
  "status","previousStatus","nextStatus","changedFields","serviceLinesChanged",
  "documentType","uploadMode","ocrProvider","confidence","suggestedType",
  "rule","severity","payerStatus","priorAuthStatus","eligibilityStatus",
  "sessionId","sessionCount","reason","source","operation","count"
]);

function sanitizeScalar(value) {
  if (value == null) return value;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 200);
  return null;
}

export function sanitizeAuditMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const safe = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_METADATA_KEYS.has(key)) continue;
    if (Array.isArray(value)) {
      safe[key] = value.slice(0, 50).map(sanitizeScalar).filter((item) => item !== null);
    } else {
      const scalar = sanitizeScalar(value);
      if (scalar !== null) safe[key] = scalar;
    }
  }
  return safe;
}

export async function writeAuditEvent(prisma, {
  organizationId,
  actorUserId = null,
  claimId = null,
  action,
  entityType,
  entityId = null,
  outcome = "SUCCESS",
  metadata = {}
}) {
  if (!organizationId || !action || !entityType) return null;
  try {
    return await prisma.auditEvent.create({
      data: {
        organizationId,
        actorUserId,
        claimId,
        action,
        entityType,
        entityId,
        outcome,
        metadata: sanitizeAuditMetadata(metadata)
      }
    });
  } catch (error) {
    console.error("[audit] write failed", {
      action,
      entityType,
      entityId,
      name: error?.name || "Error",
      code: error?.code || null
    });
    return null;
  }
}

export function writeRequestAudit(prisma, req, event) {
  return writeAuditEvent(prisma, {
    organizationId: req.user?.organizationId,
    actorUserId: req.user?.id || null,
    ...event
  });
}


export function auditOnResponse(prisma, req, res, eventFactory) {
  res.once("finish", () => {
    try {
      const event = eventFactory(res.statusCode);
      if (!event) return;
      void writeRequestAudit(prisma, req, {
        ...event,
        outcome: event.outcome || (res.statusCode < 400 ? "SUCCESS" : "DENIED")
      });
    } catch (error) {
      console.error("[audit] response hook failed", { name: error?.name || "Error" });
    }
  });
}
