import express from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { PERMISSIONS } from "../security/permissions.js";
import { auditOnResponse, writeCriticalRequestAudit } from "../services/auditLog.js";

const router = express.Router();

router.use(requirePermission(PERMISSIONS.RECOVERY_VIEW));

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
    assignedToUser: item.claim?.assignedToUser || null,
    workTeam: item.claim?.workTeam || null,
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
    assignedToUser: item.claim?.assignedToUser || null,
    workTeam: item.claim?.workTeam || null,
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

router.get(
  "/assignment-users",
  requirePermission(PERMISSIONS.RECOVERY_EDIT),
  async (req, res) => {
    const users = await prisma.user.findMany({
      where: {
        organizationId: req.user.organizationId,
        status: "ACTIVE",
        role: { in: ["DENIAL_SPECIALIST", "CLAIMS_SPECIALIST", "CLAIMS_MANAGER", "ADMIN"] }
      },
      select: { id: true, email: true, displayName: true, role: true, teamId: true },
      orderBy: [{ displayName: "asc" }, { email: "asc" }]
    });
    res.json({ items: users });
  }
);

router.patch(
  "/claims/:claimId/assignment",
  requirePermission(PERMISSIONS.RECOVERY_EDIT),
  async (req, res) => {
    const schema = z.object({
      assignedToUserId: z.string().trim().min(1).nullable().optional(),
      workTeam: z.string().trim().max(100).nullable().optional()
    }).strict();
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid recovery assignment" });
    }

    const claim = await prisma.claim.findFirst({
      where: {
        id: req.params.claimId,
        organizationId: req.user.organizationId,
        deletedAt: null
      },
      select: {
        id: true,
        assignedToUserId: true,
        workTeam: true
      }
    });
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    const [denialCount, underpaymentCount] = await Promise.all([
      prisma.denialCase.count({ where: { claimId: claim.id } }),
      prisma.underpaymentCase.count({ where: { claimId: claim.id } })
    ]);
    if (denialCount + underpaymentCount === 0) {
      return res.status(404).json({ error: "Claim is not part of Revenue Recovery" });
    }

    let assignee = null;
    if (parsed.data.assignedToUserId) {
      assignee = await prisma.user.findFirst({
        where: {
          id: parsed.data.assignedToUserId,
          organizationId: req.user.organizationId,
          status: "ACTIVE"
        },
        select: { id: true, email: true, displayName: true, role: true }
      });
      if (!assignee) {
        return res.status(400).json({
          error: "Recovery assignee must be an active user in this organization"
        });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.claim.update({
        where: { id: claim.id },
        data: {
          assignedToUserId: parsed.data.assignedToUserId ?? null,
          workTeam: parsed.data.workTeam || null,
          lastWorkedAt: new Date()
        },
        select: {
          id: true,
          assignedToUserId: true,
          workTeam: true
        }
      });

      await tx.claimOwnershipHistory.create({
        data: {
          organizationId: req.user.organizationId,
          claimId: claim.id,
          changedByUserId: req.user.id,
          previousAssigneeUserId: claim.assignedToUserId,
          newAssigneeUserId: item.assignedToUserId,
          previousTeam: claim.workTeam,
          newTeam: item.workTeam,
          previousPriority: null,
          newPriority: null,
          reason: "Revenue Recovery assignment"
        }
      });

      if (item.assignedToUserId && item.assignedToUserId !== req.user.id) {
        await tx.notification.create({
          data: {
            organizationId: req.user.organizationId,
            userId: item.assignedToUserId,
            type: "RECOVERY_ASSIGNED",
            title: "Recovery work assigned to you",
            message: "A Revenue Recovery case was assigned to your work queue.",
            claimId: claim.id
          }
        });
      }

      await writeCriticalRequestAudit(tx, req, {
        claimId: claim.id,
        action: "RECOVERY_ASSIGNMENT_UPDATED",
        entityType: "Claim",
        entityId: claim.id,
        metadata: {
          operation: "recovery_assignment",
          assigned: Boolean(item.assignedToUserId),
          workTeam: item.workTeam || null
        }
      });

      return item;
    });

    res.json({
      claimId: updated.id,
      assignedToUser: assignee,
      workTeam: updated.workTeam
    });
  }
);

router.get("/", async (req, res) => {
  try {
    const now = new Date();
    const q = String(req.query.q || "").trim().slice(0, 100);
    const type = String(req.query.type || "ALL").toUpperCase();
    const status = String(req.query.status || "ACTIVE").toUpperCase();
    const requestedPage = Number(req.query.page || 1);
    const requestedPageSize = Number(req.query.pageSize || req.query.limit || 10);
    const page = Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1);
    const pageSize = Math.max(
      1,
      Math.min(Number.isFinite(requestedPageSize) ? Math.floor(requestedPageSize) : 10, 100)
    );
    const sort = String(req.query.sort || "priority").toLowerCase();
    const direction = String(req.query.direction || "desc").toLowerCase() === "asc" ? "asc" : "desc";

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
                  insurerClaimNo: true,
                  workTeam: true,
                  assignedToUser: {
                    select: { id: true, email: true, displayName: true, role: true }
                  }
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
                  insurerClaimNo: true,
                  workTeam: true,
                  assignedToUser: {
                    select: { id: true, email: true, displayName: true, role: true }
                  }
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

    if (status === "ACTIVE") {
      items = items.filter((item) =>
        item.type === "DENIAL"
          ? ACTIVE_DENIAL_STATUSES.has(item.status)
          : ACTIVE_UNDERPAYMENT_STATUSES.has(item.status)
      );
    } else if (status !== "ALL") {
      items = items.filter((item) => item.status === status);
    }

    const filteredItems = items;
    const sortValue = (item) => {
      if (sort === "outstanding") return Number(item.outstandingAmount || 0);
      if (sort === "recovered") return Number(item.recoveredAmount || 0);
      if (sort === "deadline") {
        return item.deadline ? new Date(item.deadline).getTime() : Number.POSITIVE_INFINITY;
      }
      if (sort === "patient") return String(item.patientName || "").toLowerCase();
      if (sort === "payer") return String(item.payerName || "").toLowerCase();
      if (sort === "updated") return new Date(item.updatedAt).getTime();
      return Number(item.priorityScore || 0);
    };

    items.sort((a, b) => {
      const left = sortValue(a);
      const right = sortValue(b);
      if (sort === "deadline") {
        const leftMissing = !a.deadline;
        const rightMissing = !b.deadline;
        if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
      }
      let comparison = 0;
      if (typeof left === "string" || typeof right === "string") {
        comparison = String(left).localeCompare(String(right));
      } else {
        comparison = Number(left) - Number(right);
      }
      if (comparison === 0) {
        comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      }
      return direction === "asc" ? comparison : -comparison;
    });

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    res.json({
      items: items.slice(offset, offset + pageSize),
      total,
      page: safePage,
      pageSize,
      totalPages,
      sort,
      direction,
      metrics: summarize(filteredItems),
      topPayers: aggregateBy(filteredItems, "payerName"),
      topRootCauses: aggregateBy(filteredItems, "rootCause"),
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
