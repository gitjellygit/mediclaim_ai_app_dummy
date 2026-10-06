import express from "express";
import { prisma } from "../db.js";
import { writeRequestAudit } from "../services/auditLog.js";

const router = express.Router();
const EXPORT_LIMIT = 10000;
const AUDIT_ACCESS_DEDUP_MS = 5 * 60 * 1000;

async function recordAuditTrailAccess(req) {
  const actorUserId = req.user?.id || null;
  const organizationId = req.user?.organizationId;
  if (!organizationId) return;

  const recent = await prisma.auditEvent.findFirst({
    where: {
      organizationId,
      actorUserId,
      action: "AUDIT_TRAIL_ACCESSED",
      createdAt: {
        gte: new Date(Date.now() - AUDIT_ACCESS_DEDUP_MS)
      }
    },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });

  if (recent) return;

  await writeRequestAudit(prisma, req, {
    action: "AUDIT_TRAIL_ACCESSED",
    entityType: "AuditEvent",
    statusCode: 200,
    metadata: {
      operation: "audit_page_access"
    }
  });
}


function parseDate(value, label) {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error(`${label} must be a valid date/time`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function buildWhere(req) {
  const where = { organizationId: req.user.organizationId };

  if (req.query.action) {
    where.action = { contains: String(req.query.action), mode: "insensitive" };
  }
  if (req.query.outcome) where.outcome = String(req.query.outcome);
  if (req.query.entityType) where.entityType = String(req.query.entityType);
  if (req.query.claimId) where.claimId = String(req.query.claimId);
  if (req.query.entityId) {
    where.entityId = { contains: String(req.query.entityId), mode: "insensitive" };
  }
  if (req.query.actorUserId) where.actorUserId = String(req.query.actorUserId);
  if (req.query.actorEmail) {
    where.actorUser = {
      email: { contains: String(req.query.actorEmail), mode: "insensitive" }
    };
  }
  if (req.query.ipAddress) {
    where.ipAddress = { contains: String(req.query.ipAddress), mode: "insensitive" };
  }
  if (req.query.requestId) {
    where.requestId = { contains: String(req.query.requestId), mode: "insensitive" };
  }
  if (req.query.httpMethod) where.httpMethod = String(req.query.httpMethod).toUpperCase();
  if (req.query.statusCode) {
    const statusCode = Number(req.query.statusCode);
    if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
      const error = new Error("Status code must be between 100 and 599");
      error.status = 400;
      throw error;
    }
    where.statusCode = statusCode;
  }

  const from = parseDate(req.query.from, "From");
  const to = parseDate(req.query.to, "To");
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }

  return where;
}

const include = {
  actorUser: {
    select: { id: true, email: true, role: true }
  }
};

function serialize(item) {
  return {
    id: item.id,
    createdAt: item.createdAt,
    actor: item.actorUser,
    action: item.action,
    entityType: item.entityType,
    entityId: item.entityId,
    claimId: item.claimId,
    outcome: item.outcome,
    ipAddress: item.ipAddress,
    userAgent: item.userAgent,
    httpMethod: item.httpMethod,
    httpPath: item.httpPath,
    requestId: item.requestId,
    statusCode: item.statusCode,
    metadata: item.metadata || {}
  };
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(items) {
  const columns = [
    "timestamp","userEmail","userRole","action","outcome","entityType","entityId",
    "claimId","ipAddress","httpMethod","httpPath","statusCode","requestId","userAgent","safeMetadata"
  ];

  const rows = items.map((item) => [
    item.createdAt?.toISOString?.() || item.createdAt,
    item.actorUser?.email || "System",
    item.actorUser?.role || "",
    item.action,
    item.outcome,
    item.entityType,
    item.entityId,
    item.claimId,
    item.ipAddress,
    item.httpMethod,
    item.httpPath,
    item.statusCode,
    item.requestId,
    item.userAgent,
    JSON.stringify(item.metadata || {})
  ]);

  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(","))
  ].join("\n");
}

router.get("/export", async (req, res) => {
  const where = buildWhere(req);
  const items = await prisma.auditEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: EXPORT_LIMIT,
    include
  });

  await writeRequestAudit(prisma, req, {
    action: "AUDIT_TRAIL_EXPORTED",
    entityType: "AuditEvent",
    statusCode: 200,
    metadata: { count: items.length, operation: "csv_export" }
  });

  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  res.json({
    filename: `audit-trail-${stamp}.csv`,
    csv: toCsv(items),
    exported: items.length,
    limit: EXPORT_LIMIT,
    truncated: items.length === EXPORT_LIMIT
  });
});

router.get("/", async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize || 25)));

  // Record access before reading so the initial unfiltered page can show the
  // access event immediately. Subsequent filter/pagination requests within the
  // short dedup window do not create noisy self-referential audit rows.
  await recordAuditTrailAccess(req);

  const where = buildWhere(req);

  const [items, total] = await prisma.$transaction([
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include
    }),
    prisma.auditEvent.count({ where })
  ]);


  res.json({
    items: items.map(serialize),
    page,
    pageSize,
    total
  });
});

export default router;
