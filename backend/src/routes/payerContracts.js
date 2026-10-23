import express from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { PERMISSIONS } from "../security/permissions.js";
import { writeCriticalRequestAudit, writeRequestAudit } from "../services/auditLog.js";
import { validMoney } from "../utils/money.js";

const router = express.Router();
const orgId = (req) => req.user.organizationId;

const feeLineSchema = z.object({
  cptHcpcsCode: z.string().trim().min(1).max(10),
  modifier: z.string().trim().max(4).nullable().optional(),
  placeOfService: z.string().trim().max(2).nullable().optional(),
  unitRate: z.union([z.string(), z.number()]),
  description: z.string().trim().max(250).nullable().optional()
}).strict();

const contractSchema = z.object({
  name: z.string().trim().min(1).max(160),
  payerName: z.string().trim().max(250).nullable().optional(),
  payerEdiId: z.string().trim().max(100).nullable().optional(),
  version: z.string().trim().min(1).max(80),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date().nullable().optional(),
  sourceType: z.enum(["MANUAL", "IMPORTED"]).default("MANUAL"),
  notes: z.string().trim().max(2000).nullable().optional(),
  feeScheduleLines: z.array(feeLineSchema).min(1).max(1000)
}).strict();

router.get(
  "/",
  requirePermission(PERMISSIONS.FINANCIAL_VIEW),
  async (req, res) => {
    const items = await prisma.payerContract.findMany({
      where: { organizationId: orgId(req) },
      include: { feeScheduleLines: true },
      orderBy: [{ status: "asc" }, { effectiveFrom: "desc" }]
    });
    await writeRequestAudit(prisma, req, {
      action: "PAYER_CONTRACTS_VIEWED",
      entityType: "PayerContract",
      metadata: { count: items.length }
    });
    res.json({ items });
  }
);

router.post(
  "/",
  requirePermission(PERMISSIONS.RECOVERY_EDIT),
  async (req, res) => {
    const parsed = contractSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid payer contract",
        code: "INVALID_PAYER_CONTRACT"
      });
    }

    if (!parsed.data.payerName && !parsed.data.payerEdiId) {
      return res.status(400).json({
        error: "Payer name or payer EDI ID is required",
        code: "PAYER_IDENTITY_REQUIRED"
      });
    }

    const effectiveFrom = new Date(`${parsed.data.effectiveFrom}T00:00:00.000Z`);
    const effectiveTo = parsed.data.effectiveTo
      ? new Date(`${parsed.data.effectiveTo}T00:00:00.000Z`)
      : null;
    if (effectiveTo && effectiveTo < effectiveFrom) {
      return res.status(400).json({
        error: "Contract effective-to date cannot be before effective-from date",
        code: "INVALID_CONTRACT_EFFECTIVE_WINDOW"
      });
    }

    const lines = [];
    for (const line of parsed.data.feeScheduleLines) {
      const rate = validMoney(line.unitRate);
      if (rate == null || Number(rate) <= 0) {
        return res.status(400).json({
          error: "Every fee schedule line must have a positive unit rate",
          code: "INVALID_FEE_SCHEDULE_RATE"
        });
      }
      lines.push({
        cptHcpcsCode: line.cptHcpcsCode.toUpperCase(),
        modifier: line.modifier ? line.modifier.toUpperCase() : null,
        placeOfService: line.placeOfService || null,
        unitRate: rate,
        description: line.description || null
      });
    }

    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.payerContract.create({
        data: {
          organizationId: orgId(req),
          name: parsed.data.name,
          payerName: parsed.data.payerName || null,
          payerEdiId: parsed.data.payerEdiId || null,
          version: parsed.data.version,
          effectiveFrom,
          effectiveTo,
          sourceType: parsed.data.sourceType,
          notes: parsed.data.notes || null,
          feeScheduleLines: { create: lines }
        },
        include: { feeScheduleLines: true }
      });

      await writeCriticalRequestAudit(tx, req, {
        action: "PAYER_CONTRACT_CREATED",
        entityType: "PayerContract",
        entityId: created.id,
        metadata: {
          payerContractVersion: created.version,
          feeScheduleLineCount: created.feeScheduleLines.length,
          sourceType: created.sourceType
        }
      });
      return created;
    });

    res.status(201).json(item);
  }
);

export default router;
