import express from "express";
import { prisma } from "../db.js";
import { moneyCents, moneyFromCents, validMoney } from "../utils/money.js";
import {
  assertUnderpaymentTransition,
  expectedPaymentFromClaim
} from "../services/underpaymentRecovery.js";

const router = express.Router();
const MANAGER_ROLES = new Set(["ADMIN", "CASHIER"]);
const ACTIVE_STATUSES = [
  "OPEN",
  "REVIEWING",
  "DISPUTE_PREPARED",
  "DISPUTE_SUBMITTED"
];

function requireManager(req, res, next) {
  if (!req.user || !MANAGER_ROLES.has(req.user.role)) {
    return res.status(403).json({
      error: "Only ADMIN or CASHIER users can modify underpayment recovery cases."
    });
  }
  next();
}

async function audit(req, claimId, action, entityId, metadata = {}) {
  try {
    await prisma.auditEvent.create({
      data: {
        organizationId: req.user.organizationId,
        claimId,
        actorUserId: req.user?.id || null,
        action,
        entityType: "UnderpaymentCase",
        entityId,
        outcome: "SUCCESS",
        metadata
      }
    });
  } catch (error) {
    console.error("[audit] underpayment event failed", {
      claimId,
      action,
      name: error?.name || "Error"
    });
  }
}

function serializeCase(item) {
  return {
    ...item,
    expectedPayerPayment: Number(item.expectedPayerPayment || 0),
    actualPaidAmount: Number(item.actualPaidAmount || 0),
    varianceAmount: Number(item.varianceAmount || 0),
    recoveredAmount: Number(item.recoveredAmount || 0),
    outstandingAmount: Math.max(
      0,
      Number(item.varianceAmount || 0) - Number(item.recoveredAmount || 0)
    )
  };
}

router.get("/", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim().toUpperCase();
    const cases = await prisma.underpaymentCase.findMany({
      where: {
        claim: {
          is: {
            organizationId: req.user.organizationId,
            deletedAt: null,
            ...(q
              ? {
                  OR: [
                    { patientName: { contains: q, mode: "insensitive" } },
                    { payerName: { contains: q, mode: "insensitive" } },
                    { insurerClaimNo: { contains: q, mode: "insensitive" } },
                    { memberId: { contains: q, mode: "insensitive" } }
                  ]
                }
              : {})
          }
        },
        ...(status && status !== "ALL" ? { status } : {})
      },
      include: {
        claim: {
          select: {
            id: true,
            patientName: true,
            payerName: true,
            insurerClaimNo: true,
            memberId: true,
            amount: true,
            allowedAmount: true,
            patientResponsibility: true,
            paymentReference: true,
            remittanceReceivedAt: true
          }
        }
      },
      orderBy: { updatedAt: "desc" }
    });

    const metricRows = await prisma.underpaymentCase.findMany({
      where: {
        claim: { is: { organizationId: req.user.organizationId, deletedAt: null } }
      },
      select: {
        status: true,
        varianceAmount: true,
        recoveredAmount: true
      }
    });

    let varianceCents = 0n;
    let recoveredCents = 0n;
    let outstandingCents = 0n;
    let activeCases = 0;
    for (const item of metricRows) {
      const variance = moneyCents(item.varianceAmount || 0);
      const recovered = moneyCents(item.recoveredAmount || 0);
      varianceCents += variance;
      recoveredCents += recovered;
      outstandingCents += variance > recovered ? variance - recovered : 0n;
      if (ACTIVE_STATUSES.includes(item.status)) activeCases += 1;
    }

    const totalVariance = Number(moneyFromCents(varianceCents));
    const recoveredAmount = Number(moneyFromCents(recoveredCents));
    const outstandingAmount = Number(moneyFromCents(outstandingCents));
    const recoveryRate =
      totalVariance > 0 ? Math.round((recoveredAmount / totalVariance) * 1000) / 10 : 0;

    res.json({
      items: cases.map(serializeCase),
      metrics: {
        activeCases,
        totalCases: metricRows.length,
        totalVariance,
        recoveredAmount,
        outstandingAmount,
        recoveryRate
      }
    });
  } catch (error) {
    console.error("[underpayments] list failed", { name: error?.name || "Error" });
    res.status(500).json({ error: "Unable to load underpayment cases" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const item = await prisma.underpaymentCase.findFirst({
      where: {
        id: req.params.id,
        claim: { organizationId: req.user.organizationId, deletedAt: null }
      },
      include: { claim: true }
    });
    if (!item) return res.status(404).json({ error: "Underpayment case not found" });
    res.json(serializeCase(item));
  } catch (error) {
    console.error("[underpayments] get failed", { id: req.params.id, name: error?.name || "Error" });
    res.status(500).json({ error: "Unable to load underpayment case" });
  }
});

router.post("/detect/:claimId", requireManager, async (req, res) => {
  try {
    const claim = await prisma.claim.findFirst({
      where: {
        id: req.params.claimId,
        organizationId: req.user.organizationId,
        deletedAt: null
      },
      include: {
        payerTransactions: { orderBy: { createdAt: "desc" } }
      }
    });
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    if (claim.remittanceStatus !== "POSTED") {
      return res.status(409).json({ error: "Posted remittance is required before underpayment detection" });
    }

    const detected = expectedPaymentFromClaim(claim);
    if (!detected) {
      return res.status(409).json({ error: "Expected and actual payer payment are required" });
    }
    if (!detected.hasUnderpayment) {
      return res.json({ detected: false, message: "No payer underpayment detected", variance: detected });
    }

    const item = await prisma.underpaymentCase.upsert({
      where: { claimId: claim.id },
      create: {
        claimId: claim.id,
        expectedPayerPayment: detected.expectedPayerPayment,
        actualPaidAmount: detected.actualPaidAmount,
        varianceAmount: detected.varianceAmount,
        sourceTransactionId: detected.sourceTransactionId
      },
      update: {
        expectedPayerPayment: detected.expectedPayerPayment,
        actualPaidAmount: detected.actualPaidAmount,
        varianceAmount: detected.varianceAmount,
        sourceTransactionId: detected.sourceTransactionId
      }
    });

    await audit(req, claim.id, "UNDERPAYMENT_DETECTED", item.id, {
      varianceAmount: detected.varianceAmount,
      sourceTransactionId: detected.sourceTransactionId
    });

    res.status(201).json({ detected: true, item: serializeCase(item) });
  } catch (error) {
    console.error("[underpayments] detect failed", {
      claimId: req.params.claimId,
      name: error?.name || "Error"
    });
    res.status(error.status || 500).json({
      error: error.status ? error.message : "Unable to detect underpayment"
    });
  }
});

router.patch("/:id", requireManager, async (req, res) => {
  try {
    const existing = await prisma.underpaymentCase.findFirst({
      where: {
        id: req.params.id,
        claim: { organizationId: req.user.organizationId, deletedAt: null }
      }
    });
    if (!existing) return res.status(404).json({ error: "Underpayment case not found" });

    const nextStatus = req.body.status
      ? String(req.body.status).toUpperCase()
      : existing.status;
    assertUnderpaymentTransition(existing.status, nextStatus);

    let recoveredAmount;
    if (req.body.recoveredAmount !== undefined) {
      const parsed = validMoney(req.body.recoveredAmount);
      if (parsed == null || Number(parsed) > Number(existing.varianceAmount)) {
        return res.status(400).json({
          error: "Recovered amount must be between $0.00 and the detected variance"
        });
      }
      recoveredAmount = parsed;
    }

    const resolved =
      ["RECOVERED", "WRITTEN_OFF", "CLOSED"].includes(nextStatus);

    const updated = await prisma.underpaymentCase.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        recoveredAmount,
        notes:
          req.body.notes !== undefined
            ? String(req.body.notes || "").trim().slice(0, 2000) || null
            : undefined,
        reasonCategory:
          req.body.reasonCategory !== undefined
            ? String(req.body.reasonCategory || "").trim().toUpperCase().slice(0, 100) || null
            : undefined,
        resolvedAt: resolved ? existing.resolvedAt || new Date() : null
      }
    });

    await audit(req, existing.claimId, "UNDERPAYMENT_CASE_UPDATED", existing.id, {
      status: updated.status,
      recoveredAmount: Number(updated.recoveredAmount || 0)
    });

    res.json(serializeCase(updated));
  } catch (error) {
    console.error("[underpayments] update failed", {
      id: req.params.id,
      name: error?.name || "Error"
    });
    res.status(error.status || 500).json({
      error: error.status ? error.message : "Unable to update underpayment case"
    });
  }
});

export default router;
