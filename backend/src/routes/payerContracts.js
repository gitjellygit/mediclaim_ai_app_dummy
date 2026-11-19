import express from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { PERMISSIONS } from "../security/permissions.js";
import { writeCriticalRequestAudit, writeRequestAudit } from "../services/auditLog.js";
import { validMoney } from "../utils/money.js";

const router = express.Router();
const orgId = (req) => req.user.organizationId;

const sourceDocumentSchema = z.object({
  ref: z.string().trim().min(1).max(80),
  documentType: z.enum(["CONTRACT", "SCHEDULE", "AMENDMENT"]),
  fileName: z.string().trim().min(1).max(255),
  storageReference: z.string().trim().min(1).max(500),
  checksum: z.string().trim().max(128).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional()
}).strict();

const feeLineSchema = z.object({
  cptHcpcsCode: z.string().trim().min(1).max(10),
  modifier: z.string().trim().max(4).nullable().optional(),
  placeOfService: z.string().trim().max(2).nullable().optional(),
  unitRate: z.union([z.string(), z.number()]),
  description: z.string().trim().max(250).nullable().optional(),
  sourceDocumentRef: z.string().trim().min(1).max(80),
  sourcePage: z.number().int().positive().nullable().optional(),
  sourceClause: z.string().trim().max(160).nullable().optional(),
  extractionMethod: z.enum(["MANUAL", "OCR", "AI_EXTRACTED"]).default("MANUAL")
}).strict().refine(
  (line) => Boolean(line.sourcePage || line.sourceClause),
  { message: "A source page or clause is required for every fee term" }
);

const contractSchema = z.object({
  name: z.string().trim().min(1).max(160),
  payerName: z.string().trim().max(250).nullable().optional(),
  payerEdiId: z.string().trim().max(100).nullable().optional(),
  version: z.string().trim().min(1).max(80),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date().nullable().optional(),
  sourceType: z.enum(["MANUAL", "IMPORTED"]).default("MANUAL"),
  notes: z.string().trim().max(2000).nullable().optional(),
  sourceDocuments: z.array(sourceDocumentSchema).min(1).max(100),
  feeScheduleLines: z.array(feeLineSchema).min(1).max(1000)
}).strict();

router.get(
  "/",
  requirePermission(PERMISSIONS.FINANCIAL_VIEW),
  async (req, res) => {
    const items = await prisma.payerContract.findMany({
      where: { organizationId: orgId(req) },
      include: {
        sourceDocuments: true,
        feeScheduleLines: { include: { sourceDocument: true } }
      },
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

    const sourceRefs = new Set(parsed.data.sourceDocuments.map((doc) => doc.ref));
    if (sourceRefs.size !== parsed.data.sourceDocuments.length) {
      return res.status(400).json({
        error: "Contract source document refs must be unique",
        code: "DUPLICATE_CONTRACT_SOURCE_REF"
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
      if (!sourceRefs.has(line.sourceDocumentRef)) {
        return res.status(400).json({
          error: "Every fee schedule line must reference a supplied contract source document",
          code: "CONTRACT_TERM_SOURCE_REQUIRED"
        });
      }
      lines.push({
        cptHcpcsCode: line.cptHcpcsCode.toUpperCase(),
        modifier: line.modifier ? line.modifier.toUpperCase() : null,
        placeOfService: line.placeOfService || null,
        unitRate: rate,
        description: line.description || null,
        sourceDocumentRef: line.sourceDocumentRef,
        sourcePage: line.sourcePage || null,
        sourceClause: line.sourceClause || null,
        extractionMethod: line.extractionMethod
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
          notes: parsed.data.notes || null
        }
      });

      const sourceByRef = new Map();
      for (const source of parsed.data.sourceDocuments) {
        const stored = await tx.contractSourceDocument.create({
          data: {
            contractId: created.id,
            documentType: source.documentType,
            fileName: source.fileName,
            storageReference: source.storageReference,
            checksum: source.checksum || null,
            notes: source.notes || null
          }
        });
        sourceByRef.set(source.ref, stored);
      }

      for (const line of lines) {
        await tx.feeScheduleLine.create({
          data: {
            contractId: created.id,
            cptHcpcsCode: line.cptHcpcsCode,
            modifier: line.modifier,
            placeOfService: line.placeOfService,
            unitRate: line.unitRate,
            description: line.description,
            sourceDocumentId: sourceByRef.get(line.sourceDocumentRef).id,
            sourcePage: line.sourcePage,
            sourceClause: line.sourceClause,
            extractionMethod: line.extractionMethod,
            reviewStatus: "PENDING"
          }
        });
      }

      const complete = await tx.payerContract.findUnique({
        where: { id: created.id },
        include: {
          sourceDocuments: true,
          feeScheduleLines: { include: { sourceDocument: true } }
        }
      });

      await writeCriticalRequestAudit(tx, req, {
        action: "PAYER_CONTRACT_CREATED",
        entityType: "PayerContract",
        entityId: created.id,
        metadata: {
          payerContractVersion: created.version,
          feeScheduleLineCount: complete.feeScheduleLines.length,
          sourceDocumentCount: complete.sourceDocuments.length,
          sourceType: complete.sourceType
        }
      });
      return complete;
    });

    res.status(201).json(item);
  }
);

const approvalSchema = z.object({
  reviewStatus: z.enum(["APPROVED", "REJECTED"]),
  reviewNote: z.string().trim().max(1000).nullable().optional()
}).strict();

router.patch(
  "/:contractId/terms/:termId/review",
  requirePermission(PERMISSIONS.RECOVERY_EDIT),
  async (req, res) => {
    const parsed = approvalSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid contract term review",
        code: "INVALID_CONTRACT_TERM_REVIEW"
      });
    }

    const term = await prisma.feeScheduleLine.findFirst({
      where: {
        id: req.params.termId,
        contractId: req.params.contractId,
        contract: { organizationId: orgId(req) }
      },
      include: { sourceDocument: true, contract: true }
    });
    if (!term) {
      return res.status(404).json({ error: "Contract term not found" });
    }

    if (
      parsed.data.reviewStatus === "APPROVED" &&
      (!term.sourceDocumentId || (!term.sourcePage && !term.sourceClause))
    ) {
      return res.status(409).json({
        error: "A source document and page or clause are required before approval",
        code: "CONTRACT_TERM_PROVENANCE_REQUIRED"
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.feeScheduleLine.update({
        where: { id: term.id },
        data: {
          reviewStatus: parsed.data.reviewStatus,
          reviewedByUserId: req.user.id,
          reviewedAt: new Date(),
          description: parsed.data.reviewNote
            ? [term.description, `Review: ${parsed.data.reviewNote}`].filter(Boolean).join(" | ").slice(0, 250)
            : term.description
        },
        include: { sourceDocument: true }
      });

      await writeCriticalRequestAudit(tx, req, {
        action: "PAYER_CONTRACT_TERM_REVIEWED",
        entityType: "FeeScheduleLine",
        entityId: saved.id,
        metadata: {
          contractId: term.contractId,
          reviewStatus: saved.reviewStatus,
          sourceDocumentId: saved.sourceDocumentId,
          sourcePage: saved.sourcePage,
          sourceClause: saved.sourceClause,
          extractionMethod: saved.extractionMethod
        }
      });
      return saved;
    });

    res.json(updated);
  }
);

export default router;
