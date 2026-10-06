const SAFE_METADATA_KEYS = new Set([
  "status","previousStatus","nextStatus","changedFields","serviceLinesChanged",
  "documentType","uploadMode","ocrProvider","confidence","suggestedType",
  "rule","severity","payerStatus","priorAuthStatus","eligibilityStatus",
  "sessionId","sessionCount","reason","source","operation","count",
  "category","hasCARC","hasRARC","provider","model","llmUsed",
  "softDeleted","documentCount","riskLevel","score","hasBlockingIssues"
]);

function normalizeAuditId(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized || normalized === "undefined" || normalized === "null") return null;
  return normalized;
}

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
  metadata = {},
  ipAddress = null,
  userAgent = null,
  httpMethod = null,
  httpPath = null,
  requestId = null,
  statusCode = null
}) {
  if (!organizationId || !action || !entityType) return null;
  try {
    return await prisma.auditEvent.create({
      data: {
        organizationId,
        actorUserId: normalizeAuditId(actorUserId),
        claimId: normalizeAuditId(claimId),
        action,
        entityType,
        entityId: normalizeAuditId(entityId),
        outcome,
        metadata: sanitizeAuditMetadata(metadata),
        ipAddress: normalizeAuditId(ipAddress),
        userAgent: userAgent ? String(userAgent).slice(0, 500) : null,
        httpMethod: httpMethod ? String(httpMethod).slice(0, 16) : null,
        httpPath: httpPath ? String(httpPath).slice(0, 300) : null,
        requestId: normalizeAuditId(requestId),
        statusCode: Number.isInteger(statusCode) ? statusCode : null
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

function requestAuditContext(req, statusCode = null) {
  const routePath = req.route?.path
    ? `${req.baseUrl || ""}${req.route.path}`
    : (req.baseUrl || req.path || null);

  return {
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    userAgent: req.get?.("user-agent") || null,
    httpMethod: req.method || null,
    httpPath: routePath,
    requestId: req.auditRequestId || req.get?.("x-request-id") || null,
    statusCode: Number.isInteger(statusCode) ? statusCode : null
  };
}

export function writeRequestAudit(prisma, req, event) {
  return writeAuditEvent(prisma, {
    organizationId: req.user?.organizationId,
    actorUserId: req.user?.id || null,
    ...requestAuditContext(req, event?.statusCode),
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
        statusCode: res.statusCode,
        outcome: event.outcome || (res.statusCode < 400 ? "SUCCESS" : "DENIED")
      });
    } catch (error) {
      console.error("[audit] response hook failed", { name: error?.name || "Error" });
    }
  });
}
