import { validMoney, differenceMoney, moneyCents, moneyFromCents } from "../utils/money.js";
import express from "express";
import { assertDenialTransition } from "../services/workflowStateMachine.js";
import { prisma } from "../db.js";
import { analyzeDenial } from "../services/denialIntelligence.js";
import {
  DEFAULT_APPEAL_WINDOW_DAYS,
  computeAppealDeadline,
  enrichDenialCase,
  interpretDenialCodes,
  parseAppealWindowDays
} from "../services/denialCodes.js";

const router = express.Router();

const MANAGER_ROLES = new Set(["ADMIN", "CASHIER"]);
const DENIAL_SOURCES = new Set(["MANUAL", "PAYER_STATUS", "SIMULATED_PAYER_STATUS"]);
const ACTIVE_STATUSES = [
  "OPEN",
  "ANALYZED",
  "CORRECTION_REQUIRED",
  "APPEAL_PREPARED",
  "APPEAL_SUBMITTED",
  "RESUBMITTED"
];

function requireManager(req, res, next) {
  if (!req.user || !MANAGER_ROLES.has(req.user.role)) {
    return res.status(403).json({
      error: "Only ADMIN or CASHIER users can modify denial and appeal cases."
    });
  }
  next();
}

function safeMetadata(metadata = {}) {
  // Audit metadata must not include patient/member/policy data or payer free text.
  return metadata;
}

async function audit(req, {
  claimId = null,
  action,
  entityType,
  entityId = null,
  outcome = "SUCCESS",
  metadata = {}
}) {
  try {
    await prisma.auditEvent.create({
      data: {
        organizationId: req.user.organizationId,
        claimId,
        actorUserId: req.user?.id || null,
        action,
        entityType,
        entityId,
        outcome,
        metadata: safeMetadata(metadata)
      }
    });
  } catch (error) {
    // Audit write failures must be visible operationally but must never log PHI.
    console.error("[audit] write failed", {
      action,
      entityType,
      outcome,
      message: error.message
    });
  }
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
        denialCategory: true
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
    const overdueAppeals = enrichedCases.filter((item) => item.deadline?.state === "OVERDUE").length;
    const appealsDueSoon = enrichedCases.filter((item) => item.deadline?.state === "DUE_SOON").length;

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

router.get("/codes/lookup", async (req, res) => {
  const result = interpretDenialCodes({
    carcCode: req.query.carc,
    rarcCode: req.query.rarc
  });
  res.json(result);
});

router.post("/deadline-preview", requireManager, async (req, res) => {
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

router.post("/from-claim/:claimId", requireManager, async (req, res) => {
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

router.patch("/:id", requireManager, async (req, res) => {
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
        correctable:
          typeof req.body.correctable === "boolean"
            ? req.body.correctable
            : undefined,
        appealEligible:
          typeof req.body.appealEligible === "boolean"
            ? req.body.appealEligible
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
            : existing.recommendedAction || codeReference.recommendedAction || undefined,
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

router.post("/:id/analyze", requireManager, async (req, res) => {
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
