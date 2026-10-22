import express from "express";
import { prisma } from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { PERMISSIONS } from "../security/permissions.js";

const router = express.Router();
router.use(requirePermission(PERMISSIONS.FINANCIAL_VIEW));

const ACTIVE_DENIAL_STATUSES = [
  "OPEN",
  "ANALYZED",
  "CORRECTION_REQUIRED",
  "APPEAL_PREPARED",
  "APPEAL_SUBMITTED",
  "RESUBMITTED"
];
const ACTIVE_UNDERPAYMENT_STATUSES = [
  "OPEN",
  "REVIEWING",
  "DISPUTE_PREPARED",
  "DISPUTE_SUBMITTED"
];

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function startForRange(range, now = new Date()) {
  if (range === "ALL") return null;
  const days = range === "90" ? 90 : 30;
  return new Date(now.getTime() - days * 86400000);
}

function dateOnly(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function dayDiff(from, to) {
  if (!from || !to) return null;
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

function billedValue(claim) {
  return Number(claim.totalBilledAmount ?? claim.amount ?? 0);
}

function outstandingValue(claim) {
  if (claim.status === "PAID") return 0;
  const base = Number(claim.allowedAmount ?? claim.amount ?? claim.totalBilledAmount ?? 0);
  const paid = Number(claim.paidAmount || 0);
  return Math.max(0, base - paid);
}

function ageDays(claim, now) {
  const origin = claim.claimSubmissionDate || claim.dateOfService || claim.createdAt;
  return dayDiff(origin, now) ?? 0;
}

function agingBucket(days) {
  if (days <= 30) return "0–30";
  if (days <= 60) return "31–60";
  if (days <= 90) return "61–90";
  return "90+";
}

function buildTrend(claims, start, now) {
  const days = start ? Math.max(1, Math.ceil((now - start) / 86400000)) : 90;
  const bucketDays = days <= 31 ? 7 : days <= 100 ? 14 : 30;
  const effectiveStart = start || new Date(now.getTime() - 90 * 86400000);
  const buckets = [];
  for (let cursor = new Date(effectiveStart); cursor <= now; cursor = new Date(cursor.getTime() + bucketDays * 86400000)) {
    const end = new Date(Math.min(now.getTime(), cursor.getTime() + bucketDays * 86400000));
    buckets.push({
      start: new Date(cursor),
      end,
      label: dateOnly(cursor),
      billed: 0,
      paid: 0,
      submitted: 0,
      denied: 0
    });
  }

  for (const claim of claims) {
    for (const bucket of buckets) {
      if (claim.createdAt >= bucket.start && claim.createdAt < bucket.end) {
        bucket.billed += billedValue(claim);
      }
      if (claim.claimSubmissionDate && claim.claimSubmissionDate >= bucket.start && claim.claimSubmissionDate < bucket.end) {
        bucket.submitted += 1;
      }
      if (claim.status === "DENIED" && claim.claimStatusCheckedAt && claim.claimStatusCheckedAt >= bucket.start && claim.claimStatusCheckedAt < bucket.end) {
        bucket.denied += 1;
      }
      if (claim.paidAmount && claim.remittanceReceivedAt && claim.remittanceReceivedAt >= bucket.start && claim.remittanceReceivedAt < bucket.end) {
        bucket.paid += Number(claim.paidAmount || 0);
      }
    }
  }

  return buckets.map((bucket) => ({
    label: bucket.label,
    billed: money(bucket.billed),
    paid: money(bucket.paid),
    submitted: bucket.submitted,
    denied: bucket.denied
  }));
}

router.get("/", async (req, res) => {
  try {
    const now = new Date();
    const range = ["30", "90", "ALL"].includes(String(req.query.range || "").toUpperCase())
      ? String(req.query.range).toUpperCase()
      : "30";
    const payer = String(req.query.payer || "").trim().slice(0, 250);
    const start = startForRange(range, now);

    const cohortWhere = {
      organizationId: req.user.organizationId,
      deletedAt: null,
      ...(start ? { createdAt: { gte: start } } : {}),
      ...(payer ? { payerName: payer } : {})
    };

    const [claims, payerOptions, denials, underpayments] = await Promise.all([
      prisma.claim.findMany({
        where: cohortWhere,
        select: {
          id: true,
          createdAt: true,
          status: true,
          payerName: true,
          amount: true,
          totalBilledAmount: true,
          allowedAmount: true,
          paidAmount: true,
          patientResponsibility: true,
          dateOfService: true,
          claimSubmissionDate: true,
          claimStatusCheckedAt: true,
          remittanceReceivedAt: true,
          eligibilityStatus: true,
          priorAuthRequired: true,
          priorAuthStatus: true
        },
        orderBy: { createdAt: "asc" }
      }),
      prisma.claim.findMany({
        where: {
          organizationId: req.user.organizationId,
          deletedAt: null,
          payerName: { not: "" }
        },
        distinct: ["payerName"],
        select: { payerName: true },
        orderBy: { payerName: "asc" }
      }),
      prisma.denialCase.findMany({
        where: {
          claim: { is: cohortWhere }
        },
        select: {
          status: true,
          denialCategory: true,
          revenueAtRisk: true,
          recoveredAmount: true,
          appealDeadline: true,
          claim: { select: { payerName: true } }
        }
      }),
      prisma.underpaymentCase.findMany({
        where: {
          claim: { is: cohortWhere }
        },
        select: {
          status: true,
          varianceAmount: true,
          recoveredAmount: true,
          reasonCategory: true,
          claim: { select: { payerName: true } }
        }
      })
    ]);

    const totalClaims = claims.length;
    const submittedClaims = claims.filter((claim) => Boolean(claim.claimSubmissionDate)).length;
    const deniedClaims = claims.filter((claim) => claim.status === "DENIED").length;
    const paidClaims = claims.filter((claim) => claim.status === "PAID").length;
    const adjudicated = deniedClaims + paidClaims;
    const denialRate = adjudicated ? (deniedClaims / adjudicated) * 100 : 0;
    const readyToSubmit = claims.filter((claim) => claim.status === "READY").length;
    const needsReview = claims.filter((claim) => ["DRAFT", "NEEDS_REVIEW"].includes(claim.status)).length;
    const eligibilityIssues = claims.filter((claim) => claim.eligibilityStatus !== "VERIFIED" && !claim.claimSubmissionDate).length;
    const priorAuthIssues = claims.filter((claim) =>
      !claim.claimSubmissionDate &&
      claim.priorAuthRequired === true &&
      !["APPROVED", "NOT_REQUIRED"].includes(claim.priorAuthStatus)
    ).length;

    const totalBilled = claims.reduce((sum, claim) => sum + billedValue(claim), 0);
    const totalPaid = claims.reduce((sum, claim) => sum + Number(claim.paidAmount || 0), 0);
    const outstanding = claims.reduce((sum, claim) => sum + outstandingValue(claim), 0);
    const recovered = [
      ...denials.map((item) => Number(item.recoveredAmount || 0)),
      ...underpayments.map((item) => Number(item.recoveredAmount || 0))
    ].reduce((sum, value) => sum + value, 0);

    const activeDenials = denials.filter((item) => ACTIVE_DENIAL_STATUSES.includes(item.status));
    const activeUnderpayments = underpayments.filter((item) => ACTIVE_UNDERPAYMENT_STATUSES.includes(item.status));
    const recoveryOutstanding =
      activeDenials.reduce((sum, item) => sum + Math.max(0, Number(item.revenueAtRisk || 0) - Number(item.recoveredAmount || 0)), 0) +
      activeUnderpayments.reduce((sum, item) => sum + Math.max(0, Number(item.varianceAmount || 0) - Number(item.recoveredAmount || 0)), 0);

    const agingMap = new Map(["0–30", "31–60", "61–90", "90+"].map((label) => [label, { label, claims: 0, amount: 0 }]));
    for (const claim of claims.filter((item) => item.claimSubmissionDate && item.status !== "PAID")) {
      const amount = outstandingValue(claim);
      if (amount <= 0) continue;
      const bucket = agingMap.get(agingBucket(ageDays(claim, now)));
      bucket.claims += 1;
      bucket.amount += amount;
    }
    const aging = [...agingMap.values()].map((item) => ({ ...item, amount: money(item.amount) }));

    const payerMap = new Map();
    for (const claim of claims) {
      const name = claim.payerName || "Unknown Payer";
      const row = payerMap.get(name) || {
        payer: name,
        claims: 0,
        submitted: 0,
        denied: 0,
        paid: 0,
        paidAmount: 0,
        paymentDays: []
      };
      row.claims += 1;
      if (claim.claimSubmissionDate) row.submitted += 1;
      if (claim.status === "DENIED") row.denied += 1;
      if (claim.status === "PAID") row.paid += 1;
      row.paidAmount += Number(claim.paidAmount || 0);
      const days = dayDiff(claim.claimSubmissionDate, claim.remittanceReceivedAt);
      if (days != null && claim.paidAmount) row.paymentDays.push(days);
      payerMap.set(name, row);
    }
    const payerPerformance = [...payerMap.values()]
      .map((row) => {
        const adjudicatedCount = row.denied + row.paid;
        return {
          payer: row.payer,
          claims: row.claims,
          submitted: row.submitted,
          denialRate: adjudicatedCount ? Math.round((row.denied / adjudicatedCount) * 1000) / 10 : 0,
          avgDaysToPay: row.paymentDays.length
            ? Math.round((row.paymentDays.reduce((sum, value) => sum + value, 0) / row.paymentDays.length) * 10) / 10
            : null,
          paidAmount: money(row.paidAmount)
        };
      })
      .sort((a, b) => b.claims - a.claims)
      .slice(0, 10);

    const denialMap = new Map();
    for (const denial of denials) {
      const label = denial.denialCategory || "UNCLASSIFIED";
      const row = denialMap.get(label) || { label, count: 0, atRisk: 0 };
      row.count += 1;
      row.atRisk += Math.max(0, Number(denial.revenueAtRisk || 0) - Number(denial.recoveredAmount || 0));
      denialMap.set(label, row);
    }
    const denialCauses = [...denialMap.values()]
      .map((row) => ({ ...row, atRisk: money(row.atRisk) }))
      .sort((a, b) => b.atRisk - a.atRisk)
      .slice(0, 6);

    res.json({
      filters: {
        range,
        payer: payer || null,
        payerOptions: payerOptions.map((item) => item.payerName).filter(Boolean)
      },
      kpis: {
        totalClaims,
        submittedClaims,
        paidClaims,
        deniedClaims,
        readyToSubmit,
        needsReview,
        totalBilled: money(totalBilled),
        totalPaid: money(totalPaid),
        outstanding: money(outstanding),
        recovered: money(recovered),
        denialRate: Math.round(denialRate * 10) / 10,
        activeRecovery: activeDenials.length + activeUnderpayments.length,
        recoveryOutstanding: money(recoveryOutstanding),
        eligibilityIssues,
        priorAuthIssues
      },
      funnel: [
        { label: "Created", value: totalClaims },
        { label: "Ready now", value: readyToSubmit },
        { label: "Submitted", value: submittedClaims },
        { label: "Denied", value: deniedClaims },
        { label: "Paid", value: paidClaims }
      ],
      aging,
      payerPerformance,
      denialCauses,
      trend: buildTrend(claims, start, now),
      methodology: {
        cohort:
          "Date range filters claims by claim creation date. Payer filters apply to the same cohort.",
        denialRate:
          "Denied claims divided by adjudicated claims (Denied + Paid) in the selected cohort. This is not a first-pass acceptance rate.",
        outstanding:
          "For unpaid claims, outstanding uses allowed amount when available, otherwise claimed/billed amount, less recorded payer payment.",
        aging:
          "A/R aging uses submission date when available, otherwise service/creation date, and excludes paid claims."
      }
    });
  } catch (error) {
    console.error("[analytics] dashboard failed", {
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({
      error: "Unable to load analytics dashboard",
      code: "ANALYTICS_DASHBOARD_FAILED"
    });
  }
});

export default router;
