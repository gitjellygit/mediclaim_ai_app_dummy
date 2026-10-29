import express from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { PERMISSIONS } from "../security/permissions.js";
import { writeCriticalRequestAudit } from "../services/auditLog.js";

const router = express.Router();

const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["CARD", "CASH", "CHECK", "HSA_FSA", "ACH", "OTHER"]),
  reference: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional()
}).strict();

const balanceUpdateSchema = z.object({
  statementStatus: z.enum(["NOT_SENT", "SENT"]).optional(),
  paymentPlanStatus: z.enum(["NONE", "ACTIVE", "COMPLETED", "DEFAULTED"]).optional(),
  notes: z.string().trim().max(1000).nullable().optional()
}).strict();

const orgId = (req) => req.user.organizationId;

function serialize(balance) {
  if (!balance) return null;
  const toNumber = (value) => value == null ? null : Number(value);
  return {
    ...balance,
    totalCharges: toNumber(balance.totalCharges),
    insuranceResponsibility: toNumber(balance.insuranceResponsibility),
    patientResponsibility: toNumber(balance.patientResponsibility),
    paidAmount: toNumber(balance.paidAmount),
    balanceAmount: toNumber(balance.balanceAmount),
    payments: (balance.payments || []).map((payment) => ({
      ...payment,
      amount: toNumber(payment.amount)
    }))
  };
}

router.get("/", requirePermission(PERMISSIONS.FINANCIAL_VIEW), async (req, res) => {
  const q = String(req.query.q || "").trim();
  const status = String(req.query.status || "").trim();
  const items = await prisma.patientBalance.findMany({
    where: {
      organizationId: orgId(req),
      ...(status && status !== "ALL" ? { status } : {}),
      ...(q ? {
        OR: [
          { patientName: { contains: q, mode: "insensitive" } },
          { medicalRecordNumber: { contains: q, mode: "insensitive" } },
          { externalEncounterId: { contains: q, mode: "insensitive" } }
        ]
      } : {})
    },
    include: {
      payments: { orderBy: { paidAt: "desc" }, take: 5 }
    },
    orderBy: { updatedAt: "desc" },
    take: 200
  });
  res.json({ items: items.map(serialize) });
});

router.get("/:id", requirePermission(PERMISSIONS.FINANCIAL_VIEW), async (req, res) => {
  const item = await prisma.patientBalance.findFirst({
    where: { id: req.params.id, organizationId: orgId(req) },
    include: { payments: { orderBy: { paidAt: "desc" } } }
  });
  if (!item) return res.status(404).json({ error: "Patient balance not found" });
  res.json(serialize(item));
});

router.post("/:id/payments", requirePermission(PERMISSIONS.FINANCIAL_EDIT), async (req, res) => {
  const parsed = paymentSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid patient payment", code: "INVALID_PATIENT_PAYMENT" });
  }

  const result = await prisma.$transaction(async (tx) => {
    const balance = await tx.patientBalance.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) }
    });
    if (!balance) return null;

    const currentPaid = Number(balance.paidAmount || 0);
    const responsibility = Number(balance.patientResponsibility || 0);
    const amount = Number(parsed.data.amount);
    const nextPaid = currentPaid + amount;
    if (nextPaid > responsibility + 0.005) {
      const error = new Error("Payment exceeds the remaining patient balance");
      error.status = 409;
      error.code = "PATIENT_PAYMENT_EXCEEDS_BALANCE";
      throw error;
    }

    const remaining = Math.max(0, responsibility - nextPaid);
    const status = remaining <= 0.005 ? "PAID" : nextPaid > 0 ? "PARTIALLY_PAID" : "UNPAID";

    const payment = await tx.patientPayment.create({
      data: {
        organizationId: orgId(req),
        patientBalanceId: balance.id,
        recordedById: req.user.id,
        amount,
        method: parsed.data.method,
        reference: parsed.data.reference || null,
        notes: parsed.data.notes || null
      }
    });

    const updated = await tx.patientBalance.update({
      where: { id: balance.id },
      data: { paidAmount: nextPaid, balanceAmount: remaining, status },
      include: { payments: { orderBy: { paidAt: "desc" } } }
    });

    await writeCriticalRequestAudit(tx, req, {
      action: "PATIENT_PAYMENT_RECORDED",
      entityType: "PatientBalance",
      entityId: balance.id,
      metadata: { status, sourceType: balance.sourceType }
    });

    return { balance: updated, payment };
  });

  if (!result) return res.status(404).json({ error: "Patient balance not found" });
  res.status(201).json({ balance: serialize(result.balance), payment: { ...result.payment, amount: Number(result.payment.amount) } });
});

router.patch("/:id", requirePermission(PERMISSIONS.FINANCIAL_EDIT), async (req, res) => {
  const parsed = balanceUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid patient balance update", code: "INVALID_PATIENT_BALANCE_UPDATE" });
  }
  const existing = await prisma.patientBalance.findFirst({
    where: { id: req.params.id, organizationId: orgId(req) }
  });
  if (!existing) return res.status(404).json({ error: "Patient balance not found" });

  const updated = await prisma.patientBalance.update({
    where: { id: existing.id },
    data: parsed.data,
    include: { payments: { orderBy: { paidAt: "desc" } } }
  });

  await writeCriticalRequestAudit(prisma, req, {
    action: "PATIENT_BALANCE_UPDATED",
    entityType: "PatientBalance",
    entityId: updated.id,
    metadata: { status: updated.status, sourceType: updated.sourceType }
  });

  res.json(serialize(updated));
});

export default router;
