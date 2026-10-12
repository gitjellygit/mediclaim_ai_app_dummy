import express from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { PERMISSIONS } from "../security/permissions.js";
import { writeRequestAudit } from "../services/auditLog.js";

const router = express.Router();

const optionalText = (max) =>
  z.preprocess(
    (value) => {
      if (value == null) return null;
      const text = String(value).trim();
      return text ? text : null;
    },
    z.string().max(max).nullable()
  );

const profileSchema = z.object({
  active: z.boolean().optional(),
  submitterName: optionalText(120).optional(),
  submitterId: optionalText(80).optional(),
  submitterPhone: optionalText(32).optional(),
  billingProviderName: optionalText(160).optional(),
  billingAddress1: optionalText(160).optional(),
  billingAddress2: optionalText(160).optional(),
  billingCity: optionalText(100).optional(),
  billingState: optionalText(32).optional(),
  billingPostalCode: optionalText(20).optional(),
  signatureOnFile: z.boolean().nullable().optional(),
  assignmentOfBenefits: z.boolean().nullable().optional(),
  releaseOfInformation: z.boolean().nullable().optional(),
  professionalPlanParticipationCode: optionalText(8).optional(),
  institutionalPlanParticipationCode: optionalText(8).optional(),
  defaultProfessionalPlaceOfService: optionalText(8).optional(),
  defaultInstitutionalPlaceOfService: optionalText(8).optional()
}).strict();

function normalizeProfileInput(input) {
  const parsed = profileSchema.safeParse(input || {});
  if (!parsed.success) {
    return {
      ok: false,
      response: {
        error: "Invalid billing profile",
        message: "Review the organization billing/EDI settings and try again.",
        code: "INVALID_BILLING_PROFILE",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      }
    };
  }

  const data = { ...parsed.data };
  if (Object.prototype.hasOwnProperty.call(data, "submitterPhone") && data.submitterPhone) {
    data.submitterPhone = data.submitterPhone.replace(/\D/g, "");
    if (data.submitterPhone.length < 10 || data.submitterPhone.length > 15) {
      return {
        ok: false,
        response: {
          error: "Invalid billing profile",
          message: "Submitter phone must contain 10 to 15 digits.",
          code: "INVALID_BILLING_PROFILE"
        }
      };
    }
  }

  for (const field of [
    "professionalPlanParticipationCode",
    "institutionalPlanParticipationCode",
    "defaultProfessionalPlaceOfService",
    "defaultInstitutionalPlaceOfService"
  ]) {
    if (data[field]) data[field] = data[field].toUpperCase();
  }

  return { ok: true, data };
}

function publicProfile(profile) {
  if (!profile) {
    return {
      active: false,
      configured: false
    };
  }
  return {
    id: profile.id,
    organizationId: profile.organizationId,
    active: profile.active,
    submitterName: profile.submitterName,
    submitterId: profile.submitterId,
    submitterPhone: profile.submitterPhone,
    billingProviderName: profile.billingProviderName,
    billingAddress1: profile.billingAddress1,
    billingAddress2: profile.billingAddress2,
    billingCity: profile.billingCity,
    billingState: profile.billingState,
    billingPostalCode: profile.billingPostalCode,
    signatureOnFile: profile.signatureOnFile,
    assignmentOfBenefits: profile.assignmentOfBenefits,
    releaseOfInformation: profile.releaseOfInformation,
    professionalPlanParticipationCode: profile.professionalPlanParticipationCode,
    institutionalPlanParticipationCode: profile.institutionalPlanParticipationCode,
    defaultProfessionalPlaceOfService: profile.defaultProfessionalPlaceOfService,
    defaultInstitutionalPlaceOfService: profile.defaultInstitutionalPlaceOfService,
    configured: true,
    updatedAt: profile.updatedAt
  };
}

router.use(requirePermission(PERMISSIONS.USER_ADMIN));

router.get("/", async (req, res) => {
  const profile = await prisma.organizationBillingProfile.findUnique({
    where: { organizationId: req.user.organizationId }
  });
  res.json({ profile: publicProfile(profile) });
});

router.patch("/", async (req, res) => {
  const parsed = normalizeProfileInput(req.body);
  if (!parsed.ok) return res.status(400).json(parsed.response);

  const profile = await prisma.organizationBillingProfile.upsert({
    where: { organizationId: req.user.organizationId },
    create: {
      organizationId: req.user.organizationId,
      ...parsed.data
    },
    update: parsed.data
  });

  await writeRequestAudit(prisma, req, {
    action: "ORGANIZATION_BILLING_PROFILE_UPDATED",
    entityType: "OrganizationBillingProfile",
    entityId: profile.id,
    outcome: "SUCCESS",
    statusCode: 200,
    metadata: {
      active: profile.active,
      changedFields: Object.keys(parsed.data).sort()
    }
  });

  res.json({ profile: publicProfile(profile) });
});

export default router;
