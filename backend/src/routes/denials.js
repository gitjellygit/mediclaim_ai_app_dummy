import fs from "node:fs";
import { validMoney, differenceMoney, moneyCents, moneyFromCents } from "../utils/money.js";
import express from "express";
import { assertDenialTransition } from "../services/workflowStateMachine.js";
import { prisma } from "../db.js";
import { analyzeDenial } from "../services/denialIntelligence.js";
import { writeRequestAudit } from "../services/auditLog.js";
import { requirePermission } from "../middleware/auth.js";
import { PERMISSIONS } from "../security/permissions.js";
import { createDocumentUpload } from "../services/documentUpload.js";
import { verifyUploadSignature } from "../middleware/uploadSafety.js";
import {
  documentCreateData,
  findDuplicateDocument,
  inspectUploadedDocument
} from "../services/documentProcessing.js";
import {
  deleteStoredObject,
  persistUploadedDocument
} from "../services/documentStorage.js";
import { validateDocumentIdentityAgainstClaim } from "../services/documentIdentity.js";
import { publicDocument } from "../services/documentPublicView.js";
import { DOC_TYPES } from "../services/docIntel.js";
import {
  DEFAULT_APPEAL_WINDOW_DAYS,
  computeAppealDeadline,
  enrichDenialCase,
  interpretDenialCodes,
  parseAppealWindowDays
} from "../services/denialCodes.js";

const router = express.Router();
const appealUploadDir = process.env.UPLOAD_DIR || "uploads";
const appealUpload = createDocumentUpload(appealUploadDir);
const APPEAL_RATIONALE_MIN_CHARS = 50;
const APPEAL_SUBMISSION_CHANNELS = new Set([
  "PAYER_PORTAL",
  "CLEARINGHOUSE",
  "FAX",
  "MAIL",
  "OTHER"
]);
const APPEAL_LOCKED_STATUSES = new Set([
  "APPEAL_SUBMITTED",
  "OVERTURNED",
  "UPHELD",
  "CLOSED"
]);

const DENIAL_SOURCES = new Set(["MANUAL", "PAYER_STATUS", "SIMULATED_PAYER_STATUS", "ERA"]);
router.use(requirePermission(PERMISSIONS.DENIAL_VIEW));

const ACTIVE_STATUSES = [
  "OPEN",
  "ANALYZED",
  "CORRECTION_REQUIRED",
  "APPEAL_PREPARED",
  "APPEAL_SUBMITTED",
  "RESUBMITTED"
];

async function audit(req, {
  claimId = null,
  action,
  entityType,
  entityId = null,
  outcome = "SUCCESS",
  metadata = {}
}) {
  return writeRequestAudit(prisma, req, {
    claimId,
    action,
    entityType,
    entityId,
    outcome,
    metadata
  });
}

function parseOptionalDate(value, fieldName) {
  if (value == null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error(`${fieldName} is invalid`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function parseOptionalMoney(value, fieldName) {
  if (value == null || value === "") return null;
  const parsed = validMoney(value);
  if (parsed == null) {
    const error = new Error(`${fieldName} must be non-negative with at most two decimal places`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function revenueAtRiskForClaim(claim) {
  const claimed = Number(claim.amount || 0);
  const paid = Number(claim.paidAmount || 0);
  const allowed = Number(claim.allowedAmount || 0);

  if (claimed <= 0) return 0;
  if (paid > 0) return Math.max(0, differenceMoney(claim.amount, claim.paidAmount));
  if (allowed > 0) return Math.max(0, differenceMoney(claim.amount, claim.allowedAmount));
  return claimed;
}

/**
 * List denial cases. Search is server-side and intentionally capped.
 * Free-text payer denial reason is not included in search logs.
 */
router.get("/", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim().toUpperCase();
    const requestedLimit = Number(req.query.limit || 100);
    const limit = Math.max(
      1,
      Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 100, 250)
    );

    const where = {
      claim: { is: { organizationId: req.user.organizationId, deletedAt: null } },
      ...(status && status !== "ALL" ? { status } : {}),
      ...(q
        ? {
            OR: [
              { denialCategory: { contains: q, mode: "insensitive" } },
              { carcCode: { contains: q, mode: "insensitive" } },
              { rarcCode: { contains: q, mode: "insensitive" } },
              {
                claim: {
                  is: {
                    OR: [
                      { patientName: { contains: q, mode: "insensitive" } },
                      { payerName: { contains: q, mode: "insensitive" } },
                      { policyNo: { contains: q, mode: "insensitive" } },
                      { memberId: { contains: q, mode: "insensitive" } },
                      { insurerClaimNo: { contains: q, mode: "insensitive" } }
                    ]
                  }
                }
              }
            ]
          }
        : {})
    };

    const cases = await prisma.denialCase.findMany({
      where,
      include: {
        claim: {
          select: {
            id: true,
            patientName: true,
            payerName: true,
            policyNo: true,
            memberId: true,
            insurerClaimNo: true,
            amount: true,
            allowedAmount: true,
            paidAmount: true,
            payerClaimStatus: true,
            status: true
          }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: limit
    });

    const metricsSource = await prisma.denialCase.findMany({
      where: {
        status: { in: ACTIVE_STATUSES },
        claim: { is: { organizationId: req.user.organizationId, deletedAt: null } }
      },
      select: {
        revenueAtRisk: true,
        appealEligible: true,
        recoveredAmount: true,
        denialCategory: true,
        appealDeadline: true
      }
    });

    const categories = {};
    let revenueAtRiskCents = 0n;
    let appealEligible = 0;
    let recoveredAmountCents = 0n;

    for (const item of metricsSource) {
      revenueAtRiskCents += moneyCents(item.revenueAtRisk || 0);
      recoveredAmountCents += moneyCents(item.recoveredAmount || 0);
      if (item.appealEligible === true) appealEligible += 1;
      const category = item.denialCategory || "UNCLASSIFIED";
      categories[category] = (categories[category] || 0) + 1;
    }

    const revenueAtRisk = Number(moneyFromCents(revenueAtRiskCents));
    const recoveredAmount = Number(moneyFromCents(recoveredAmountCents));
    const enrichedCases = cases.map(enrichDenialCase);
    const activeDeadlineStates = metricsSource.map((item) => enrichDenialCase(item).deadline);
    const overdueAppeals = activeDeadlineStates.filter((item) => item?.state === "OVERDUE").length;
    const appealsDueSoon = activeDeadlineStates.filter((item) => item?.state === "DUE_SOON").length;

    const topCategory =
      Object.entries(categories).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

    res.json({
      items: enrichedCases,
      metrics: {
        openCases: metricsSource.length,
        revenueAtRisk,
        appealEligible,
        recoveredAmount,
        topCategory,
        overdueAppeals,
        appealsDueSoon
      }
    });
  } catch (error) {
    console.error("[denials] list failed", { message: error.message });
    res.status(500).json({ error: "Unable to load denial cases" });
  }
});


router.get(
  "/:id/appeal-workspace",
  requirePermission(PERMISSIONS.RECOVERY_VIEW),
  async (req, res) => {
    try {
      const denial = await prisma.denialCase.findFirst({
        where: {
          id: req.params.id,
          claim: {
            organizationId: req.user.organizationId,
            deletedAt: null
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
          reasonText: true,
          denialDate: true,
          correctable: true,
          appealEligible: true,
          appealDeadline: true,
          revenueAtRisk: true,
          recoveredAmount: true,
          assessmentOverrideReason: true,
          assessmentOverriddenAt: true,
          appealRationale: true,
          appealEvidenceDocumentIds: true,
          appealPreparedAt: true,
          appealSubmittedAt: true,
          appealSubmissionReference: true,
          appealSubmissionChannel: true,
          appealExternalSubmittedAt: true,
          recommendedAction: true,
          requiredDocuments: true,
          aiExplanation: true,
          aiConfidence: true,
          aiProvider: true,
          aiModel: true,
          aiAnalyzedAt: true,
          claim: {
            select: {
              patientName: true,
              payerName: true,
              insurerClaimNo: true,
              patientControlNumber: true,
              amount: true,
              allowedAmount: true,
              paidAmount: true,
              patientResponsibility: true,
              dateOfService: true,
              authorizationNo: true,
              priorAuthStatus: true,
              eligibilityStatus: true,
              claimForm: true,
              documents: {
                select: {
                  id: true,
                  type: true,
                  fileName: true,
                  verified: true,
                  status: true,
                  createdAt: true,
                  appealCaseId: true
                },
                orderBy: { createdAt: "desc" }
              }
            }
          }
        }
      });

      if (!denial) {
        return res.status(404).json({ error: "Denial case not found" });
      }

      await audit(req, {
        claimId: denial.claimId,
        action: "APPEAL_WORKSPACE_VIEWED",
        entityType: "DenialCase",
        entityId: denial.id
      });

      res.json({
        ...denial,
        revenueAtRisk: Number(denial.revenueAtRisk || 0),
        recoveredAmount: Number(denial.recoveredAmount || 0),
        claim: {
          ...denial.claim,
          amount: Number(denial.claim.amount || 0),
          allowedAmount:
            denial.claim.allowedAmount == null
              ? null
              : Number(denial.claim.allowedAmount),
          paidAmount:
            denial.claim.paidAmount == null
              ? null
              : Number(denial.claim.paidAmount),
          patientResponsibility:
            denial.claim.patientResponsibility == null
              ? null
              : Number(denial.claim.patientResponsibility)
        }
      });
    } catch (error) {
      console.error("[appeal-workspace] get failed", {
        denialId: req.params.id,
        name: error?.name || "Error"
      });
      res.status(500).json({ error: "Unable to load appeal workspace" });
    }
  }
);

router.post(
  "/:id/appeal-evidence",
  requirePermission(PERMISSIONS.RECOVERY_EDIT),
  requirePermission(PERMISSIONS.DOCUMENT_EDIT),
  appealUpload.single("file"),
  verifyUploadSignature,
  async (req, res) => {
    let storedDocumentPath = null;
    try {
      const existing = await prisma.denialCase.findFirst({
        where: {
          id: req.params.id,
          claim: {
            organizationId: req.user.organizationId,
            deletedAt: null
          }
        },
        include: { claim: true }
      });
      if (!existing) {
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: "Denial case not found" });
      }
      if (APPEAL_LOCKED_STATUSES.has(existing.status)) {
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(409).json({
          error: "Submitted or closed appeals cannot accept new evidence"
        });
      }
      if (!req.file) {
        return res.status(400).json({ error: "File is required" });
      }

      const requestedType = req.body?.type
        ? String(req.body.type).toUpperCase()
        : null;
      if (requestedType && !DOC_TYPES.includes(requestedType)) {
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({
          error: "Document type is not supported",
          code: "INVALID_DOCUMENT_TYPE"
        });
      }

      const { fileHash, intel } = await inspectUploadedDocument(req.file);
      const duplicate = await findDuplicateDocument(
        prisma,
        existing.claimId,
        fileHash
      );
      if (duplicate) {
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(409).json({
          error: "This document is already attached to the claim. Select the existing document instead.",
          code: "DOCUMENT_DUPLICATE",
          documentId: duplicate.id
        });
      }

      const identityValidation = validateDocumentIdentityAgainstClaim(
        existing.claim,
        intel.extracted
      );
      if (identityValidation.status === "MISMATCH") {
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(409).json({
          error: "The uploaded evidence conflicts with this claim's patient identity.",
          code: "DOCUMENT_PATIENT_MISMATCH"
        });
      }

      storedDocumentPath = await persistUploadedDocument(req.file, {
        organizationId: req.user.organizationId,
        claimId: existing.claimId,
        uploadDir: appealUploadDir
      });
      req.file.storagePath = storedDocumentPath;

      const created = await prisma.$transaction(async (tx) => {
        const document = await tx.document.create({
          data: {
            ...documentCreateData({
              claimId: existing.claimId,
              file: req.file,
              fileHash,
              intel,
              type: requestedType,
              identityValidation
            }),
            appealCaseId: existing.id
          }
        });

        await tx.denialCase.update({
          where: { id: existing.id },
          data: {
            appealEvidenceDocumentIds: {
              push: document.id
            }
          }
        });

        return document;
      });

      await audit(req, {
        claimId: existing.claimId,
        action: "APPEAL_EVIDENCE_UPLOADED",
        entityType: "Document",
        entityId: created.id,
        metadata: {
          denialCaseId: existing.id,
          documentType: created.type,
          autoSelected: true
        }
      });

      return res.status(201).json({
        document: publicDocument(created),
        autoSelected: true
      });
    } catch (error) {
      if (storedDocumentPath) {
        try {
          await deleteStoredObject(storedDocumentPath, {
            uploadDir: appealUploadDir
          });
        } catch {
          // Best-effort rollback of stored bytes.
        }
      }
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch { /* best effort */ }
      }
      console.error("[appeal-workspace] evidence upload failed", {
        denialId: req.params.id,
        name: error?.name || "Error",
        code: error?.code || null
      });
      return res.status(error?.status || 500).json({
        error:
          error?.status
            ? error.message
            : "Unable to upload appeal evidence",
        code: error?.code || "APPEAL_EVIDENCE_UPLOAD_FAILED"
      });
    }
  }
);

router.post(
  "/:id/assessment-override",
  requirePermission(PERMISSIONS.RECOVERY_EDIT),
  async (req, res) => {
    try {
      const existing = await prisma.denialCase.findFirst({
        where: {
          id: req.params.id,
          claim: {
            organizationId: req.user.organizationId,
            deletedAt: null
          }
        }
      });
      if (!existing) {
        return res.status(404).json({ error: "Denial case not found" });
      }

      const reason = String(req.body.reason || "").trim();
      if (reason.length < 10 || reason.length > 1000) {
        return res.status(400).json({
          error: "Override reason must be between 10 and 1000 characters"
        });
      }

      const hasAppealEligible =
        typeof req.body.appealEligible === "boolean";
      const hasCorrectable =
        typeof req.body.correctable === "boolean";

      if (!hasAppealEligible && !hasCorrectable) {
        return res.status(400).json({
          error: "Choose at least one assessment value to override"
        });
      }

      const updated = await prisma.denialCase.update({
        where: { id: existing.id },
        data: {
          appealEligible: hasAppealEligible
            ? req.body.appealEligible
            : undefined,
          correctable: hasCorrectable
            ? req.body.correctable
            : undefined,
          assessmentOverrideReason: reason,
          assessmentOverriddenAt: new Date()
        }
      });

      await audit(req, {
        claimId: existing.claimId,
        action: "RECOVERY_ASSESSMENT_OVERRIDDEN",
        entityType: "DenialCase",
        entityId: existing.id,
        metadata: {
          appealEligibleChanged: hasAppealEligible,
          correctableChanged: hasCorrectable,
          reasonProvided: true
        }
      });

      res.json(updated);
    } catch (error) {
      console.error("[appeal-workspace] assessment override failed", {
        denialId: req.params.id,
        name: error?.name || "Error"
      });
      res.status(error.status || 500).json({
        error:
          error.status
            ? error.message
            : "Unable to override recovery assessment"
      });
    }
  }
);

router.patch(
  "/:id/appeal-draft",
  requirePermission(PERMISSIONS.RECOVERY_EDIT),
  async (req, res) => {
    try {
      const existing = await prisma.denialCase.findFirst({
        where: {
          id: req.params.id,
          claim: {
            organizationId: req.user.organizationId,
            deletedAt: null
          }
        }
      });
      if (!existing) {
        return res.status(404).json({ error: "Denial case not found" });
      }
      if (APPEAL_LOCKED_STATUSES.has(existing.status)) {
        return res.status(409).json({
          error: "Submitted or closed appeals cannot be edited"
        });
      }

      const rationale = String(req.body.rationale || "").trim();
      if (rationale.length > 5000) {
        return res.status(400).json({
          error: "Appeal rationale must be 5000 characters or fewer"
        });
      }
      if (rationale.length > 0 && rationale.length < APPEAL_RATIONALE_MIN_CHARS) {
        return res.status(400).json({
          error: `Appeal rationale must be at least ${APPEAL_RATIONALE_MIN_CHARS} characters, or empty to clear it`
        });
      }

      const evidenceIds = Array.isArray(req.body.evidenceDocumentIds)
        ? [...new Set(req.body.evidenceDocumentIds.map((id) => String(id)))]
        : existing.appealEvidenceDocumentIds;

      if (evidenceIds.length > 50) {
        return res.status(400).json({ error: "Too many evidence documents selected" });
      }

      if (evidenceIds.length > 0) {
        const count = await prisma.document.count({
          where: {
            id: { in: evidenceIds },
            claimId: existing.claimId
          }
        });
        if (count !== evidenceIds.length) {
          return res.status(400).json({
            error: "Appeal evidence must belong to this claim"
          });
        }
      }

      const updated = await prisma.denialCase.update({
        where: { id: existing.id },
        data: {
          appealRationale: rationale || null,
          appealEvidenceDocumentIds: evidenceIds
        }
      });

      await audit(req, {
        claimId: existing.claimId,
        action: "APPEAL_DRAFT_SAVED",
        entityType: "DenialCase",
        entityId: existing.id,
        metadata: {
          rationalePresent: Boolean(rationale),
          evidenceCount: evidenceIds.length
        }
      });

      res.json(updated);
    } catch (error) {
      console.error("[appeal-workspace] draft save failed", {
        denialId: req.params.id,
        name: error?.name || "Error"
      });
      res.status(error.status || 500).json({
        error: error.status ? error.message : "Unable to save appeal draft"
      });
    }
  }
);

router.post(
  "/:id/appeal-prepare",
  requirePermission(PERMISSIONS.RECOVERY_EDIT),
  async (req, res) => {
    try {
      const existing = await prisma.denialCase.findFirst({
        where: {
          id: req.params.id,
          claim: {
            organizationId: req.user.organizationId,
            deletedAt: null
          }
        }
      });
      if (!existing) {
        return res.status(404).json({ error: "Denial case not found" });
      }
      if (!existing.aiAnalyzedAt) {
        return res.status(409).json({
          error: "Run recovery analysis before preparing an appeal"
        });
      }
      if (existing.appealEligible !== true) {
        return res.status(409).json({
          error:
            "This case is not currently assessed as appeal eligible. Use an authorized assessment override with a reason if appropriate."
        });
      }
      const savedRationale = String(existing.appealRationale || "").trim();
      if (savedRationale.length < APPEAL_RATIONALE_MIN_CHARS) {
        return res.status(409).json({
          error: `Add and save an appeal rationale of at least ${APPEAL_RATIONALE_MIN_CHARS} characters before preparing the appeal`
        });
      }

      const status = assertDenialTransition(
        existing.status,
        "APPEAL_PREPARED"
      );
      const updated = await prisma.denialCase.update({
        where: { id: existing.id },
        data: {
          status,
          appealPreparedAt: existing.appealPreparedAt || new Date()
        }
      });

      await audit(req, {
        claimId: existing.claimId,
        action: "APPEAL_PREPARED",
        entityType: "DenialCase",
        entityId: existing.id,
        metadata: {
          evidenceCount: existing.appealEvidenceDocumentIds.length
        }
      });

      res.json(updated);
    } catch (error) {
      console.error("[appeal-workspace] prepare failed", {
        denialId: req.params.id,
        name: error?.name || "Error"
      });
      res.status(error.status || 500).json({
        error: error.status ? error.message : "Unable to prepare appeal"
      });
    }
  }
);

router.post(
  "/:id/appeal-submit",
  requirePermission(PERMISSIONS.RECOVERY_EDIT),
  async (req, res) => {
    try {
      const existing = await prisma.denialCase.findFirst({
        where: {
          id: req.params.id,
          claim: {
            organizationId: req.user.organizationId,
            deletedAt: null
          }
        }
      });
      if (!existing) {
        return res.status(404).json({ error: "Denial case not found" });
      }
      if (req.body.confirmed !== true) {
        return res.status(400).json({
          error: "Submission confirmation is required"
        });
      }

      const status = assertDenialTransition(
        existing.status,
        "APPEAL_SUBMITTED"
      );
      const reference =
        String(req.body.submissionReference || "").trim().slice(0, 200) || null;
      const channel = String(req.body.submissionChannel || "")
        .trim()
        .toUpperCase();
      if (!APPEAL_SUBMISSION_CHANNELS.has(channel)) {
        return res.status(400).json({
          error: "Choose how the appeal was submitted"
        });
      }
      const externalSubmittedAt = parseOptionalDate(
        req.body.submissionDate,
        "Submission date"
      );
      if (!externalSubmittedAt) {
        return res.status(400).json({
          error: "Submission date is required"
        });
      }
      if (externalSubmittedAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
        return res.status(400).json({
          error: "Submission date cannot be in the future"
        });
      }

      const updated = await prisma.denialCase.update({
        where: { id: existing.id },
        data: {
          status,
          appealSubmittedAt: new Date(),
          appealSubmissionReference: reference,
          appealSubmissionChannel: channel,
          appealExternalSubmittedAt: externalSubmittedAt
        }
      });

      await audit(req, {
        claimId: existing.claimId,
        action: "APPEAL_MARKED_SUBMITTED",
        entityType: "DenialCase",
        entityId: existing.id,
        metadata: {
          submissionReferencePresent: Boolean(reference),
          submissionChannel: channel,
          externalSubmittedAt: externalSubmittedAt.toISOString(),
          externalTransmissionPerformed: false
        }
      });

      res.json({
        denialCase: updated,
        transmission: {
          performed: false,
          note:
            "Appeal submission status was recorded internally. No external payer transmission was performed."
        }
      });
    } catch (error) {
      console.error("[appeal-workspace] submit failed", {
        denialId: req.params.id,
        name: error?.name || "Error"
      });
      res.status(error.status || 500).json({
        error: error.status ? error.message : "Unable to mark appeal submitted"
      });
    }
  }
);

router.get("/:id", async (req, res) => {
  try {
    const denial = await prisma.denialCase.findFirst({
      where: { id: req.params.id, claim: { organizationId: req.user.organizationId, deletedAt: null } },
      include: {
        claim: {
          include: {
            documents: {
              select: {
                id: true,
                type: true,
                fileName: true,
                verified: true
              }
            }
          }
        }
      }
    });

    if (!denial) {
      return res.status(404).json({ error: "Denial case not found" });
    }

    res.json(enrichDenialCase(denial));
  } catch (error) {
    console.error("[denials] get failed", {
      denialId: req.params.id,
      message: error.message
    });
    res.status(500).json({ error: "Unable to load denial case" });
  }
});

router.get("/reference/codes", async (req, res) => {
  const result = interpretDenialCodes({
    carcCode: req.query.carc,
    rarcCode: req.query.rarc
  });
  res.json(result);
});

router.post("/deadline-preview", requirePermission(PERMISSIONS.DENIAL_EDIT), async (req, res) => {
  try {
    const denialDate = parseOptionalDate(req.body.denialDate, "Denial date");
    if (!denialDate) {
      return res.status(400).json({ error: "Denial date is required" });
    }
    const appealWindowDays = parseAppealWindowDays(
      req.body.appealWindowDays,
      Number(process.env.DEFAULT_APPEAL_WINDOW_DAYS || DEFAULT_APPEAL_WINDOW_DAYS)
    );
    const appealDeadline = computeAppealDeadline(denialDate, appealWindowDays);
    res.json({
      denialDate,
      appealWindowDays,
      appealDeadline,
      note: "Planning deadline only. Verify the payer contract, plan, remittance notice, and applicable appeal rules."
    });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.post("/from-claim/:claimId", requirePermission(PERMISSIONS.DENIAL_EDIT), async (req, res) => {
  try {
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.claimId, organizationId: req.user.organizationId, deletedAt: null }
    });

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    const existing = await prisma.denialCase.findFirst({
      where: {
        claimId: claim.id,
        status: { in: ACTIVE_STATUSES }
      },
      orderBy: { createdAt: "desc" }
    });

    if (existing) {
      return res.status(409).json({
        error: "An active denial/appeal case already exists for this claim.",
        denialCase: existing
      });
    }

    const source = String(req.body.source || "MANUAL").toUpperCase();
    if (!DENIAL_SOURCES.has(source)) {
      return res.status(400).json({ error: "Invalid denial case source" });
    }

    const denialDate = parseOptionalDate(req.body.denialDate, "Denial date");
    const explicitAppealDeadline = parseOptionalDate(
      req.body.appealDeadline,
      "Appeal deadline"
    );
    const appealWindowDays = parseAppealWindowDays(
      req.body.appealWindowDays,
      Number(process.env.DEFAULT_APPEAL_WINDOW_DAYS || DEFAULT_APPEAL_WINDOW_DAYS)
    );
    const appealDeadline =
      explicitAppealDeadline || computeAppealDeadline(denialDate || new Date(), appealWindowDays);
    const codeReference = interpretDenialCodes({
      carcCode: req.body.carcCode,
      rarcCode: req.body.rarcCode
    });

    const created = await prisma.denialCase.create({
      data: {
        claimId: claim.id,
        source,
        status: "OPEN",
        denialCategory: req.body.denialCategory
          ? String(req.body.denialCategory).toUpperCase()
          : codeReference.category,
        groupCode: req.body.groupCode
          ? String(req.body.groupCode).toUpperCase()
          : null,
        carcCode: req.body.carcCode
          ? String(req.body.carcCode).toUpperCase()
          : null,
        rarcCode: req.body.rarcCode
          ? String(req.body.rarcCode).toUpperCase()
          : null,
        reasonText:
          typeof req.body.reasonText === "string"
            ? req.body.reasonText.trim().slice(0, 2000) || null
            : null,
        denialDate: denialDate || new Date(),
        appealDeadline,
        revenueAtRisk: revenueAtRiskForClaim(claim),
        recommendedAction: codeReference.recommendedAction
      }
    });

    await audit(req, {
      claimId: claim.id,
      action: "DENIAL_CASE_CREATED",
      entityType: "DenialCase",
      entityId: created.id,
      metadata: {
        source: created.source,
        category: created.denialCategory,
        hasCARC: Boolean(created.carcCode),
        hasRARC: Boolean(created.rarcCode)
      }
    });

    console.info("[denials] case created", {
      claimId: claim.id,
      denialId: created.id,
      source: created.source
    });

    res.status(201).json(created);
  } catch (error) {
    console.error("[denials] create failed", {
      claimId: req.params.claimId,
      message: error.message
    });
    res.status(error.status || 500).json({
      error: error.status ? error.message : "Unable to create denial case"
    });
  }
});

router.patch("/:id", requirePermission(PERMISSIONS.DENIAL_EDIT), async (req, res) => {
  try {
    const existing = await prisma.denialCase.findFirst({
      where: { id: req.params.id, claim: { organizationId: req.user.organizationId, deletedAt: null } }
    });
    if (!existing) {
      return res.status(404).json({ error: "Denial case not found" });
    }

    const nextStatus = req.body.status
      ? String(req.body.status).toUpperCase()
      : existing.status;

    if (
      typeof req.body.appealEligible === "boolean" ||
      typeof req.body.correctable === "boolean"
    ) {
      return res.status(409).json({
        error: "Use the audited recovery assessment override workflow for assessment changes"
      });
    }

    if (["APPEAL_PREPARED", "APPEAL_SUBMITTED"].includes(nextStatus)) {
      return res.status(409).json({
        error: "Use the Appeal Workspace for appeal preparation and submission status"
      });
    }

    assertDenialTransition(existing.status, nextStatus);

    const requestedDenialDate =
      req.body.denialDate !== undefined
        ? parseOptionalDate(req.body.denialDate, "Denial date")
        : existing.denialDate;
    const requestedAppealWindowDays =
      req.body.appealWindowDays !== undefined
        ? parseAppealWindowDays(req.body.appealWindowDays)
        : null;
    const explicitDeadline =
      req.body.appealDeadline !== undefined
        ? parseOptionalDate(req.body.appealDeadline, "Appeal deadline")
        : undefined;
    const shouldRecomputeDeadline =
      requestedAppealWindowDays != null || req.body.denialDate !== undefined;
    const codeReference = interpretDenialCodes({
      carcCode: req.body.carcCode !== undefined ? req.body.carcCode : existing.carcCode,
      rarcCode: req.body.rarcCode !== undefined ? req.body.rarcCode : existing.rarcCode
    });

    const updated = await prisma.denialCase.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        denialCategory:
          req.body.denialCategory !== undefined
            ? String(req.body.denialCategory || "").toUpperCase() || null
            : existing.denialCategory || codeReference.category || undefined,
        groupCode:
          req.body.groupCode !== undefined
            ? String(req.body.groupCode || "").toUpperCase() || null
            : undefined,
        carcCode:
          req.body.carcCode !== undefined
            ? String(req.body.carcCode || "").toUpperCase() || null
            : undefined,
        rarcCode:
          req.body.rarcCode !== undefined
            ? String(req.body.rarcCode || "").toUpperCase() || null
            : undefined,
        reasonText:
          req.body.reasonText !== undefined
            ? String(req.body.reasonText || "").trim().slice(0, 2000) || null
            : undefined,
        denialDate:
          req.body.denialDate !== undefined ? requestedDenialDate : undefined,
        appealDeadline:
          explicitDeadline !== undefined
            ? explicitDeadline
            : shouldRecomputeDeadline && requestedDenialDate
            ? computeAppealDeadline(
                requestedDenialDate,
                requestedAppealWindowDays || DEFAULT_APPEAL_WINDOW_DAYS
              )
            : undefined,
        recommendedAction:
          req.body.recommendedAction !== undefined
            ? String(req.body.recommendedAction || "").trim().slice(0, 2000) || null
            : req.body.carcCode !== undefined || req.body.rarcCode !== undefined
            ? codeReference.recommendedAction || existing.recommendedAction || undefined
            : undefined,
        recoveredAmount:
          req.body.recoveredAmount !== undefined
            ? parseOptionalMoney(req.body.recoveredAmount, "Recovered amount")
            : undefined
      }
    });

    await audit(req, {
      claimId: existing.claimId,
      action: "DENIAL_CASE_UPDATED",
      entityType: "DenialCase",
      entityId: existing.id,
      metadata: { status: updated.status }
    });

    res.json(updated);
  } catch (error) {
    console.error("[denials] update failed", {
      denialId: req.params.id,
      message: error.message
    });
    res.status(error.status || 500).json({
      error: error.status ? error.message : "Unable to update denial case"
    });
  }
});

router.post("/:id/analyze", requirePermission(PERMISSIONS.DENIAL_EDIT), async (req, res) => {
  try {
    const denial = await prisma.denialCase.findFirst({
      where: { id: req.params.id, claim: { organizationId: req.user.organizationId, deletedAt: null } },
      include: {
        claim: {
          include: {
            documents: {
              select: {
                type: true,
                verified: true
              }
            }
          }
        }
      }
    });

    if (!denial) {
      return res.status(404).json({ error: "Denial case not found" });
    }

    const analysis = await analyzeDenial(denial.claim, denial);

    const updated = await prisma.denialCase.update({
      where: { id: denial.id },
      data: {
        status: assertDenialTransition(
          denial.status,
          denial.status === "OPEN" ? "ANALYZED" : denial.status
        ),
        denialCategory: denial.denialCategory || analysis.category,
        correctable:
          denial.correctable == null
            ? analysis.correctable
            : denial.correctable,
        appealEligible:
          denial.appealEligible == null
            ? analysis.appealEligible
            : denial.appealEligible,
        revenueAtRisk:
          denial.revenueAtRisk == null
            ? analysis.revenueAtRisk
            : denial.revenueAtRisk,
        recommendedAction: analysis.recommendedAction,
        requiredDocuments: analysis.requiredDocuments,
        aiExplanation: analysis.explanation,
        aiConfidence: analysis.confidence,
        aiProvider: analysis.provider,
        aiModel: analysis.model,
        aiAnalyzedAt: new Date(),
        appealDeadline:
          denial.appealDeadline ||
          (denial.denialDate
            ? computeAppealDeadline(
                denial.denialDate,
                Number(process.env.DEFAULT_APPEAL_WINDOW_DAYS || DEFAULT_APPEAL_WINDOW_DAYS)
              )
            : undefined)
      }
    });

    await audit(req, {
      claimId: denial.claimId,
      action: "DENIAL_AI_ANALYZED",
      entityType: "DenialCase",
      entityId: denial.id,
      metadata: {
        provider: analysis.provider,
        model: analysis.model,
        llmUsed: analysis.llmUsed === true,
        confidence: analysis.confidence
      }
    });

    console.info("[denial-ai] analysis completed", {
      claimId: denial.claimId,
      denialId: denial.id,
      provider: analysis.provider,
      llmUsed: analysis.llmUsed === true
    });

    res.json({
      denialCase: updated,
      ai: {
        provider: analysis.provider,
        model: analysis.model,
        llmUsed: analysis.llmUsed === true,
        llmReason: analysis.llmReason || null
      }
    });
  } catch (error) {
    console.error("[denial-ai] analysis endpoint failed", {
      denialId: req.params.id,
      message: error.message
    });
    res.status(500).json({
      error: "Denial analysis could not be completed. Please retry."
    });
  }
});

export default router;
