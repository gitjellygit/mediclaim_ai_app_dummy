import express from "express";
import { prisma } from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { PERMISSIONS } from "../security/permissions.js";
import { auditOnResponse } from "../services/auditLog.js";

const router = express.Router();

router.use(requirePermission(PERMISSIONS.DENIAL_VIEW));
router.use(requirePermission(PERMISSIONS.FINANCIAL_VIEW));

router.use((req, res, next) => {
  if (req.method === "GET" && req.path === "/") {
    auditOnResponse(prisma, req, res, (statusCode) => ({
      action: "REVENUE_RECOVERY_VIEWED",
      entityType: "RevenueRecovery",
      outcome: statusCode < 400 ? "SUCCESS" : "DENIED",
      metadata: {
        filtered: Boolean(req.query.q || req.query.type || req.query.status)
      }
    }));
  }
  next();
});

const ACTIVE_DENIAL_STATUSES = new Set([
  "OPEN",
  "ANALYZED",
  "CORRECTION_REQUIRED",
  "APPEAL_PREPARED",
  "APPEAL_SUBMITTED",
  "RESUBMITTED"
]);

const ACTIVE_UNDERPAYMENT_STATUSES = new Set([
  "OPEN",
  "REVIEWING",
  "DISPUTE_PREPARED",
  "DISPUTE_SUBMITTED"
]);

function daysUntil(value, now = new Date()) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.ceil((end - start) / 86400000);
}

function denialOutstanding(item) {
  return Math.max(
    0,
    Number(item.revenueAtRisk || 0) - Number(item.recoveredAmount || 0)
  );
}

function underpaymentOutstanding(item) {
  return Math.max(
    0,
    Number(item.varianceAmount || 0) - Number(item.recoveredAmount || 0)
  );
}

function recoveryPriority({ amount, deadlineDays, status, type }) {
  const dollars = Math.max(0, Number(amount || 0));
  let score = Math.min(55, Math.round(Math.log10(dollars + 1) * 14));

  if (deadlineDays != null) {
    if (deadlineDays < 0) score += 30;
    else if (deadlineDays <= 3) score += 28;
    else if (deadlineDays <= 7) score += 24;
    else if (deadlineDays <= 14) score += 18;
    else if (deadlineDays <= 30) score += 10;
  }

  if (
    ["APPEAL_PREPARED", "DISPUTE_PREPARED"].includes(status)
  ) score += 8;
  if (
    ["APPEAL_SUBMITTED", "DISPUTE_SUBMITTED", "RESUBMITTED"].includes(status)
  ) score += 4;
  if (type === "DENIAL") score += 3;

  return Math.max(0, Math.min(100, score));
}

function priorityLabel(score) {
  if (score >= 75) return "CRITICAL";
  if (score >= 55) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function nextActionFor(item) {
  if (item.type === "DENIAL") {
    if (item.deadlineDays != null && item.deadlineDays < 0) {
      return "Review expired appeal deadline";
    }
    if (item.status === "OPEN") return "Analyze denial";
    if (item.status === "ANALYZED") return "Prepare correction or appeal";
    if (item.status === "CORRECTION_REQUIRED") return "Correct and resubmit";
    if (item.status === "APPEAL_PREPARED") return "Review and submit appeal";
    if (item.status === "APPEAL_SUBMITTED") return "Track appeal";
    if (item.status === "RESUBMITTED") return "Track payer response";
    return "Review denial";
  }

  if (item.status === "OPEN") return "Review payment variance";
  if (item.status === "REVIEWING") return "Prepare payer dispute";
  if (item.status === "DISPUTE_PREPARED") return "Review and submit dispute";
  if (item.status === "DISPUTE_SUBMITTED") return "Track recovery";
  return "Review underpayment";
}

function normalizeDenial(item, now) {
  const outstandingAmount = denialOutstanding(item);
  const deadlineDays = daysUntil(item.appealDeadline, now);
  const priorityScore = recoveryPriority({
    amount: outstandingAmount,
    deadlineDays,
    status: item.status,
    type: "DENIAL"
  });

  return {
    id: item.id,
    type: "DENIAL",
    claimId: item.claimId,
    patientName: item.claim?.patientName || "Unknown Patient",
    payerName: item.claim?.payerName || "Unknown Payer",
    insurerClaimNo: item.claim?.insurerClaimNo || null,
    status: item.status,
    rootCause: item.denialCategory || "UNCLASSIFIED",
    codeSummary: [item.groupCode, item.carcCode, item.rarcCode]
      .filter(Boolean)
      .join(" / ") || null,
    originalAmount: Number(item.revenueAtRisk || 0),
    recoveredAmount: Number(item.recoveredAmount || 0),
    outstandingAmount,
    deadline: item.appealDeadline || null,
    deadlineDays,
    priorityScore,
    priority: priorityLabel(priorityScore),
    nextAction: null,
    source: item.source,
    updatedAt: item.updatedAt
  };
}

function normalizeUnderpayment(item) {
  const outstandingAmount = underpaymentOutstanding(item);
  const priorityScore = recoveryPriority({
    amount: outstandingAmount,
    deadlineDays: null,
    status: item.status,
    type: "UNDERPAYMENT"
  });

  return {
    id: item.id,
    type: "UNDERPAYMENT",
    claimId: item.claimId,
    patientName: item.claim?.patientName || "Unknown Patient",
    payerName: item.claim?.payerName || "Unknown Payer",
    insurerClaimNo: item.claim?.insurerClaimNo || null,
    status: item.status,
    rootCause: item.reasonCategory || "PAYMENT_VARIANCE",
    codeSummary: null,
    originalAmount: Number(item.varianceAmount || 0),
    recoveredAmount: Number(item.recoveredAmount || 0),
    outstandingAmount,
    deadline: null,
    deadlineDays: null,
    priorityScore,
    priority: priorityLabel(priorityScore),
    nextAction: null,
    source: "REMITTANCE",
    updatedAt: item.updatedAt
  };
}

function summarize(items) {
  const active = items.filter((item) =>
    item.type === "DENIAL"
      ? ACTIVE_DENIAL_STATUSES.has(item.status)
      : ACTIVE_UNDERPAYMENT_STATUSES.has(item.status)
  );

  const totalOutstanding = active.reduce(
    (sum, item) => sum + Number(item.outstandingAmount || 0),
    0
  );
  const totalRecovered = items.reduce(
    (sum, item) => sum + Number(item.recoveredAmount || 0),
    0
  );
  const deadlinesDue7 = active.filter(
    (item) =>
      item.type === "DENIAL" &&
      item.deadlineDays != null &&
      item.deadlineDays >= 0 &&
      item.deadlineDays <= 7
  ).length;

  return {
    activeOpportunities: active.length,
    totalOutstanding: Math.round(totalOutstanding * 100) / 100,
    totalRecovered: Math.round(totalRecovered * 100) / 100,
    deadlinesDue7,
    criticalCount: active.filter((item) => item.priority === "CRITICAL").length
  };
}

function aggregateBy(items, key, max = 5) {
  const map = new Map();
  for (const item of items) {
    if (item.outstandingAmount <= 0) continue;
    const label = String(item[key] || "Unknown");
    const current = map.get(label) || { label, count: 0, outstandingAmount: 0 };
    current.count += 1;
    current.outstandingAmount += item.outstandingAmount;
    map.set(label, current);
  }
  return [...map.values()]
    .map((item) => ({
      ...item,
      outstandingAmount: Math.round(item.outstandingAmount * 100) / 100
    }))
    .sort((a, b) => b.outstandingAmount - a.outstandingAmount)
    .slice(0, max);
}

router.get("/", async (req, res) => {
  try {
    const now = new Date();
    const q = String(req.query.q || "").trim().slice(0, 100);
    const type = String(req.query.type || "ALL").toUpperCase();
    const status = String(req.query.status || "ACTIVE").toUpperCase();
    const requestedLimit = Number(req.query.limit || 100);
    const limit = Math.max(
      1,
      Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 100, 200)
    );

    const claimSearch = q
      ? {
          OR: [
            { patientName: { contains: q, mode: "insensitive" } },
            { payerName: { contains: q, mode: "insensitive" } },
            { insurerClaimNo: { contains: q, mode: "insensitive" } }
          ]
        }
      : {};

    const [denials, underpayments] = await Promise.all([
      type === "UNDERPAYMENT"
        ? Promise.resolve([])
        : prisma.denialCase.findMany({
            where: {
              claim: {
                is: {
                  organizationId: req.user.organizationId,
                  deletedAt: null,
                  ...claimSearch
                }
              }
            },
            select: {
              id: true,
              claimId: true,
              source: true,
              status: true,
              denialCategory: true,
              groupCode: true,
              carcCode: true,
              rarcCode: true,
              appealDeadline: true,
              revenueAtRisk: true,
              recoveredAmount: true,
              updatedAt: true,
              claim: {
                select: {
                  patientName: true,
                  payerName: true,
                  insurerClaimNo: true
                }
              }
            },
            orderBy: { updatedAt: "desc" },
            take: 500
          }),
      type === "DENIAL"
        ? Promise.resolve([])
        : prisma.underpaymentCase.findMany({
            where: {
              claim: {
                is: {
                  organizationId: req.user.organizationId,
                  deletedAt: null,
                  ...claimSearch
                }
              }
            },
            select: {
              id: true,
              claimId: true,
              status: true,
              varianceAmount: true,
              recoveredAmount: true,
              reasonCategory: true,
              updatedAt: true,
              claim: {
                select: {
                  patientName: true,
                  payerName: true,
                  insurerClaimNo: true
                }
              }
            },
            orderBy: { updatedAt: "desc" },
            take: 500
          })
    ]);

    let items = [
      ...denials.map((item) => normalizeDenial(item, now)),
      ...underpayments.map(normalizeUnderpayment)
    ].map((item) => ({
      ...item,
      nextAction: nextActionFor(item)
    }));

    const allItems = items;
    if (status === "ACTIVE") {
      items = items.filter((item) =>
        item.type === "DENIAL"
          ? ACTIVE_DENIAL_STATUSES.has(item.status)
          : ACTIVE_UNDERPAYMENT_STATUSES.has(item.status)
      );
    } else if (status !== "ALL") {
      items = items.filter((item) => item.status === status);
    }

    items.sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      if (b.outstandingAmount !== a.outstandingAmount) {
        return b.outstandingAmount - a.outstandingAmount;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    res.json({
      items: items.slice(0, limit),
      total: items.length,
      metrics: summarize(allItems),
      topPayers: aggregateBy(allItems, "payerName"),
      topRootCauses: aggregateBy(allItems, "rootCause"),
      methodology: {
        priority:
          "Deterministic operational priority based on outstanding dollars, appeal deadline urgency, workflow state and recovery type. It is not a probability of recovery."
      }
    });
  } catch (error) {
    console.error("[revenue-recovery] list failed", {
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({
      error: "Unable to load revenue recovery",
      code: "REVENUE_RECOVERY_LOAD_FAILED"
    });
  }
});

export default router;
