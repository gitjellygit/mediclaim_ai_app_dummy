import express from "express";
import { auditOnResponse } from "../services/auditLog.js";
import { emptyMutationSchema, parseMutation, priorAuthEvaluationSchema, payerClaimStatusSchema, remittanceMutationSchema } from "../validation/claimMutations.js";
import { prisma } from "../db.js";
import { validMoney, moneyCents, differenceMoney } from "../utils/money.js";
import {
  buildAutomationSummary,
  manualProvenance,
  mergeProvenance,
  systemProvenance
} from "../services/claimFieldProvenance.js";
import { markReadinessChecksStale } from "../services/readinessHistory.js";
import { buildClaimCompleteness } from "../services/claimCompleteness.js";
import { getMockPayer } from "../services/payerSimulator.js";
import { assertClaimTransition } from "../services/workflowStateMachine.js";
import { isClaimLocked, isClaimSubmittedOrLater } from "../services/claimLock.js";
import { createPayerConnector } from "../services/payerGateway.js";
import { findActiveDenialCase } from "../services/denialCaseLifecycle.js";

const router = express.Router();

router.use((req, res, next) => {
  const path = req.path;
  const claimId = /^\/([^/]+)\/journey/.exec(path)?.[1] || null;
  const action =
    req.method === "GET" && /\/journey$/.test(path) ? "CLAIM_JOURNEY_VIEWED" :
    /\/eligibility\/precheck$/.test(path) ? "ELIGIBILITY_CHECKED" :
    /\/prior-auth\/evaluate$/.test(path) ? "PRIOR_AUTH_EVALUATED" :
    /\/claim-status$/.test(path) ? "PAYER_STATUS_UPDATED" :
    /\/remittance$/.test(path) ? "REMITTANCE_UPDATED" :
    null;

  if (action) {
    auditOnResponse(prisma, req, res, (statusCode) => ({
      claimId,
      action,
      entityType: "Claim",
      entityId: claimId,
      outcome: statusCode < 400 ? "SUCCESS" : "DENIED"
    }));
  }
  next();
});

function orgId(req) {
  return req.user.organizationId;
}

// Journey logs intentionally avoid patient/member data so PHI is not written to logs.
function logJourneyEvent(claimId, action, result, extra = {}) {
  console.info("[claim-journey]", {
    claimId,
    action,
    result,
    ...extra
  });
}

function buildJourneyState(claim) {
  const eligibilityComplete = claim.eligibilityStatus === "VERIFIED";
  const authComplete =
    claim.priorAuthStatus === "APPROVED" ||
    claim.priorAuthStatus === "NOT_REQUIRED";

  // Submission is its own completed stage. Overall claim status can later become
  // DENIED or PAID without making the submission stage look unfinished.
  const submitted = isClaimSubmittedOrLater(claim);

  const terminalPayerStatuses = new Set([
    "APPROVED",
    "PARTIALLY_APPROVED",
    "DENIED",
    "PAID"
  ]);
  const payerStatusFinal = terminalPayerStatuses.has(claim.payerClaimStatus);
  const remittanceFinal = claim.remittanceStatus === "POSTED";

  return {
    eligibility: {
      status: claim.eligibilityStatus,
      checkedAt: claim.eligibilityCheckedAt,
      coverageStatus: claim.coverageStatus,
      deductibleRemaining: claim.deductibleRemaining,
      coinsurancePct: claim.coinsurancePct,
      networkStatus: claim.networkStatus,
      actionable: !submitted
    },
    priorAuth: {
      status: claim.priorAuthStatus,
      required: claim.priorAuthRequired,
      checkedAt: claim.priorAuthCheckedAt,
      authorizationNo: claim.authorizationNo,
      expiry: claim.priorAuthExpiry,
      actionable: eligibilityComplete && !submitted,
      blockedReason: submitted
        ? "Locked after claim submission"
        : eligibilityComplete
        ? null
        : "Verify eligibility first"
    },
    claim: {
      status: submitted ? "SUBMITTED" : claim.status,
      submissionDate: claim.claimSubmissionDate,
      actionable: eligibilityComplete && authComplete,
      blockedReason:
        eligibilityComplete && authComplete
          ? null
          : "Eligibility and prior authorization must be resolved first"
    },
    claimStatus: {
      status: claim.payerClaimStatus || (submitted ? "SUBMITTED" : "NOT_AVAILABLE"),
      checkedAt: claim.claimStatusCheckedAt,
      actionable: submitted && !payerStatusFinal,
      blockedReason: !submitted
        ? "Submit the claim first"
        : payerStatusFinal
        ? "Final payer status recorded"
        : null
    },
    remittance: {
      status: claim.remittanceStatus,
      receivedAt: claim.remittanceReceivedAt,
      allowedAmount: claim.allowedAmount,
      patientResponsibility: claim.patientResponsibility,
      paidAmount: claim.paidAmount,
      paymentReference: claim.paymentReference,
      actionable: submitted && !remittanceFinal,
      blockedReason: !submitted
        ? "Submit the claim first"
        : remittanceFinal
        ? "Remittance already posted"
        : null
    }
  };
}

router.get("/:id/journey", async (req, res) => {
  try {
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: {
        documents: { orderBy: { createdAt: "desc" } },
        checks: { orderBy: { createdAt: "desc" }, take: 1 },
        payerTransactions: { orderBy: { createdAt: "desc" }, take: 25 }
      }
    });

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    res.json({
      claim: {
        ...claim,
        automationSummary: buildAutomationSummary(claim),
        completenessSummary: buildClaimCompleteness(claim)
      },
      stages: buildJourneyState(claim),
      payerConnection: {
        mode: claim.payerConnectionMode || "LOCAL",
        simulatedPayerCode: claim.simulatedPayerCode || null,
        simulatedPayer: claim.simulatedPayerCode
          ? getMockPayer(claim.simulatedPayerCode)
          : null
      },
      livePayerConnectorConfigured: false
    });
  } catch (error) {
    console.error("[claim-journey] load failed", {
      claimId: req.params.id,
      message: error.message
    });
    res.status(500).json({ error: "Unable to load claim journey" });
  }
});

router.post("/:id/journey/eligibility/precheck", async (req, res) => {
  try {
    const parsedInput = parseMutation(emptyMutationSchema, req.body);
    if (!parsedInput.ok) return res.status(400).json(parsedInput.response);
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null } });
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    // Completed eligibility is idempotent. Re-clicking the same action should
    // not rewrite timestamps, invalidate readiness, or generate duplicate UX noise.
    if (claim.eligibilityStatus === "VERIFIED") {
      return res.json({
        unchanged: true,
        message: "Eligibility is already verified",
        status: claim.eligibilityStatus,
        coverageStatus: claim.coverageStatus,
        livePayerVerification: false,
        claim
      });
    }

    const connector = createPayerConnector("LOCAL");
    const eligibility = connector.checkEligibility(claim);
    const now = new Date();
    const missing = eligibility.missingFields || [];
    const eligibilityStatus =
      eligibility.status === "ACTIVE"
        ? "VERIFIED"
        : eligibility.status === "NEEDS_REVIEW"
        ? "NEEDS_REVIEW"
        : "FAILED";
    const coverageStatus = eligibility.coverageStatus || "UNKNOWN";

    const updated = await prisma.$transaction(async (tx) => {
      const updatedClaim = await tx.claim.update({
        where: { id: claim.id },
        data: {
          eligibilityStatus,
          coverageStatus,
          eligibilityCheckedAt: now,
          fieldProvenance: mergeProvenance(
            claim.fieldProvenance,
            systemProvenance(
              ["eligibilityStatus", "coverageStatus"],
              {
                source: "LOCAL_PRECHECK",
                label: "Local Pre-check",
                sourceDetail: "No live 270/271 payer connector configured",
                verified: false
              }
            )
          )
        }
      });

      await markReadinessChecksStale(
        tx,
        claim.id,
        "Eligibility information changed"
      );

      if (claim.status === "READY") {
        await tx.claim.update({
          where: { id: claim.id },
          data: { status: assertClaimTransition(claim.status, "DRAFT") }
        });
      }

      return updatedClaim;
    });

    logJourneyEvent(claim.id, "eligibility-precheck", eligibilityStatus, {
      missingFieldCount: missing.length
    });

    res.json({
      message:
        eligibilityStatus === "VERIFIED"
          ? "Eligibility pre-check passed"
          : "Eligibility pre-check needs attention",
      status: eligibilityStatus,
      coverageStatus,
      missingFields: missing,
      livePayerVerification: false,
      claim: updated
    });
  } catch (error) {
    console.error("[claim-journey] eligibility precheck failed", {
      claimId: req.params.id,
      message: error.message
    });
    res.status(500).json({ error: "Eligibility pre-check failed. Please retry." });
  }
});

router.post("/:id/journey/prior-auth/evaluate", async (req, res) => {
  try {
    const parsedInput = parseMutation(priorAuthEvaluationSchema, req.body);
    if (!parsedInput.ok) return res.status(400).json(parsedInput.response);
    const input = parsedInput.data;
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null } });
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    if (isClaimLocked(claim)) {
      return res.status(409).json({
        error: "Prior authorization is locked after claim submission"
      });
    }

    if (claim.eligibilityStatus !== "VERIFIED") {
      return res.status(409).json({
        error: "Eligibility must be verified before prior authorization can be evaluated"
      });
    }

    const connector = createPayerConnector("LOCAL");
    const priorAuth = connector.requestPriorAuth(claim, {
      required: input.required,
      authorizationNo: input.authorizationNo,
      expiry: input.expiry
    });
    const required = priorAuth.required;
    const authorizationNo = priorAuth.authorizationNo;
    const priorAuthStatus = priorAuth.status;

    const expiry =
      priorAuth.expiry != null && priorAuth.expiry !== ""
        ? new Date(priorAuth.expiry)
        : claim.priorAuthExpiry;

    if (expiry && Number.isNaN(new Date(expiry).getTime())) {
      return res.status(400).json({ error: "Invalid prior authorization expiry date" });
    }

    const normalizedExpiry = expiry ? new Date(expiry).toISOString() : null;
    const existingExpiry = claim.priorAuthExpiry
      ? new Date(claim.priorAuthExpiry).toISOString()
      : null;

    const unchanged =
      claim.priorAuthRequired === required &&
      claim.priorAuthStatus === priorAuthStatus &&
      (claim.authorizationNo || null) === (authorizationNo || null) &&
      existingExpiry === normalizedExpiry;

    if (unchanged) {
      return res.json({
        unchanged: true,
        message: "Prior authorization information is already up to date",
        status: claim.priorAuthStatus,
        livePayerVerification: false,
        claim
      });
    }

    const priorAuthFields = ["priorAuthRequired", "priorAuthStatus"];
    if (authorizationNo) priorAuthFields.push("authorizationNo");
    if (expiry) priorAuthFields.push("priorAuthExpiry");

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        priorAuthRequired: required,
        priorAuthStatus,
        priorAuthCheckedAt: new Date(),
        authorizationNo,
        priorAuthExpiry: expiry || null,
        fieldProvenance: mergeProvenance(
          claim.fieldProvenance,
          {
            ...systemProvenance(
              ["priorAuthStatus"],
              {
                source: "LOCAL_PRECHECK",
                label: "Local Prior Auth Evaluation",
                sourceDetail: "No live payer prior-auth connector configured",
                verified: false
              }
            ),
            ...manualProvenance(
              priorAuthFields.filter((field) => field !== "priorAuthStatus"),
              "Recorded by User"
            )
          }
        )
      }
    });

    await markReadinessChecksStale(
      prisma,
      claim.id,
      "Prior authorization information changed"
    );
    if (claim.status === "READY") {
      await prisma.claim.update({
        where: { id: claim.id },
        data: { status: assertClaimTransition(claim.status, "DRAFT") }
      });
    }

    logJourneyEvent(claim.id, "prior-auth-evaluate", priorAuthStatus, {
      required: required === true
    });

    res.json({
      message: "Prior authorization stage updated",
      status: priorAuthStatus,
      livePayerVerification: false,
      claim: updated
    });
  } catch (error) {
    console.error("[claim-journey] prior auth evaluation failed", {
      claimId: req.params.id,
      message: error.message
    });
    res.status(500).json({ error: "Prior authorization update failed. Please retry." });
  }
});

router.patch("/:id/journey/claim-status", async (req, res) => {
  try {
    const parsedInput = parseMutation(payerClaimStatusSchema, req.body);
    if (!parsedInput.ok) return res.status(400).json(parsedInput.response);
    const { payerClaimStatus } = parsedInput.data;
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null } });
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    if (!isClaimSubmittedOrLater(claim)) {
      return res.status(409).json({
        error: "Claim must be submitted before payer status can be recorded"
      });
    }

    const terminalPayerStatuses = [
      "APPROVED",
      "PARTIALLY_APPROVED",
      "DENIED",
      "PAID"
    ];

    if (
      terminalPayerStatuses.includes(claim.payerClaimStatus) &&
      claim.payerClaimStatus !== payerClaimStatus
    ) {
      return res.status(409).json({
        error: "Final payer status is locked. Reopen the claim before changing it."
      });
    }

    const connector = createPayerConnector("LOCAL");
    const statusResult = connector.getStatus(claim, { payerClaimStatus });
    const connectorPayerClaimStatus = statusResult.status;

    if ((claim.payerClaimStatus || null) === connectorPayerClaimStatus) {
      return res.json({
        ...claim,
        unchanged: true,
        message: "Payer claim status is already up to date",
        denialCase: null
      });
    }

    const { updated, denialCase } = await prisma.$transaction(async (tx) => {
      const updatedClaim = await tx.claim.update({
        where: { id: claim.id },
        data: {
          payerClaimStatus: connectorPayerClaimStatus,
          claimStatusCheckedAt: new Date(),
          status: assertClaimTransition(
            claim.status,
            connectorPayerClaimStatus === "DENIED"
              ? "DENIED"
              : connectorPayerClaimStatus === "PAID"
              ? "PAID"
              : claim.status
          ),
          fieldProvenance: mergeProvenance(
            claim.fieldProvenance,
            systemProvenance(
              ["payerClaimStatus"],
              {
                source: "USER_RECORDED",
                label: "Recorded by User",
                sourceDetail: "Manual payer status entry; 276/277 connector not configured",
                verified: true
              }
            )
          )
        }
      });

      let activeDenialCase = null;
      if (["DENIED", "PARTIALLY_APPROVED"].includes(connectorPayerClaimStatus)) {
        activeDenialCase = await findActiveDenialCase(tx, claim.id);

        if (!activeDenialCase) {
          const claimed = Number(claim.amount || 0);
          const paid = Number(claim.paidAmount || 0);
          const allowedAmount = Number(claim.allowedAmount || 0);
          const revenueAtRisk =
            paid > 0
              ? Math.max(0, differenceMoney(claim.amount, claim.paidAmount))
              : allowedAmount > 0
              ? Math.max(0, differenceMoney(claim.amount, claim.allowedAmount))
              : claimed;

          activeDenialCase = await tx.denialCase.create({
            data: {
              claimId: claim.id,
              source: "PAYER_STATUS",
              status: "OPEN",
              denialCategory: null,
              denialDate: new Date(),
              revenueAtRisk
            }
          });

          await tx.auditEvent.create({
            data: {
              organizationId: orgId(req),
              claimId: claim.id,
              actorUserId: req.user?.id || null,
              action: "DENIAL_CASE_AUTO_CREATED",
              entityType: "DenialCase",
              entityId: activeDenialCase.id,
              outcome: "SUCCESS",
              metadata: {
                payerStatus: connectorPayerClaimStatus
              }
            }
          });
        }
      }

      return { updated: updatedClaim, denialCase: activeDenialCase };
    });

    logJourneyEvent(claim.id, "payer-status-recorded", connectorPayerClaimStatus);
    res.json({
      ...updated,
      denialCase
    });
  } catch (error) {
    console.error("[claim-journey] payer status update failed", {
      claimId: req.params.id,
      message: error.message
    });
    res.status(500).json({ error: "Unable to record payer claim status" });
  }
});

router.patch("/:id/journey/remittance", async (req, res) => {
  try {
    const parsedInput = parseMutation(remittanceMutationSchema, req.body);
    if (!parsedInput.ok) return res.status(400).json(parsedInput.response);
    const input = parsedInput.data;
    const { remittanceStatus } = input;
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null } });
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    if (!isClaimSubmittedOrLater(claim)) {
      return res.status(409).json({
        error: "Claim must be submitted before remittance can be recorded"
      });
    }

    if (claim.remittanceStatus === "POSTED") {
      return res.status(409).json({
        error: "Posted remittance is locked. Reopen the claim before changing it."
      });
    }

    const parseOptionalMoney = (value, name) => {
      if (value == null || value === "") return null;
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) {
        const error = new Error(`${name} must be a non-negative number`);
        error.status = 400;
        throw error;
      }
      const amount = validMoney(value);
      if (amount == null) {
        const error = new Error(`${name} must use at most two decimal places`);
        error.status = 400;
        throw error;
      }
      return amount;
    };

    const allowedAmount = parseOptionalMoney(input.allowedAmount, "Allowed amount");
    const requestedPatientResponsibility = parseOptionalMoney(
      input.patientResponsibility,
      "Patient responsibility"
    );
    const paidAmount = parseOptionalMoney(input.paidAmount, "Paid amount");

    if (
      ["RECEIVED", "POSTED"].includes(remittanceStatus) &&
      (allowedAmount == null || paidAmount == null)
    ) {
      return res.status(400).json({
        error:
          "Allowed amount and paid amount are required when remittance is received or posted"
      });
    }

    if (
      allowedAmount != null &&
      paidAmount != null &&
      moneyCents(paidAmount) > moneyCents(allowedAmount)
    ) {
      return res.status(400).json({
        error: "Paid amount cannot exceed allowed amount"
      });
    }

    // If payer responsibility is not explicitly supplied, estimate the
    // remaining patient responsibility as allowed - payer paid. This is an
    // estimate only; an 835/ERA patient-responsibility value remains the source
    // of truth when available. Claimed - paid is NOT used because contractual
    // adjustments are not automatically patient responsibility.
    const patientResponsibility =
      requestedPatientResponsibility != null
        ? requestedPatientResponsibility
        : allowedAmount != null && paidAmount != null
        ? Math.max(0, differenceMoney(allowedAmount, paidAmount))
        : null;

    const normalizedPaymentReference =
      typeof input.paymentReference === "string"
        ? input.paymentReference.trim() || null
        : null;

    const connector = createPayerConnector("LOCAL");
    const remittance = connector.getRemittance(claim, {
      remittanceStatus,
      allowedAmount,
      paidAmount,
      patientResponsibility: requestedPatientResponsibility,
      paymentReference: normalizedPaymentReference
    });

    const connectorAllowedAmount = remittance.allowedAmount;
    const connectorPaidAmount = remittance.paidAmount;
    const connectorPatientResponsibility = remittance.patientResponsibility;
    const connectorPaymentReference = remittance.paymentReference;

    const remittanceUnchanged =
      claim.remittanceStatus === remittanceStatus &&
      (claim.allowedAmount == null ? null : validMoney(claim.allowedAmount)) === connectorAllowedAmount &&
      (claim.patientResponsibility == null ? null : validMoney(claim.patientResponsibility)) === (connectorPatientResponsibility == null ? null : validMoney(connectorPatientResponsibility)) &&
      (claim.paidAmount == null ? null : validMoney(claim.paidAmount)) === connectorPaidAmount &&
      (claim.paymentReference || null) === connectorPaymentReference;

    if (remittanceUnchanged) {
      return res.json({
        ...claim,
        unchanged: true,
        message: "Remittance information is already up to date"
      });
    }

    const remittanceProvenance = {
      ...systemProvenance(
        ["allowedAmount", "paidAmount", "paymentReference"],
        {
          source: "USER_RECORDED",
          label: "Recorded Remittance",
          sourceDetail: "Manual remittance entry; 835 ERA connector not configured",
          verified: true
        }
      ),
      ...systemProvenance(
        ["patientResponsibility"],
        requestedPatientResponsibility != null
          ? {
              source: "USER_RECORDED",
              label: "Recorded Remittance",
              sourceDetail: "Entered from remittance/EOB",
              verified: true
            }
          : {
              source: "CALCULATED_ESTIMATE",
              label: "Calculated Estimate",
              sourceDetail: "Allowed Amount − Paid Amount",
              verified: false
            }
      ),
      ...systemProvenance(
        ["approvedAmount"],
        {
          source: "DERIVED",
          label: "Derived from Allowed Amount",
          sourceDetail: "Remittance workflow",
          verified: false
        }
      )
    };

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        remittanceStatus,
        remittanceReceivedAt:
          remittanceStatus === "RECEIVED" || remittanceStatus === "POSTED"
            ? new Date()
            : null,
        allowedAmount: connectorAllowedAmount,
        patientResponsibility: connectorPatientResponsibility,
        paidAmount: connectorPaidAmount,
        paymentReference: connectorPaymentReference,
        approvedAmount: connectorAllowedAmount,
        fieldProvenance: mergeProvenance(
          claim.fieldProvenance,
          remittanceProvenance
        ),
        status: assertClaimTransition(
          claim.status,
          remittanceStatus === "POSTED" && connectorPaidAmount != null && connectorPaidAmount > 0
            ? "PAID"
            : claim.payerClaimStatus === "DENIED"
            ? "DENIED"
            : claim.status
        )
      }
    });

    logJourneyEvent(claim.id, "remittance-recorded", remittanceStatus);
    res.json(updated);
  } catch (error) {
    console.error("[claim-journey] remittance update failed", {
      claimId: req.params.id,
      message: error.message
    });
    res.status(error.status || 500).json({
      error: error.status ? error.message : "Unable to record remittance"
    });
  }
});

export default router;
