import express from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { PERMISSIONS } from "../security/permissions.js";
import { isClaimLocked } from "../services/claimLock.js";
import { writeCriticalRequestAudit, writeRequestAudit } from "../services/auditLog.js";

const router = express.Router();

const transitionSchema = z.object({
  action: z.enum(["SUBMIT", "REQUEST_ADDITIONAL_INFO", "RESOLVE_ADDITIONAL_INFO", "APPROVE", "DENY"]),
  payerReference: z.string().trim().max(200).nullable().optional(),
  submissionChannel: z.string().trim().max(80).nullable().optional(),
  responseDueAt: z.string().datetime({ offset: true }).nullable().optional(),
  authorizationNo: z.string().trim().max(120).nullable().optional(),
  effectiveFrom: z.string().datetime({ offset: true }).nullable().optional(),
  effectiveTo: z.string().datetime({ offset: true }).nullable().optional(),
  requestText: z.string().trim().max(1000).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional()
}).strict();

const orgId = (req) => req.user.organizationId;

function evidenceChecklist(claim) {
  const docs = Array.isArray(claim.documents) ? claim.documents : [];
  const clinicalTypes = new Set(["PROGRESS_NOTE", "OPERATIVE_NOTE", "RADIOLOGY", "PRESCRIPTION"]);
  const hasClinicalSupport = docs.some((doc) => clinicalTypes.has(String(doc.type || "").toUpperCase()));
  const requiredDocuments = claim.priorAuthRequired === true ? [
    {
      category: "CLINICAL_SUPPORT",
      label: "Clinical support",
      acceptedTypes: [...clinicalTypes],
      satisfied: hasClinicalSupport
    }
  ] : [];
  return {
    requiredDocuments,
    missingDocuments: requiredDocuments.filter((item) => !item.satisfied)
  };
}

async function claimFor(req, claimId) {
  return prisma.claim.findFirst({
    where: { id: claimId, organizationId: orgId(req), deletedAt: null },
    include: {
      documents: { select: { id: true, type: true, fileName: true, status: true } }
    }
  });
}

router.get(
  "/claims/:claimId",
  requirePermission(PERMISSIONS.PAYER_ACTION),
  async (req, res) => {
    const claim = await claimFor(req, req.params.claimId);
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    const item = await prisma.priorAuthCase.findFirst({
      where: { claimId: claim.id, organizationId: orgId(req) }
    });

    await writeRequestAudit(prisma, req, {
      claimId: claim.id,
      action: "PRIOR_AUTH_CASE_VIEWED",
      entityType: "PriorAuthCase",
      entityId: item?.id || null,
      metadata: { status: item?.status || "NOT_CREATED" }
    });

    res.json({ item });
  }
);

router.post(
  "/claims/:claimId/sync",
  requirePermission(PERMISSIONS.PAYER_ACTION),
  async (req, res) => {
    const claim = await claimFor(req, req.params.claimId);
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    if (isClaimLocked(claim)) {
      return res.status(409).json({ error: "Prior authorization is locked after claim submission" });
    }
    if (claim.eligibilityStatus !== "VERIFIED") {
      return res.status(409).json({ error: "Eligibility must be verified before prior authorization work begins" });
    }
    if (claim.priorAuthRequired == null) {
      return res.status(409).json({
        error: "Evaluate whether prior authorization is required before creating the authorization case",
        code: "PRIOR_AUTH_REQUIREMENT_NOT_EVALUATED"
      });
    }

    const checklist = evidenceChecklist(claim);
    const current = await prisma.priorAuthCase.findUnique({ where: { claimId: claim.id } });
    const terminal = new Set(["APPROVED", "DENIED", "NOT_REQUIRED"]);
    const nextStatus = claim.priorAuthRequired === false
      ? "NOT_REQUIRED"
      : checklist.missingDocuments.length
      ? "REQUIRED"
      : "READY_TO_SUBMIT";
    const status = current && terminal.has(current.status) ? current.status : nextStatus;

    const item = await prisma.$transaction(async (tx) => {
      const saved = await tx.priorAuthCase.upsert({
        where: { claimId: claim.id },
        create: {
          organizationId: orgId(req),
          claimId: claim.id,
          status,
          requirementSource:
            claim.payerConnectionMode === "LIVE"
              ? "PAYER_CONNECTOR"
              : claim.payerConnectionMode === "SIMULATED"
              ? "SIMULATED_PAYER"
              : "LOCAL_EVALUATION",
          requiredDocuments: checklist.requiredDocuments,
          missingDocuments: checklist.missingDocuments,
          additionalInfoRequests: []
        },
        update: {
          status,
          requiredDocuments: checklist.requiredDocuments,
          missingDocuments: checklist.missingDocuments
        }
      });

      await writeCriticalRequestAudit(tx, req, {
        claimId: claim.id,
        action: "PRIOR_AUTH_CASE_SYNCED",
        entityType: "PriorAuthCase",
        entityId: saved.id,
        metadata: {
          status: saved.status,
          required: claim.priorAuthRequired === true,
          missingEvidenceCount: checklist.missingDocuments.length
        }
      });
      return saved;
    });

    res.json({ item, externalTransmissionPerformed: false });
  }
);

router.patch(
  "/cases/:id",
  requirePermission(PERMISSIONS.PAYER_ACTION),
  async (req, res) => {
    const parsed = transitionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid prior authorization case update", code: "INVALID_PRIOR_AUTH_CASE_UPDATE" });
    }

    const existing = await prisma.priorAuthCase.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      include: {
        claim: {
          include: {
            documents: { select: { id: true, type: true, fileName: true, status: true } }
          }
        }
      }
    });
    if (!existing) return res.status(404).json({ error: "Prior authorization case not found" });
    if (isClaimLocked(existing.claim)) {
      return res.status(409).json({ error: "Prior authorization is locked after claim submission" });
    }

    const input = parsed.data;
    const now = new Date();
    const requests = Array.isArray(existing.additionalInfoRequests)
      ? existing.additionalInfoRequests
      : [];
    const data = {};
    const claimData = {};
    let auditAction = "PRIOR_AUTH_CASE_UPDATED";

    if (input.action === "SUBMIT") {
      const checklist = evidenceChecklist(existing.claim);
      if (existing.claim.priorAuthRequired !== true) {
        return res.status(409).json({ error: "This claim does not require prior authorization" });
      }
      if (checklist.missingDocuments.length) {
        return res.status(409).json({
          error: "Required prior authorization evidence is missing",
          code: "PRIOR_AUTH_EVIDENCE_MISSING",
          missingDocuments: checklist.missingDocuments
        });
      }
      if (!input.submissionChannel) {
        return res.status(400).json({ error: "Submission channel is required" });
      }
      data.status = "SUBMITTED";
      data.submissionChannel = input.submissionChannel;
      data.payerReference = input.payerReference || existing.payerReference || null;
      data.submittedAt = now;
      data.responseDueAt = input.responseDueAt ? new Date(input.responseDueAt) : null;
      data.requiredDocuments = checklist.requiredDocuments;
      data.missingDocuments = [];
      auditAction = "PRIOR_AUTH_SUBMISSION_RECORDED";
    } else if (input.action === "REQUEST_ADDITIONAL_INFO") {
      if (!input.requestText) {
        return res.status(400).json({ error: "Additional-information request text is required" });
      }
      data.status = "ADDITIONAL_INFO_REQUESTED";
      data.additionalInfoRequests = [
        ...requests,
        {
          id: `req-${Date.now()}`,
          text: input.requestText,
          requestedAt: now.toISOString(),
          resolvedAt: null,
          status: "OPEN"
        }
      ];
      auditAction = "PRIOR_AUTH_ADDITIONAL_INFO_REQUESTED";
    } else if (input.action === "RESOLVE_ADDITIONAL_INFO") {
      data.status = "SUBMITTED";
      data.additionalInfoRequests = requests.map((item) =>
        item?.status === "OPEN"
          ? { ...item, status: "RESOLVED", resolvedAt: now.toISOString() }
          : item
      );
      auditAction = "PRIOR_AUTH_ADDITIONAL_INFO_RESOLVED";
    } else if (input.action === "APPROVE") {
      if (!input.authorizationNo) {
        return res.status(400).json({ error: "Authorization number is required for approval" });
      }
      data.status = "APPROVED";
      data.authorizationNo = input.authorizationNo;
      data.decisionAt = now;
      data.effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : null;
      data.effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
      claimData.priorAuthRequired = true;
      claimData.priorAuthStatus = "APPROVED";
      claimData.priorAuthCheckedAt = now;
      claimData.authorizationNo = input.authorizationNo;
      claimData.priorAuthExpiry = input.effectiveTo ? new Date(input.effectiveTo) : null;
      auditAction = "PRIOR_AUTH_APPROVED";
    } else if (input.action === "DENY") {
      data.status = "DENIED";
      data.decisionAt = now;
      data.notes = input.notes || existing.notes || null;
      claimData.priorAuthRequired = true;
      claimData.priorAuthStatus = "DENIED";
      claimData.priorAuthCheckedAt = now;
      auditAction = "PRIOR_AUTH_DENIED";
    }

    if (input.notes != null && input.action !== "DENY") data.notes = input.notes || null;

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.priorAuthCase.update({
        where: { id: existing.id },
        data
      });

      if (Object.keys(claimData).length) {
        await tx.claim.update({ where: { id: existing.claimId }, data: claimData });
      }

      await writeCriticalRequestAudit(tx, req, {
        claimId: existing.claimId,
        action: auditAction,
        entityType: "PriorAuthCase",
        entityId: existing.id,
        metadata: {
          status: updated.status,
          hasPayerReference: Boolean(updated.payerReference),
          hasResponseDeadline: Boolean(updated.responseDueAt)
        }
      });

      return updated;
    });

    res.json({
      item,
      externalTransmissionPerformed: false,
      note:
        input.action === "SUBMIT"
          ? "Prior authorization submission was recorded. No external payer transmission was performed."
          : null
    });
  }
);

export default router;
