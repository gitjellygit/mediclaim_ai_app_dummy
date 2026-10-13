import express from "express";
import { z } from "zod";
import { writeCriticalRequestAudit } from "../services/auditLog.js";
import { prisma } from "../db.js";
import { requireRoles } from "../middleware/auth.js";
import { listPayerConnectors } from "../services/payerGateway.js";
import {
  listStediPayers,
  searchStediPayers
} from "../services/stediTestConnector.js";

const router = express.Router();

const submissionProfileSchema = z.object({
  stediSubmitterName: z.string().trim().min(1).max(250),
  stediSubmitterId: z.string().trim().max(100).nullish(),
  stediSubmitterPhone: z.string().trim().regex(/^\d{7,15}$/),
  stediBillingProviderName: z.string().trim().min(1).max(250),
  stediBillingAddress1: z.string().trim().min(1).max(250),
  stediBillingAddress2: z.string().trim().max(250).nullish(),
  stediBillingCity: z.string().trim().min(1).max(100),
  stediBillingState: z.string().trim().min(2).max(2),
  stediBillingPostalCode: z.string().trim().min(5).max(12),
  stediProfessionalSignatureIndicator: z.enum(["Y", "N"]),
  stediProfessionalPlanParticipationCode: z.string().trim().min(1).max(1),
  stediInstitutionalPlanParticipationCode: z.string().trim().min(1).max(1),
  stediBenefitsAssignmentIndicator: z.enum(["Y", "N"]),
  stediReleaseInformationCode: z.enum(["Y", "I"]),
  stediDefaultProfessionalPlaceOfService: z.string().trim().regex(/^\d{2}$/).nullish(),
  stediDefaultInstitutionalPlaceOfService: z.string().trim().regex(/^\d{2}$/).nullish()
}).strict();

const submissionProfileSelect = Object.freeze({
  stediSubmitterName: true,
  stediSubmitterId: true,
  stediSubmitterPhone: true,
  stediBillingProviderName: true,
  stediBillingAddress1: true,
  stediBillingAddress2: true,
  stediBillingCity: true,
  stediBillingState: true,
  stediBillingPostalCode: true,
  stediProfessionalSignatureIndicator: true,
  stediProfessionalPlanParticipationCode: true,
  stediInstitutionalPlanParticipationCode: true,
  stediBenefitsAssignmentIndicator: true,
  stediReleaseInformationCode: true,
  stediDefaultProfessionalPlaceOfService: true,
  stediDefaultInstitutionalPlaceOfService: true
});

router.get("/submission-profile", requireRoles(["ADMIN"]), async (req, res) => {
  const profile = await prisma.organization.findUnique({
    where: { id: req.user.organizationId },
    select: submissionProfileSelect
  });
  if (!profile) return res.status(404).json({ error: "Organization not found" });
  res.json({ profile });
});

router.put("/submission-profile", requireRoles(["ADMIN"]), async (req, res) => {
  const parsed = submissionProfileSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid submission profile",
      message: parsed.error.issues[0]?.message || "Review the organization submission settings.",
      code: "INVALID_SUBMISSION_PROFILE"
    });
  }

  const profile = await prisma.$transaction(async (tx) => {
    const existing = await tx.organization.findUnique({
      where: { id: req.user.organizationId },
      select: submissionProfileSelect
    });
    if (!existing) {
      const error = new Error("Organization not found");
      error.status = 404;
      throw error;
    }

    const changedFields = Object.keys(parsed.data).filter(
      (field) => (existing[field] ?? null) !== (parsed.data[field] ?? null)
    );

    const updated = await tx.organization.update({
      where: { id: req.user.organizationId },
      data: parsed.data,
      select: submissionProfileSelect
    });

    await writeCriticalRequestAudit(tx, req, {
      action: "SUBMISSION_PROFILE_UPDATED",
      entityType: "Organization",
      entityId: req.user.organizationId,
      outcome: "SUCCESS",
      statusCode: 200,
      metadata: { changedFields }
    });

    return updated;
  });

  res.json({ profile });
});

router.get("/", (_req, res) => {
  res.json({ connectors: listPayerConnectors() });
});

router.get("/stedi/payers", async (req, res) => {
  try {
    const pageSize = Number(req.query.pageSize || 25);
    const query = String(req.query.query || "").trim();

    const result = query
      ? await searchStediPayers({
          query,
          pageSize: Number.isFinite(pageSize) ? pageSize : 25
        })
      : await listStediPayers({
          pageSize: Number.isFinite(pageSize) ? pageSize : 25
        });

    res.json(result);
  } catch (error) {
    console.error("[payer-connectors] Stedi payer lookup failed", {
      code: error?.code || null
    });

    if (error?.code === "PAYER_CONNECTOR_UNAVAILABLE") {
      return res.status(503).json({ error: "Stedi test connector is not configured" });
    }
    if (error?.code === "STEDI_API_ERROR") {
      return res.status(502).json({ error: "Stedi payer-network request failed" });
    }
    throw error;
  }
});

export default router;
