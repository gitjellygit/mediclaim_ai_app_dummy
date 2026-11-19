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

const provisionSchema = z.object({
  provisionType: z.enum([
    "MODIFIER_PERCENT",
    "MULTIPLE_PROCEDURE_REDUCTION",
    "BUNDLE_EXCLUSION",
    "LESSER_OF_CHARGE",
    "UNSUPPORTED_CLAUSE"
  ]),
  parameters: z.record(z.any()),
  priority: z.number().int().min(1).max(10000).default(100),
  sourceDocumentRef: z.string().trim().min(1).max(80),
  sourcePage: z.number().int().positive().nullable().optional(),
  sourceClause: z.string().trim().max(160).nullable().optional(),
  extractionMethod: z.enum(["MANUAL", "OCR", "AI_EXTRACTED"]).default("MANUAL")
}).strict().refine(
  (item) => Boolean(item.sourcePage || item.sourceClause),
  { message: "A source page or clause is required for every contract provision" }
);

const medicareRateLineSchema = z.object({
  cptHcpcsCode: z.string().trim().min(1).max(10),
  modifier: z.string().trim().max(4).nullable().optional(),
  placeOfService: z.string().trim().max(2).nullable().optional(),
  amount: z.union([z.string(), z.number()]),
  description: z.string().trim().max(250).nullable().optional()
}).strict();

const medicareScheduleSchema = z.object({
  name: z.string().trim().min(1).max(160),
  year: z.number().int().min(2000).max(2100),
  locality: z.string().trim().min(1).max(120),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date().nullable().optional(),
  source: z.string().trim().min(1).max(250),
  notes: z.string().trim().max(2000).nullable().optional(),
  lines: z.array(medicareRateLineSchema).min(1).max(5000)
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
  pricingMethod: z.enum([
    "FEE_SCHEDULE",
    "PERCENT_MEDICARE",
    "PERCENT_CHARGE",
    "CASE_RATE",
    "PER_DIEM",
    "CAPITATION",
    "VALUE_BASED"
  ]).default("FEE_SCHEDULE"),
  referencePercent: z.union([z.string(), z.number()]).nullable().optional(),
  roundingMode: z.literal("HALF_UP").default("HALF_UP"),
  medicareRateScheduleId: z.string().trim().nullable().optional(),
  pricingSourceDocumentRef: z.string().trim().max(80).nullable().optional(),
  pricingSourcePage: z.number().int().positive().nullable().optional(),
  pricingSourceClause: z.string().trim().max(160).nullable().optional(),
  pricingExtractionMethod: z.enum(["MANUAL", "OCR", "AI_EXTRACTED"]).default("MANUAL"),
  sourceDocuments: z.array(sourceDocumentSchema).min(1).max(100),
  feeScheduleLines: z.array(feeLineSchema).max(1000).default([]),
  provisions: z.array(provisionSchema).max(250).default([])
}).strict();

router.get(
  "/medicare-schedules",
  requirePermission(PERMISSIONS.FINANCIAL_VIEW),
  async (req, res) => {
    const items = await prisma.medicareRateSchedule.findMany({
      where: { organizationId: orgId(req) },
      include: { lines: true },
      orderBy: [{ year: "desc" }, { locality: "asc" }]
    });
    res.json({ items });
  }
);

router.post(
  "/medicare-schedules",
  requirePermission(PERMISSIONS.RECOVERY_EDIT),
  async (req, res) => {
    const parsed = medicareScheduleSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid Medicare rate schedule",
        code: "INVALID_MEDICARE_RATE_SCHEDULE"
      });
    }

    const effectiveFrom = new Date(`${parsed.data.effectiveFrom}T00:00:00.000Z`);
    const effectiveTo = parsed.data.effectiveTo
      ? new Date(`${parsed.data.effectiveTo}T00:00:00.000Z`)
      : null;
    if (effectiveTo && effectiveTo < effectiveFrom) {
      return res.status(400).json({
        error: "Medicare schedule effective-to date cannot be before effective-from date",
        code: "INVALID_MEDICARE_EFFECTIVE_WINDOW"
      });
    }

    const lines = [];
    for (const line of parsed.data.lines) {
      const amount = validMoney(line.amount);
      if (amount == null || Number(amount) <= 0) {
        return res.status(400).json({
          error: "Every Medicare rate line must have a positive amount",
          code: "INVALID_MEDICARE_RATE"
        });
      }
      lines.push({
        cptHcpcsCode: line.cptHcpcsCode.toUpperCase(),
        modifier: line.modifier ? line.modifier.toUpperCase() : null,
        placeOfService: line.placeOfService || null,
        amount,
        description: line.description || null
      });
    }

    const created = await prisma.medicareRateSchedule.create({
      data: {
        organizationId: orgId(req),
        name: parsed.data.name,
        year: parsed.data.year,
        locality: parsed.data.locality,
        effectiveFrom,
        effectiveTo,
        source: parsed.data.source,
        notes: parsed.data.notes || null,
        lines: { create: lines }
      },
      include: { lines: true }
    });
    res.status(201).json(created);
  }
);

router.get(
  "/",
  requirePermission(PERMISSIONS.FINANCIAL_VIEW),
  async (req, res) => {
    const items = await prisma.payerContract.findMany({
      where: { organizationId: orgId(req) },
      include: {
        sourceDocuments: true,
        provisions: { include: { sourceDocument: true }, orderBy: { priority: "asc" } },
        medicareRateSchedule: { include: { lines: true } },
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

    const pricingMethod = parsed.data.pricingMethod;
    const referencePercent =
      parsed.data.referencePercent == null
        ? null
        : Number(parsed.data.referencePercent);

    if (
      ["PERCENT_MEDICARE", "PERCENT_CHARGE"].includes(pricingMethod) &&
      (!Number.isFinite(referencePercent) || referencePercent <= 0 || referencePercent > 1000)
    ) {
      return res.status(400).json({
        error: "A positive reference percentage up to 1000% is required",
        code: "REFERENCE_PERCENT_REQUIRED"
      });
    }

    if (pricingMethod === "PERCENT_MEDICARE" && !parsed.data.medicareRateScheduleId) {
      return res.status(400).json({
        error: "Medicare schedule is required for percentage-of-Medicare pricing",
        code: "MEDICARE_SCHEDULE_REQUIRED"
      });
    }

    if (pricingMethod === "FEE_SCHEDULE" && parsed.data.feeScheduleLines.length === 0) {
      return res.status(400).json({
        error: "Fee schedule pricing requires at least one fee line",
        code: "FEE_SCHEDULE_REQUIRED"
      });
    }

    if (
      pricingMethod !== "FEE_SCHEDULE" &&
      (
        !parsed.data.pricingSourceDocumentRef ||
        !sourceRefs.has(parsed.data.pricingSourceDocumentRef) ||
        (!parsed.data.pricingSourcePage && !parsed.data.pricingSourceClause)
      )
    ) {
      return res.status(400).json({
        error: "Percentage pricing requires source document plus page or clause provenance",
        code: "PRICING_TERM_PROVENANCE_REQUIRED"
      });
    }

    let medicareSchedule = null;
    if (pricingMethod === "PERCENT_MEDICARE") {
      medicareSchedule = await prisma.medicareRateSchedule.findFirst({
        where: {
          id: parsed.data.medicareRateScheduleId,
          organizationId: orgId(req),
          status: "ACTIVE"
        }
      });
      if (!medicareSchedule) {
        return res.status(400).json({
          error: "Medicare schedule is not available for this organization",
          code: "MEDICARE_SCHEDULE_NOT_FOUND"
        });
      }
    }

    const provisions = [];
    for (const provision of parsed.data.provisions) {
      if (!sourceRefs.has(provision.sourceDocumentRef)) {
        return res.status(400).json({
          error: "Every contract provision must reference a supplied source document",
          code: "CONTRACT_PROVISION_SOURCE_REQUIRED"
        });
      }
      provisions.push(provision);
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

      if (pricingMethod !== "FEE_SCHEDULE") {
        const pricingSource = sourceByRef.get(parsed.data.pricingSourceDocumentRef);
        await tx.payerContract.update({
          where: { id: created.id },
          data: {
            pricingMethod,
            referencePercent,
            roundingMode: parsed.data.roundingMode,
            medicareRateScheduleId:
              pricingMethod === "PERCENT_MEDICARE" ? medicareSchedule.id : null,
            pricingSourceDocumentId: pricingSource.id,
            pricingSourcePage: parsed.data.pricingSourcePage || null,
            pricingSourceClause: parsed.data.pricingSourceClause || null,
            pricingExtractionMethod: parsed.data.pricingExtractionMethod,
            pricingReviewStatus: "PENDING"
          }
        });
      }

      for (const provision of provisions) {
        await tx.contractProvision.create({
          data: {
            contractId: created.id,
            provisionType: provision.provisionType,
            parameters: provision.parameters,
            priority: provision.priority,
            sourceDocumentId: sourceByRef.get(provision.sourceDocumentRef).id,
            sourcePage: provision.sourcePage || null,
            sourceClause: provision.sourceClause || null,
            extractionMethod: provision.extractionMethod,
            reviewStatus: "PENDING"
          }
        });
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
          provisions: { include: { sourceDocument: true }, orderBy: { priority: "asc" } },
          medicareRateSchedule: { include: { lines: true } },
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
          provisionCount: complete.provisions.length,
          sourceDocumentCount: complete.sourceDocuments.length,
          sourceType: complete.sourceType
        }
      });
      return complete;
    });

    res.status(201).json(item);
  }
);

const provisionApprovalSchema = z.object({
  reviewStatus: z.enum(["APPROVED", "REJECTED"]),
  reviewNote: z.string().trim().max(1000).nullable().optional()
}).strict();

router.patch(
  "/:contractId/provisions/:provisionId/review",
  requirePermission(PERMISSIONS.RECOVERY_EDIT),
  async (req, res) => {
    const parsed = provisionApprovalSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid contract provision review",
        code: "INVALID_CONTRACT_PROVISION_REVIEW"
      });
    }

    const provision = await prisma.contractProvision.findFirst({
      where: {
        id: req.params.provisionId,
        contractId: req.params.contractId,
        contract: { organizationId: orgId(req) }
      },
      include: { sourceDocument: true }
    });
    if (!provision) {
      return res.status(404).json({ error: "Contract provision not found" });
    }

    if (
      parsed.data.reviewStatus === "APPROVED" &&
      (!provision.sourceDocumentId || (!provision.sourcePage && !provision.sourceClause))
    ) {
      return res.status(409).json({
        error: "A source document and page or clause are required before approval",
        code: "CONTRACT_PROVISION_PROVENANCE_REQUIRED"
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.contractProvision.update({
        where: { id: provision.id },
        data: {
          reviewStatus: parsed.data.reviewStatus,
          reviewedByUserId: req.user.id,
          reviewedAt: new Date()
        },
        include: { sourceDocument: true }
      });

      await writeCriticalRequestAudit(tx, req, {
        action: "PAYER_CONTRACT_PROVISION_REVIEWED",
        entityType: "ContractProvision",
        entityId: saved.id,
        metadata: {
          contractId: req.params.contractId,
          provisionType: saved.provisionType,
          reviewStatus: saved.reviewStatus,
          sourceDocumentId: saved.sourceDocumentId,
          sourcePage: saved.sourcePage,
          sourceClause: saved.sourceClause
        }
      });
      return saved;
    });

    res.json(updated);
  }
);

const pricingApprovalSchema = z.object({
  reviewStatus: z.enum(["APPROVED", "REJECTED"]),
  reviewNote: z.string().trim().max(1000).nullable().optional()
}).strict();

router.patch(
  "/:contractId/pricing/review",
  requirePermission(PERMISSIONS.RECOVERY_EDIT),
  async (req, res) => {
    const parsed = pricingApprovalSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid contract pricing review",
        code: "INVALID_CONTRACT_PRICING_REVIEW"
      });
    }

    const contract = await prisma.payerContract.findFirst({
      where: {
        id: req.params.contractId,
        organizationId: orgId(req)
      }
    });
    if (!contract) return res.status(404).json({ error: "Payer contract not found" });

    if (
      parsed.data.reviewStatus === "APPROVED" &&
      contract.pricingMethod !== "FEE_SCHEDULE" &&
      (!contract.pricingSourceDocumentId ||
        (!contract.pricingSourcePage && !contract.pricingSourceClause) ||
        (
          ["PERCENT_MEDICARE", "PERCENT_CHARGE"].includes(contract.pricingMethod) &&
          contract.referencePercent == null
        ))
    ) {
      return res.status(409).json({
        error: "Pricing provenance and reference percentage are required before approval",
        code: "CONTRACT_PRICING_PROVENANCE_REQUIRED"
      });
    }

    const updated = await prisma.payerContract.update({
      where: { id: contract.id },
      data: {
        pricingReviewStatus: parsed.data.reviewStatus,
        pricingReviewedByUserId: req.user.id,
        pricingReviewedAt: new Date(),
        notes: parsed.data.reviewNote
          ? [contract.notes, `Pricing review: ${parsed.data.reviewNote}`].filter(Boolean).join(" | ").slice(0, 2000)
          : contract.notes
      }
    });
    res.json(updated);
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
