import { validMoney } from "../utils/money.js";
import { z } from "zod";
import { claimUpdateSchema, emptyMutationSchema, parseMutation } from "../validation/claimMutations.js";
import { assertClaimTransition } from "../services/workflowStateMachine.js";
import { parseClaimDate } from "../utils/claimDate.js";
import { serveStoredDocument } from "../services/documentResponse.js";
import { deleteStoredDocument } from "../services/documentDeletion.js";
import express from "express";
import { requireRoles } from "../middleware/auth.js";
import { prisma } from "../db.js";
import claimPayerSimulationRouter from "./claimPayerSimulation.js";
import claimJourneyRouter from "./claimJourney.js";
import { removeManuallyEditedFields } from "../services/claimDocumentProvenance.js";
import {
  buildAutomationSummary,
  changedFields,
  manualProvenance,
  mergeProvenance
} from "../services/claimFieldProvenance.js";
import {
  compareReadinessChecks,
  markReadinessChecksStale
} from "../services/readinessHistory.js";
import {
  buildClaimCompleteness,
  completenessReadinessIssues
} from "../services/claimCompleteness.js";
import { analyzeMedicalConsistency } from "../services/medicalConsistency.js";
import { configuredReadinessIssue } from "../services/configuredReadinessRules.js";

const router = express.Router();

function orgId(req) {
  return req.user.organizationId;
}

async function auditClaim(req, { claimId, action, outcome = "SUCCESS", metadata = {} }) {
  try {
    await prisma.auditEvent.create({
      data: {
        organizationId: orgId(req),
        claimId,
        actorUserId: req.user?.id || null,
        action,
        entityType: "Claim",
        entityId: claimId,
        outcome,
        metadata
      }
    });
  } catch (error) {
    console.error("[audit] claim event write failed", {
      claimId,
      action,
      name: error?.name || "Error",
      code: error?.code || null
    });
  }
}


router.get("/", async (req, res) => {
  try {
    const claims = await prisma.claim.findMany({
      where: {
        organizationId: orgId(req),
        deletedAt: null
      },
      include: {
        documents: {
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    res.json(claims);
  } catch (error) {
    console.error("Error fetching claims:", error);
    res.status(500).json({ error: "Unable to load claims", code: "CLAIM_LIST_FAILED" });
  }
});

/**
 * Claim Journey endpoints
 *
 * Eligibility and prior-auth actions are deterministic local pre-checks / recorded
 * workflow decisions. They do not claim to be live payer responses. A payer/clearinghouse
 * connector can replace these calls later without changing the UI workflow.
 */
/**
 * Server-side claim search for production-scale selectors.
 * Empty query returns recent claims; non-empty query searches common operational identifiers.
 * Results are intentionally capped so the browser never needs to load the full claim table.
 */
router.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const requestedLimit = Number(req.query.limit || 20);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 20, 50));

    const where = q
      ? {
          organizationId: orgId(req),
          deletedAt: null,
          OR: [
            { id: { equals: q } },
            { patientName: { contains: q, mode: "insensitive" } },
            { payerName: { contains: q, mode: "insensitive" } },
            { policyNo: { contains: q, mode: "insensitive" } },
            { memberId: { contains: q, mode: "insensitive" } },
            { insurerClaimNo: { contains: q, mode: "insensitive" } },
            { authorizationNo: { contains: q, mode: "insensitive" } }
          ]
        }
      : { organizationId: orgId(req), deletedAt: null };

    const claims = await prisma.claim.findMany({
      where,
      select: {
        id: true,
        patientName: true,
        payerName: true,
        policyNo: true,
        memberId: true,
        insurerClaimNo: true,
        authorizationNo: true,
        status: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    res.json({
      items: claims,
      query: q,
      limit,
      recent: !q
    });
  } catch (error) {
    console.error("[claim-search] failed", {
      message: error.message
    });
    res.status(500).json({
      error: "Unable to search claims"
    });
  }
});

router.use(claimPayerSimulationRouter);
router.use(claimJourneyRouter);

router.get("/medical-consistency/summary", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const requestedLimit = Number(req.query.limit || 50);
    const limit = Math.max(
      1,
      Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 50, 100)
    );

    const where = q
      ? {
          organizationId: orgId(req),
          deletedAt: null,
          OR: [
            { id: { equals: q } },
            { patientName: { contains: q, mode: "insensitive" } },
            { payerName: { contains: q, mode: "insensitive" } },
            { policyNo: { contains: q, mode: "insensitive" } },
            { memberId: { contains: q, mode: "insensitive" } }
          ]
        }
      : { organizationId: orgId(req), deletedAt: null };

    const claims = await prisma.claim.findMany({
      where,
      include: {
        documents: {
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    const items = claims.map((claim) => ({
      claim: {
        id: claim.id,
        patientName: claim.patientName,
        payerName: claim.payerName,
        policyNo: claim.policyNo,
        status: claim.status,
        diagnosisText: claim.diagnosisText,
        icd10Codes: claim.icd10Codes,
        admissionDate: claim.admissionDate,
        dischargeDate: claim.dischargeDate,
        dateOfService: claim.dateOfService,
        roomCategory: claim.roomCategory,
        icuDays: claim.icuDays
      },
      analysis: analyzeMedicalConsistency(claim)
    }));

    const metrics = {
      total: items.length,
      consistent: items.filter((item) => item.analysis.status === "CONSISTENT").length,
      needsReview: items.filter((item) => item.analysis.status === "NEEDS_REVIEW").length,
      blocked: items.filter((item) => item.analysis.status === "BLOCKED").length,
      averageScore:
        items.length > 0
          ? Math.round(
              items.reduce((sum, item) => sum + item.analysis.score, 0) /
                items.length
            )
          : 0
    };

    res.json({ items, metrics, query: q, limit });
  } catch (error) {
    console.error("[medical-consistency] summary failed", {
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({
      error: "Unable to load medical consistency analysis"
    });
  }
});

router.get("/:id/medical-consistency", async (req, res) => {
  try {
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: {
        documents: {
          orderBy: { createdAt: "desc" }
        }
      }
    });

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    res.json({
      claim,
      analysis: analyzeMedicalConsistency(claim)
    });
  } catch (error) {
    console.error("[medical-consistency] claim analysis failed", {
      claimId: req.params.id,
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({
      error: "Unable to analyze medical consistency"
    });
  }
});

router.get("/:id/audit", async (req, res) => {
  const claim = await prisma.claim.findFirst({
    where: {
      id: req.params.id,
      organizationId: orgId(req),
      deletedAt: null
    },
    select: { id: true }
  });

  if (!claim) {
    return res.status(404).json({ error: "Claim not found" });
  }

  const events = await prisma.auditEvent.findMany({
    where: {
      organizationId: orgId(req),
      claimId: claim.id
    },
    select: {
      id: true,
      createdAt: true,
      actorUserId: true,
      action: true,
      entityType: true,
      entityId: true,
      outcome: true,
      metadata: true
    },
    orderBy: { createdAt: "desc" },
    take: 250
  });

  res.json({ items: events });
});

router.get("/:id", async (req, res) => {
  const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
    include: {
      documents: true,
      checks: { orderBy: { createdAt: "desc" } }
    }
  });

  if (!claim) {
    return res.status(404).json({ error: "Claim not found" });
  }

  const checks = (claim.checks || []).map((check, index, all) => ({
    ...check,
    comparison: compareReadinessChecks(check, all[index + 1] || null)
  }));

  res.json({
    ...claim,
    checks,
    automationSummary: buildAutomationSummary(claim),
    completenessSummary: buildClaimCompleteness(claim)
  });
});

router.post("/", async (req, res) => {
  try {
    if (!req.body.patientName || !req.body.payerName) {
      return res.status(400).json({
        error: "patientName and payerName are required"
      });
    }

    const amount = Number(req.body.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: "amount must be a valid number greater than 0"
      });
    }

    // Explicit input allowlist: never accept caller-supplied lifecycle, payer,
    // monetary-adjudication, provenance, relationship IDs or audit fields.
    const claimCreateSchema = z.object({
      patientName: z.string().trim().min(1).max(250),
      payerName: z.string().trim().min(1).max(250),
      amount: z.coerce.number().positive().finite(),
      totalBilledAmount: z.coerce.number().positive().finite().nullish(),
      policyNo: z.string().trim().max(100).nullish(),
      memberId: z.string().trim().max(100).nullish(),
      patientDob: z.string().nullish(),
      hospitalName: z.string().trim().max(250).nullish(),
      doctorName: z.string().trim().max(250).nullish(),
      diagnosisText: z.string().max(6000).nullish(),
      icd10Codes: z.array(z.string().max(20)).max(100).optional(),
      procedureText: z.string().max(6000).nullish(),
      dateOfService: z.string().nullish(),
      admissionDate: z.string().nullish(),
      dischargeDate: z.string().nullish(),
      procedureDate: z.string().nullish(),
      admissionType: z.enum(["PLANNED", "EMERGENCY"]).nullish(),
      roomCategory: z.enum(["GENERAL", "SEMI_PRIVATE", "PRIVATE", "ICU"]).nullish(),
      icuDays: z.coerce.number().int().nonnegative().nullish(),
      claimType: z.enum(["PROVIDER_BILLED", "MEMBER_REIMBURSEMENT"]).optional()
    }).strict();
    const parsed = claimCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid claim input",
        message: "Only supported claim-creation fields are accepted",
        code: "INVALID_CLAIM_INPUT"
      });
    }
    const createPayload = {
      ...parsed.data,
      status: "DRAFT"
    };
    for (const key of ["amount", "totalBilledAmount"]) {
      if (createPayload[key] == null) continue;
      const canonical = validMoney(createPayload[key]);
      if (canonical == null) {
        return res.status(400).json({
          error: "Invalid money",
          message: `${key} must have at most two decimal places`,
          code: "INVALID_MONEY"
        });
      }
      createPayload[key] = canonical;
    }
    for (const field of ["patientDob", "dateOfService", "admissionDate", "dischargeDate", "procedureDate"]) {
      if (!createPayload[field]) continue;
      const parsedDate = parseClaimDate(createPayload[field]);
      if (!parsedDate) {
        return res.status(400).json({
          error: "Invalid date",
          message: `Invalid value for ${field}`,
          code: "INVALID_DATE"
        });
      }
      createPayload[field] = parsedDate;
    }

    const manuallyEnteredFields = Object.keys(createPayload).filter(
      (field) => !["status", "createdAt", "id"].includes(field)
    );

    const claim = await prisma.claim.create({
      data: {
        ...createPayload,
        organizationId: orgId(req),
        createdById: req.user.id,
        fieldProvenance: manualProvenance(
          manuallyEnteredFields,
          "Entered at Claim Creation"
        )
      }
    });

    await auditClaim(req, {
      claimId: claim.id,
      action: "CLAIM_CREATED",
      metadata: { status: claim.status }
    });

    res.json(claim);
  } catch (e) {
    console.error("[claim-create] failed", { name: e.name, code: e.code || null });
    res.status(500).json({ error: "Unable to create claim", code: "CLAIM_CREATE_FAILED" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const parsedInput = parseMutation(claimUpdateSchema, req.body);
    if (!parsedInput.ok) {
      return res.status(400).json(parsedInput.response);
    }
    const input = parsedInput.data;
    const existing = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null }
    });

    if (!existing) {
      return res.status(404).json({ error: "Claim not found" });
    }

    if (existing.claimSubmissionDate || ["SUBMITTED", "DENIED", "PAID"].includes(existing.status)) {
      return res.status(409).json({
        error: "Submitted claims are locked. Reopen or amend the claim before editing."
      });
    }

    const payload = {
      patientName: input.patientName,
      payerName: input.payerName,
      policyNo: input.policyNo || null,
      memberId: input.memberId || null,
      patientDob:
        input.patientDob
          ? new Date(input.patientDob)
          : null,
      hospitalName: input.hospitalName || null,
      diagnosisText: input.diagnosisText || null,
      claimType: input.claimType,
      dateOfService: input.dateOfService ? new Date(input.dateOfService) : null,
      admissionDate: input.admissionDate ? new Date(input.admissionDate) : null,
      dischargeDate: input.dischargeDate ? new Date(input.dischargeDate) : null,
      admissionType: input.admissionType || null,
      roomCategory: input.roomCategory || null,
      icuDays:
        input.icuDays != null && input.icuDays !== ""
          ? Number(input.icuDays)
          : null,
      procedureText: input.procedureText || null,
      procedureDate: input.procedureDate ? new Date(input.procedureDate) : null,
      icd10Codes: Array.isArray(input.icd10Codes)
        ? input.icd10Codes
        : [],
      amount: input.amount != null && input.amount !== ""
        ? validMoney(input.amount)
        : null,
      totalBilledAmount:
        input.totalBilledAmount != null &&
        input.totalBilledAmount !== ""
          ? validMoney(input.totalBilledAmount)
          : null
    };

    if (!payload.patientName) {
      return res.status(400).json({ error: "Patient name is required" });
    }

    if (!payload.payerName) {
      return res.status(400).json({ error: "Insurance company is required" });
    }

    if (
      payload.patientDob &&
      Number.isNaN(new Date(payload.patientDob).getTime())
    ) {
      return res.status(400).json({ error: "Patient date of birth is invalid" });
    }

    for (const [label, value] of [
      ["Date of service", payload.dateOfService],
      ["Admission date", payload.admissionDate],
      ["Discharge date", payload.dischargeDate],
      ["Procedure date", payload.procedureDate]
    ]) {
      if (value && Number.isNaN(new Date(value).getTime())) {
        return res.status(400).json({ error: `${label} is invalid` });
      }
    }

    if (
      payload.icuDays != null &&
      (!Number.isFinite(payload.icuDays) || payload.icuDays < 0)
    ) {
      return res.status(400).json({
        error: "ICU days must be zero or a positive number"
      });
    }

    if (
      payload.amount != null &&
      (!Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0)
    ) {
      return res.status(400).json({
        error: "Claimed amount must be a valid number greater than 0"
      });
    }

    // Reject invalid money before writing or changing provenance.
    for (const name of ["amount", "totalBilledAmount"]) {
      const supplied = req.body[name];
      if (supplied != null && supplied !== "" && validMoney(supplied) == null) {
        return res.status(400).json({ error: "Invalid money", message: `${name} must have at most two decimal places`, code: "INVALID_MONEY" });
      }
    }

    const manuallyChangedFields = changedFields(existing, payload);
    const documentDerivedFields = removeManuallyEditedFields(
      existing.documentDerivedFields,
      Object.fromEntries(
        manuallyChangedFields.map((field) => [field, payload[field]])
      )
    );
    const fieldProvenance = mergeProvenance(
      existing.fieldProvenance,
      manualProvenance(manuallyChangedFields)
    );

    const editStatus = assertClaimTransition(existing.status, "DRAFT");
    await prisma.claim.update({
      where: { id: req.params.id },
      data: {
        ...payload,
        documentDerivedFields,
        fieldProvenance,
        status: editStatus
      }
    });

    if (manuallyChangedFields.length > 0) {
      await markReadinessChecksStale(
        prisma,
        req.params.id,
        "Claim details changed"
      );
    }

    const updated = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: {
        documents: true,
        checks: { orderBy: { createdAt: "desc" } }
      }
    });

    await auditClaim(req, {
      claimId: updated.id,
      action: "CLAIM_UPDATED",
      metadata: { changedFields: manuallyChangedFields }
    });

    res.json({
      ...updated,
      automationSummary: buildAutomationSummary(updated),
      completenessSummary: buildClaimCompleteness(updated)
    });
  } catch (e) {
    console.error("[claim-edit] failed", { name: e.name, code: e.code || null });
    res.status(500).json({ error: "Unable to update claim", code: "CLAIM_UPDATE_FAILED" });
  }
});

router.delete("/:id", requireRoles(["ADMIN", "CASHIER"]), async (req, res) => {
  try {
    const id = req.params.id;

    const claim = await prisma.claim.findFirst({ where: { id, organizationId: orgId(req), deletedAt: null } });
    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    if (claim.status === "SUBMITTED") {
      return res.status(409).json({
        error: "Submitted claims are locked and cannot be deleted."
      });
    }

    await prisma.claim.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    await auditClaim(req, {
      claimId: id,
      action: "CLAIM_SOFT_DELETED",
      metadata: { previousStatus: claim.status }
    });

    res.json({ success: true, softDeleted: true });
  } catch (error) {
    console.error("Delete claim error:", error);
    res.status(400).json({ error: "Unable to delete claim" });
  }
});

// Legacy URLs delegate to the same implementation as /api/documents.
router.get("/:id/preview", (req, res) => serveStoredDocument(prisma, req, res));
router.get("/:id/download", (req, res) => serveStoredDocument(prisma, req, res, { download: true }));



router.delete("/documents/:id", requireRoles(["ADMIN", "CASHIER"]), (req, res) =>
  deleteStoredDocument(prisma, req, res, { legacy: true })
);

router.post("/:id/check", async (req, res) => {
  try {
    const parsedInput = parseMutation(emptyMutationSchema, req.body);
    if (!parsedInput.ok) {
      return res.status(400).json(parsedInput.response);
    }
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: { documents: true }
    });

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    if (claim.status === "SUBMITTED") {
      return res.status(409).json({
        error: "Submitted claims are locked. Reopen the claim before running a new AI check."
      });
    }

    // Only recognized rule codes alter live readiness. Mandatory gates remain mandatory.
    const rules = await prisma.rule.findMany({
      where: { code: { in: ["REQ_POLICY_NO", "RECOMMENDED_ICD"] } }
    });
    const issues = [];

    if (!claim.policyNo) {
      issues.push(configuredReadinessIssue(rules, {
        code: "REQ_POLICY_NO",
        severity: "BLOCK",
        message: "Policy number missing",
        mandatory: true
      }));
    }

    if (!claim.icd10Codes?.length) {
      const icdIssue = configuredReadinessIssue(rules, {
        code: "RECOMMENDED_ICD",
        severity: "WARN",
        message: "ICD-10 codes missing"
      });
      if (icdIssue) issues.push(icdIssue);
    }

    if (!claim.documents?.length) {
      issues.push({
        severity: "BLOCK",
        message: "No supporting documents uploaded"
      });
    }

    if (!claim.amount || Number(claim.amount) <= 0) {
      issues.push({
        severity: "BLOCK",
        message: "Claimed amount missing or invalid"
      });
    }

    if (claim.eligibilityStatus !== "VERIFIED") {
      issues.push({
        severity: "BLOCK",
        message: "Eligibility has not been verified"
      });
    }

    if (
      claim.priorAuthStatus !== "APPROVED" &&
      claim.priorAuthStatus !== "NOT_REQUIRED"
    ) {
      issues.push({
        severity: "BLOCK",
        message: "Prior authorization requirement is unresolved"
      });
    }

    const completeness = completenessReadinessIssues(claim);
    issues.push(...completeness.issues);

    // Medical-consistency findings feed the same pre-submission readiness gate.
    // Keep the module deterministic and evidence-based; no diagnosis or payer
    // policy is inferred here.
    const medicalConsistency = analyzeMedicalConsistency(claim);
    for (const finding of medicalConsistency.issues) {
      const message = `${finding.title}: ${finding.message}`;
      if (!issues.some((existing) => existing.message === message)) {
        issues.push({
          severity: finding.severity,
          message,
          source: "MEDICAL_CONSISTENCY",
          category: finding.category,
          fields: finding.fields,
          fixTarget: finding.fixTarget
        });
      }
    }

    let riskScore = 0;
    const riskFactors = [];

    if (!claim.policyNo) {
      riskScore += 0.25;
      riskFactors.push(
        "Claims without policy number historically show elevated rejection trends"
      );
    }

    if (issues.some((issue) => issue.rule === "RECOMMENDED_ICD")) {
      riskScore += 0.15;
      riskFactors.push(
        "Unstructured diagnosis increases manual review probability"
      );
    }

    if (
      claim.totalBilledAmount &&
      claim.amount &&
      Number(claim.amount) > Number(claim.totalBilledAmount)
    ) {
      riskScore += 0.3;
      riskFactors.push(
        "Claimed amount exceeds billed amount, increasing audit likelihood"
      );
    }

    if (issues.some((i) => i.severity === "BLOCK")) {
      riskScore += 0.1;
      riskFactors.push("Blocking compliance failures present");
    }

    let readinessScore = 100;

    issues.forEach((issue) => {
      if (issue.severity === "BLOCK") readinessScore -= 30;
      if (issue.severity === "WARN") readinessScore -= 10;
    });

    readinessScore = Math.max(readinessScore, 0);

    // Keep readiness and rejection-risk signals directionally consistent.
    // This remains a rules-based estimate, not a payer probability.
    const readinessRiskFloor = (100 - readinessScore) / 100;
    if (readinessRiskFloor > riskScore) {
      riskScore = readinessRiskFloor;
      if (readinessRiskFloor >= 0.3) {
        riskFactors.push("Readiness gaps indicate elevated submission risk");
      }
    }

    riskScore = Math.min(riskScore, 0.95);

    const riskLevel =
      riskScore >= 0.6 ? "HIGH" : riskScore >= 0.3 ? "MED" : "LOW";

    const hasBlock = issues.some((i) => i.severity === "BLOCK");

    const previousCheck = await prisma.check.findFirst({
      where: { claimId: claim.id },
      orderBy: { createdAt: "desc" }
    });

    const check = await prisma.check.create({
      data: {
        claimId: claim.id,
        score: readinessScore,
        riskScore,
        riskLevel,
        riskFactors,
        issues,
        isStale: false,
        staleAt: null,
        staleReason: null
      }
    });

    const readinessStatus = assertClaimTransition(
      claim.status,
      !hasBlock && readinessScore >= 80 ? "READY" : "DRAFT"
    );
    await prisma.claim.update({
      where: { id: claim.id },
      data: { status: readinessStatus }
    });

    res.json({
      ...check,
      comparison: compareReadinessChecks(check, previousCheck),
      completenessSummary: completeness.summary,
      medicalConsistency: {
        score: medicalConsistency.score,
        status: medicalConsistency.status,
        blockingIssues: medicalConsistency.blockingIssues,
        warnings: medicalConsistency.warnings
      }
    });
  } catch (e) {
    console.error("[claim-readiness] failed", { name: e?.name, code: e?.code || null });
    res.status(500).json({ error: "Unable to check claim readiness", code: "CLAIM_READINESS_FAILED" });
  }
});



router.post("/:id/submit", requireRoles(["ADMIN", "CASHIER"]), async (req, res) => {
  try {
    const parsedInput = parseMutation(emptyMutationSchema, req.body);
    if (!parsedInput.ok) {
      return res.status(400).json(parsedInput.response);
    }
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: {
        checks: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    });

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    const latestCheck = claim.checks?.[0];

    if (claim.eligibilityStatus !== "VERIFIED") {
      return res.status(400).json({
        error: "Verify eligibility before submitting the claim"
      });
    }

    if (
      claim.priorAuthStatus !== "APPROVED" &&
      claim.priorAuthStatus !== "NOT_REQUIRED"
    ) {
      return res.status(400).json({
        error: "Resolve prior authorization before submitting the claim"
      });
    }

    if (!latestCheck) {
      return res.status(400).json({
        error: "Run AI Check before submitting the claim"
      });
    }

    if (latestCheck.isStale) {
      return res.status(400).json({
        error:
          "Claim changed after the last AI Check. Refresh AI readiness before submitting."
      });
    }

    const issues = Array.isArray(latestCheck.issues)
      ? latestCheck.issues
      : [];

    const hasBlock = issues.some((i) => i.severity === "BLOCK");

    if (hasBlock) {
      return res.status(400).json({
        error: "Claim has blocking issues. Fix them before submission"
      });
    }

    if (latestCheck.score < 80) {
      return res.status(400).json({
        error: "Claim readiness score must be at least 80 to submit"
      });
    }

    if (claim.status === "SUBMITTED") {
      return res.status(400).json({
        error: "Claim is already submitted"
      });
    }

    const submittedStatus = assertClaimTransition(claim.status, "SUBMITTED");
    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        status: submittedStatus,
        claimSubmissionDate: new Date(),
        payerClaimStatus: "SUBMITTED",
        claimStatusCheckedAt: new Date(),
        remittanceStatus: "AWAITING"
      },
      include: {
        documents: true,
        checks: { orderBy: { createdAt: "desc" } }
      }
    });

    await auditClaim(req, {
      claimId: claim.id,
      action: "CLAIM_SUBMITTED",
      metadata: { payerClaimStatus: updated.payerClaimStatus }
    });

    res.json({
      success: true,
      message: "Claim submitted successfully",
      claim: updated
    });
  } catch (e) {
    console.error("[claim-submit] failed", { name: e?.name, code: e?.code || null });
    res.status(500).json({ error: "Unable to submit claim", code: "CLAIM_SUBMISSION_FAILED" });
  }
});

export default router;