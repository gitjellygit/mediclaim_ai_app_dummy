import express from "express";
import { auditOnResponse } from "../services/auditLog.js";
import { emptyMutationSchema, parseMutation, priorAuthEvaluationSchema, payerClaimStatusSchema, remittanceMutationSchema, payerConnectorConnectionSchema } from "../validation/claimMutations.js";
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
import { getMockPayer, payerInputFingerprint } from "../services/payerSimulator.js";
import { assertClaimTransition } from "../services/workflowStateMachine.js";
import { isClaimLocked, isClaimSubmittedOrLater } from "../services/claimLock.js";
import { createPayerConnector, createPayerConnectorForClaim, payerConnectorStatusForClaim } from "../services/payerGateway.js";
import { findActiveDenialCase } from "../services/denialCaseLifecycle.js";
import { requirePermission } from "../middleware/auth.js";
import { PERMISSIONS, hasPermission } from "../security/permissions.js";
import { minimumNecessaryClaim } from "../security/phiView.js";

const router = express.Router();

router.use((req, res, next) => {
  const path = req.path;
  const claimId = /^\/([^/]+)\/journey/.exec(path)?.[1] || null;
  const action =
    req.method === "GET" && /\/journey$/.test(path) ? "CLAIM_JOURNEY_VIEWED" :
    /\/payer-connection$/.test(path) ? "PAYER_CONNECTED" :
    /\/eligibility\/precheck$/.test(path) ? "ELIGIBILITY_CHECKED" :
    /\/prior-auth\/evaluate$/.test(path) ? "PRIOR_AUTH_EVALUATED" :
    /\/claim-status\/refresh$/.test(path) ? "PAYER_STATUS_REFRESHED" :
    /\/claim-status$/.test(path) ? "PAYER_STATUS_UPDATED" :
    /\/remittance\/refresh$/.test(path) ? "ERA_835_REFRESHED" :
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

function stripSensitivePayerPayload(value) {
  if (Array.isArray(value)) return value.map(stripSensitivePayerPayload);
  if (!value || typeof value !== "object") return value;
  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    if (["raw", "x12"].includes(key)) continue;
    safe[key] = stripSensitivePayerPayload(item);
  }
  return safe;
}

function sanitizePayerTransaction(transaction) {
  if (!transaction) return transaction;
  return {
    ...transaction,
    requestPayload: stripSensitivePayerPayload(transaction.requestPayload),
    responsePayload: stripSensitivePayerPayload(transaction.responsePayload)
  };
}

function sanitizeClaimPayerTransactions(claim) {
  if (!claim || !Array.isArray(claim.payerTransactions)) return claim;
  return {
    ...claim,
    payerTransactions: claim.payerTransactions.map(sanitizePayerTransaction)
  };
}

function sendConnectorFailure(res, error, operation) {
  if (error?.code === "PAYER_CONNECTOR_UNAVAILABLE") {
    res.status(503).json({
      error: `${operation} connector is not configured`,
      code: error.code
    });
    return true;
  }
  if (["STEDI_REQUEST_INVALID", "AVAILITY_REQUEST_INVALID"].includes(error?.code)) {
    res.status(400).json({
      error: "The claim is missing information required for the payer request",
      code: error.code
    });
    return true;
  }
  if (["STEDI_API_ERROR", "AVAILITY_API_ERROR"].includes(error?.code)) {
    const upstreamStatus = Number(error?.status || 0);
    const status = upstreamStatus === 429 ? 503 : 502;
    res.status(status).json({
      error:
        upstreamStatus === 429
          ? `${operation} service is temporarily rate limited. Please retry.`
          : `External ${operation.toLowerCase()} service request failed`,
      code: error.code
    });
    return true;
  }
  if (
    error?.name === "AbortError" ||
    error?.name === "TimeoutError" ||
    error?.code === "ABORT_ERR"
  ) {
    res.status(504).json({
      error: `External ${operation.toLowerCase()} service timed out`,
      code: "PAYER_CONNECTOR_TIMEOUT"
    });
    return true;
  }
  return false;
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

router.get("/:id/journey", requirePermission(PERMISSIONS.INSURANCE_VIEW), async (req, res) => {
  try {
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: {
        documents: { orderBy: { createdAt: "desc" } },
        checks: { orderBy: { createdAt: "desc" }, take: 1 },
        payerTransactions: { orderBy: { createdAt: "desc" }, take: 25 },
        denialCases: {
          where: {
            status: {
              in: [
                "OPEN",
                "ANALYZED",
                "CORRECTION_REQUIRED",
                "APPEAL_PREPARED",
                "APPEAL_SUBMITTED",
                "RESUBMITTED"
              ]
            }
          },
          orderBy: { updatedAt: "desc" },
          take: 1
        },
        underpaymentCase: true
      }
    });

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    const sanitizedClaim = sanitizeClaimPayerTransactions(claim);

    const stages = buildJourneyState(claim);
    if (!hasPermission(req.user, PERMISSIONS.FINANCIAL_VIEW)) {
      delete stages.remittance;
    }

    res.json({
      claim: minimumNecessaryClaim(
        {
          ...sanitizedClaim,
          automationSummary: buildAutomationSummary(claim),
          completenessSummary: buildClaimCompleteness(claim)
        },
        req.user
      ),
      stages,
      payerConnection: {
        mode: claim.payerConnectionMode || "LOCAL",
        simulatedPayerCode: claim.simulatedPayerCode || null,
        simulatedPayer: claim.simulatedPayerCode
          ? getMockPayer(claim.simulatedPayerCode)
          : null,
        connector: payerConnectorStatusForClaim(claim)
      },
      livePayerConnectorConfigured:
        payerConnectorStatusForClaim(claim).mode === "LIVE" &&
        payerConnectorStatusForClaim(claim).configured
    });
  } catch (error) {
    if (error?.status) throw error;
    console.error("[claim-journey] load failed", {
      claimId: req.params.id,
      message: error.message
    });
    res.status(500).json({ error: "Unable to load claim journey" });
  }
});

router.post(
  "/:id/journey/payer-connection",
  requirePermission(PERMISSIONS.PAYER_CONNECT),
  async (req, res) => {
  try {
    const parsedInput = parseMutation(payerConnectorConnectionSchema, req.body);
    if (!parsedInput.ok) return res.status(400).json(parsedInput.response);
    const { connectorId, payerCode, payerName } = parsedInput.data;

    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null }
    });
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    if (isClaimLocked(claim)) {
      return res.status(409).json({
        error: "Payer connection cannot be changed after claim submission"
      });
    }

    let connector;
    try {
      connector = payerConnectorStatusForClaim({
        ...claim,
        payerConnectionMode: "LIVE",
        payerConnectorId: connectorId
      });
    } catch {
      return res.status(400).json({ error: "Unknown payer connector" });
    }

    if (connector.mode !== "LIVE") {
      return res.status(400).json({ error: "External payer connector is required" });
    }
    if (!connector.configured) {
      return res.status(409).json({
        error: `${connector.provider} ${connector.environment.toLowerCase()} connector is not configured`
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedClaim = await tx.claim.update({
        where: { id: claim.id },
        data: {
          payerConnectionMode: "LIVE",
          payerConnectorId: connector.id,
          connectedPayerCode: payerCode,
          connectedPayerName: payerName || null,
          simulatedPayerCode: null,
          eligibilityStatus: "NOT_CHECKED",
          eligibilityCheckedAt: null,
          coverageStatus: null,
          networkStatus: null,
          deductibleRemaining: null,
          coinsurancePct: null,
          priorAuthRequired: null,
          priorAuthStatus: "NOT_CHECKED",
          priorAuthCheckedAt: null,
          authorizationNo: null,
          priorAuthExpiry: null
        }
      });

      await markReadinessChecksStale(tx, claim.id, "Payer connection changed");
      return updatedClaim;
    });

    res.json({
      connector,
      claim: updated
    });
  } catch (error) {
    if (error?.status) throw error;
    console.error("[claim-journey] payer connection failed", {
      claimId: req.params.id,
      code: error?.code || null
    });
    res.status(500).json({ error: "Unable to connect payer" });
  }
});

router.post("/:id/journey/eligibility/precheck", requirePermission(PERMISSIONS.PAYER_ACTION), async (req, res) => {
  try {
    const parsedInput = parseMutation(emptyMutationSchema, req.body);
    if (!parsedInput.ok) return res.status(400).json(parsedInput.response);
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null } });
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    // Eligibility is idempotent when the payer/member inputs have not changed,
    // including stable negative results such as inactive/member-not-found.
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

    const eligibilityFingerprint = payerInputFingerprint(
      "ELIGIBILITY",
      { code: claim.connectedPayerCode || claim.payerEdiId || claim.payerConnectorId || claim.payerName || "PAYER" },
      claim
    );
    const latestEligibilityTransaction = await prisma.payerTransaction.findFirst({
      where: {
        claimId: claim.id,
        transactionType: "ELIGIBILITY"
      },
      orderBy: { createdAt: "desc" }
    });

    if (
      latestEligibilityTransaction?.requestPayload?.inputFingerprint === eligibilityFingerprint &&
      ["ACTIVE", "INACTIVE", "MEMBER_NOT_FOUND", "FAILED", "NEEDS_REVIEW"].includes(
        latestEligibilityTransaction.status
      )
    ) {
      return res.json({
        unchanged: true,
        message: "Eligibility is already current for the existing payer/member information",
        status: claim.eligibilityStatus,
        coverageStatus: claim.coverageStatus,
        livePayerVerification:
          latestEligibilityTransaction.mode === "PRODUCTION" ||
          latestEligibilityTransaction.responsePayload?.livePayerVerification === true,
        transaction: sanitizePayerTransaction(latestEligibilityTransaction),
        claim
      });
    }

    const connector = createPayerConnectorForClaim(
      claim,
      claim.connectedPayerCode || claim.payerEdiId || claim.simulatedPayerCode
    );
    const eligibility = await connector.checkEligibility(claim);
    const now = new Date();
    const missing = eligibility.missingFields || [];
    const eligibilityStatus =
      eligibility.status === "ACTIVE"
        ? "VERIFIED"
        : eligibility.status === "NEEDS_REVIEW"
        ? "NEEDS_REVIEW"
        : "FAILED";
    const coverageStatus = eligibility.coverageStatus || "UNKNOWN";

    const { updated, payerTransaction } = await prisma.$transaction(async (tx) => {
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
                source:
                  connector.connectorEnvironment === "LOCAL"
                    ? "LOCAL_PRECHECK"
                    : connector.connectorId || "LOCAL_PRECHECK",
                label:
                  connector.connectorEnvironment === "SANDBOX"
                    ? `${connector.connectorProvider} Sandbox Eligibility`
                    : connector.connectorEnvironment === "TEST"
                    ? `${connector.connectorProvider} Test Eligibility`
                    : connector.connectorEnvironment === "PRODUCTION"
                    ? `${connector.connectorProvider} Eligibility`
                    : "Local Pre-check",
                sourceDetail:
                  connector.connectorEnvironment === "SANDBOX"
                    ? "External sandbox 270/271 eligibility response"
                    : connector.connectorEnvironment === "TEST"
                    ? "External test-mode 270/271 eligibility response"
                    : connector.connectorEnvironment === "PRODUCTION"
                    ? "External production 270/271 eligibility response"
                    : "No live 270/271 payer connector configured",
                verified: connector.connectorEnvironment === "PRODUCTION"
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

      let transaction = null;
      if (["SANDBOX", "TEST", "PRODUCTION"].includes(connector.connectorEnvironment)) {
        transaction = await tx.payerTransaction.create({
          data: {
            claimId: claim.id,
            transactionId:
              eligibility.transactionId ||
              `${connector.connectorId}-ELIG-${claim.id}-${Date.now()}`,
            mode: connector.connectorEnvironment,
            payerCode: claim.connectedPayerCode || claim.payerEdiId || claim.payerName,
            transactionType: "ELIGIBILITY",
            status: eligibility.status,
            latencyMs: eligibility.latencyMs || null,
            requestPayload: {
              transaction: "270/271",
              connectorId: connector.connectorId,
              testMode: ["SANDBOX", "TEST"].includes(connector.connectorEnvironment),
              inputFingerprint: eligibilityFingerprint,
              payerCode:
                claim.connectedPayerCode ||
                claim.payerEdiId ||
                claim.simulatedPayerCode ||
                claim.payerConnectorId ||
                null,
              payerName: claim.connectedPayerName || claim.payerName || null,
              memberId: claim.memberId || null,
              policyNo: claim.policyNo || null
            },
            responsePayload: eligibility
          }
        });
      }

      return { updated: updatedClaim, payerTransaction: transaction };
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
      livePayerVerification: connector.connectorEnvironment === "PRODUCTION",
      connector: {
        id: connector.connectorId || "LOCAL",
        provider: connector.connectorProvider || "CLAIM_APP",
        environment: connector.connectorEnvironment || "LOCAL"
      },
      transaction: sanitizePayerTransaction(payerTransaction),
      claim: updated
    });
  } catch (error) {
    console.error("[claim-journey] eligibility precheck failed", {
      claimId: req.params.id,
      code: error?.code || null
    });
    if (sendConnectorFailure(res, error, "Eligibility")) return;
    if (error?.status && Number(error.status) < 500) throw error;
    res.status(500).json({ error: "Eligibility pre-check failed. Please retry." });
  }
});

router.post("/:id/journey/prior-auth/evaluate", requirePermission(PERMISSIONS.PAYER_ACTION), async (req, res) => {
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

    const updated = await prisma.$transaction(async (tx) => {
      const updatedClaim = await tx.claim.update({
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
        tx,
        claim.id,
        "Prior authorization information changed"
      );

      if (claim.status === "READY") {
        await tx.claim.update({
          where: { id: claim.id },
          data: { status: assertClaimTransition(claim.status, "DRAFT") }
        });
      }

      return updatedClaim;
    });

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
    if (error?.status) throw error;
    console.error("[claim-journey] prior auth evaluation failed", {
      claimId: req.params.id,
      message: error.message
    });
    res.status(500).json({ error: "Prior authorization update failed. Please retry." });
  }
});

router.post("/:id/journey/claim-status/refresh", requirePermission(PERMISSIONS.PAYER_ACTION), async (req, res) => {
  try {
    const parsedInput = parseMutation(emptyMutationSchema, req.body);
    if (!parsedInput.ok) return res.status(400).json(parsedInput.response);

    const claim = await prisma.claim.findFirst({
      where: {
        id: req.params.id,
        organizationId: orgId(req),
        deletedAt: null
      }
    });
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    if (!isClaimSubmittedOrLater(claim)) {
      return res.status(409).json({
        error: "Claim must be submitted before a 276/277 status check can run"
      });
    }

    const finalStatuses = ["APPROVED", "PARTIALLY_APPROVED", "DENIED", "PAID"];
    if (finalStatuses.includes(claim.payerClaimStatus)) {
      return res.json({
        unchanged: true,
        message: "Payer claim status is already final",
        claim
      });
    }

    const connectorStatus = payerConnectorStatusForClaim(claim);
    if (
      connectorStatus.mode !== "LIVE" ||
      !connectorStatus.configured ||
      !connectorStatus.capabilities.includes("getStatus")
    ) {
      return res.status(409).json({
        error: "The connected payer does not support configured 276/277 claim status checks",
        code: "CLAIM_STATUS_CONNECTOR_UNAVAILABLE"
      });
    }

    const connector = createPayerConnectorForClaim(claim);
    const result = await connector.getStatus(claim);
    const now = new Date();
    const storableStatuses = new Set([
      "ACKNOWLEDGED",
      "IN_REVIEW",
      "APPROVED",
      "PARTIALLY_APPROVED",
      "DENIED",
      "PAID"
    ]);
    const normalizedStatus = storableStatuses.has(result.status)
      ? result.status
      : null;

    const transactionMode =
      result.livePayerVerification === true
        ? "PRODUCTION"
        : connector.connectorEnvironment;

    const transaction = await prisma.payerTransaction.create({
      data: {
        claimId: claim.id,
        transactionId:
          result.transactionId ||
          `${connector.connectorId}-STATUS-${claim.id}-${Date.now()}`,
        mode: transactionMode,
        payerCode:
          claim.connectedPayerCode ||
          claim.payerEdiId ||
          claim.payerName ||
          connector.connectorProvider,
        transactionType: "CLAIM_STATUS",
        status: result.status || "NEEDS_REVIEW",
        latencyMs: result.latencyMs || null,
        requestPayload: {
          transaction: "276",
          responseTransaction: "277",
          connectorId: connector.connectorId,
          productionPayerResponse: result.livePayerVerification === true
        },
        responsePayload: result
      }
    });

    if (!normalizedStatus) {
      return res.json({
        unchanged: true,
        available: result.status !== "UNAVAILABLE",
        message:
          result.status === "NOT_FOUND"
            ? "The payer did not return a matching claim for this 276 request"
            : result.status === "NEEDS_REVIEW"
            ? "The payer returned multiple possible claims; review the 277 response before updating status"
            : "The payer could not provide a usable claim status response",
        result: stripSensitivePayerPayload(result),
        transaction: sanitizePayerTransaction(transaction),
        claim
      });
    }

    const { updated, denialCase } = await prisma.$transaction(async (tx) => {
      const updatedClaim = await tx.claim.update({
        where: { id: claim.id },
        data: {
          payerClaimStatus: normalizedStatus,
          claimStatusCheckedAt: now,
          insurerClaimNo: result.payerClaimNo || claim.insurerClaimNo,
          status: assertClaimTransition(
            claim.status,
            normalizedStatus === "DENIED"
              ? "DENIED"
              : normalizedStatus === "PAID"
              ? "PAID"
              : claim.status
          ),
          fieldProvenance: mergeProvenance(
            claim.fieldProvenance,
            systemProvenance(
              ["payerClaimStatus", "insurerClaimNo"],
              {
                source: "PAYER_277",
                label: "277 Claim Status Response",
                sourceDetail:
                  result.statusCategoryCode && result.statusCode
                    ? `Stedi 277 ${result.statusCategoryCode}/${result.statusCode}`
                    : "Stedi 276/277 real-time claim status",
                verified: result.livePayerVerification === true
              }
            )
          )
        }
      });

      let activeDenialCase = null;
      if (["DENIED", "PARTIALLY_APPROVED"].includes(normalizedStatus)) {
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
              denialDate: now,
              revenueAtRisk,
              sourceTransactionId: transaction.transactionId,
              payerEvidence: {
                claimStatus277: {
                  transactionId: transaction.transactionId,
                  payerClaimNo: result.payerClaimNo || null,
                  statusCategoryCode: result.statusCategoryCode || null,
                  statusCode: result.statusCode || null,
                  status: normalizedStatus
                }
              }
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
                payerStatus: normalizedStatus,
                sourceTransactionId: transaction.transactionId
              }
            }
          });
        }
      }

      return { updated: updatedClaim, denialCase: activeDenialCase };
    });

    logJourneyEvent(claim.id, "payer-status-277", normalizedStatus, {
      connectorId: connector.connectorId
    });

    return res.json({
      message: "276/277 claim status refreshed",
      result,
      transaction,
      claim: updated,
      denialCase,
      paymentNotice:
        result.amountPaid != null
          ? "The 277 reported a payment amount. Payment fields remain unchanged until an 835 ERA is received."
          : null
    });
  } catch (error) {
    console.error("[claim-journey] external claim status refresh failed", {
      claimId: req.params.id,
      code: error?.code || null
    });

    if (sendConnectorFailure(res, error, "Claim status")) return;
    if (error?.status && Number(error.status) < 500) throw error;

    return res.status(500).json({
      error: "Unable to refresh payer claim status"
    });
  }
});

router.patch("/:id/journey/claim-status", requirePermission(PERMISSIONS.PAYER_ACTION), async (req, res) => {
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
    if (error?.status) throw error;
    console.error("[claim-journey] payer status update failed", {
      claimId: req.params.id,
      message: error.message
    });
    res.status(500).json({ error: "Unable to record payer claim status" });
  }
});

router.post("/:id/journey/remittance/refresh", requirePermission(PERMISSIONS.PAYER_ACTION), requirePermission(PERMISSIONS.FINANCIAL_VIEW), async (req, res) => {
  try {
    const parsedInput = parseMutation(emptyMutationSchema, req.body);
    if (!parsedInput.ok) return res.status(400).json(parsedInput.response);

    const claim = await prisma.claim.findFirst({
      where: {
        id: req.params.id,
        organizationId: orgId(req),
        deletedAt: null
      },
      include: {
        payerTransactions: { orderBy: { createdAt: "desc" }, take: 50 }
      }
    });
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    if (!isClaimSubmittedOrLater(claim)) {
      return res.status(409).json({
        error: "Claim must be submitted before an 835 ERA can be retrieved"
      });
    }

    if (claim.remittanceStatus === "POSTED") {
      return res.json({
        unchanged: true,
        message: "Remittance is already posted",
        claim: sanitizeClaimPayerTransactions(claim)
      });
    }

    const connectorStatus = payerConnectorStatusForClaim(claim);
    if (
      connectorStatus.mode !== "LIVE" ||
      !connectorStatus.configured ||
      !connectorStatus.capabilities.includes("getRemittance")
    ) {
      return res.status(409).json({
        error: "The connected payer does not support configured 835 ERA retrieval",
        code: "ERA_CONNECTOR_UNAVAILABLE"
      });
    }

    const submissionTransaction = claim.payerTransactions.find(
      (item) => item.transactionType === "CLAIM_SUBMISSION"
    );
    const expectedPatientControlNumber =
      claim.patientControlNumber ||
      submissionTransaction?.responsePayload?.patientControlNumber ||
      submissionTransaction?.requestPayload?.patientControlNumber ||
      submissionTransaction?.requestPayload?.claimInformation?.patientControlNumber ||
      null;

    if (!expectedPatientControlNumber) {
      return res.status(409).json({
        error:
          "The claim has no Patient Control Number correlation key from its 837 submission. Retrieve/post the 835 only after the submission correlation is available.",
        code: "ERA_CORRELATION_KEY_MISSING"
      });
    }

    const connector = createPayerConnectorForClaim(claim);
    const result = await connector.getRemittance(claim, {
      expectedPatientControlNumber,
      startDateTime: claim.claimSubmissionDate || null
    });

    if (["NOT_AVAILABLE", "NOT_FOUND"].includes(result.status)) {
      return res.json({
        unchanged: true,
        available: false,
        message: "No matching 835 ERA is available yet",
        result: stripSensitivePayerPayload(result),
        claim: sanitizeClaimPayerTransactions(claim)
      });
    }

    if (result.status === "NEEDS_REVIEW") {
      return res.json({
        unchanged: true,
        available: true,
        needsReview: true,
        message:
          "Multiple 835 ERA transactions match this claim. Review the candidate transactions before posting.",
        result: stripSensitivePayerPayload(result),
        claim: sanitizeClaimPayerTransactions(claim)
      });
    }

    if (result.status !== "POSTED" || !result.transactionId) {
      return res.status(502).json({
        error: "The payer returned an unusable 835 ERA response",
        code: "ERA_RESPONSE_INVALID"
      });
    }

    const existingTransaction = await prisma.payerTransaction.findFirst({
      where: {
        transactionId: result.transactionId,
        claimId: claim.id
      }
    });
    if (existingTransaction) {
      return res.json({
        unchanged: true,
        message: "This 835 ERA has already been posted to the claim",
        result: stripSensitivePayerPayload(existingTransaction.responsePayload),
        transaction: sanitizePayerTransaction(existingTransaction),
        claim: sanitizeClaimPayerTransactions(claim)
      });
    }

    const numericFields = [
      ["billedAmount", result.billedAmount],
      ["allowedAmount", result.allowedAmount],
      ["paidAmount", result.paidAmount],
      ["patientResponsibility", result.patientResponsibility]
    ];
    const invalidMoney = numericFields.find(
      ([, value]) => value != null && (!Number.isFinite(Number(value)) || Number(value) < 0)
    );
    if (invalidMoney) {
      return res.status(409).json({
        error:
          "This 835 contains a reversal or unsupported negative financial value and needs manual review before posting.",
        code: "ERA_FINANCIAL_REVIEW_REQUIRED",
        field: invalidMoney[0]
      });
    }

    const now = new Date();
    const firstAdjustment = (result.adjustments || []).find(
      (item) => item?.reasonCode || item?.reason
    );
    const isDeniedEra = String(result.claimStatusCode || "") === "4";
    const underpaymentAmount = Number(result.potentialUnderpayment || 0);

    let posted;
    try {
      posted = await prisma.$transaction(async (tx) => {
      const transaction = await tx.payerTransaction.create({
        data: {
          claimId: claim.id,
          transactionId: result.transactionId,
          mode: result.testMode ? "TEST" : "PRODUCTION",
          payerCode:
            claim.payerEdiId ||
            claim.payerName ||
            connector.connectorProvider ||
            "UNKNOWN",
          transactionType: "REMITTANCE",
          status: "POSTED",
          latencyMs: result.latencyMs || null,
          requestPayload: {
            transaction: "835",
            connectorId: connector.connectorId,
            patientControlNumber: expectedPatientControlNumber,
            externalTransactionId: result.transactionId
          },
          responsePayload: result
        }
      });

      const financialUpdates = {
        patientControlNumber: expectedPatientControlNumber,
        remittanceStatus: "POSTED",
        remittanceReceivedAt: now,
        paidAmount: result.paidAmount,
        patientResponsibility: result.patientResponsibility,
        paymentReference: result.paymentReference || result.transactionId,
        fieldProvenance: mergeProvenance(
          claim.fieldProvenance,
          systemProvenance(
            [
              "remittanceStatus",
              "allowedAmount",
              "approvedAmount",
              "paidAmount",
              "patientResponsibility",
              "paymentReference"
            ],
            {
              source: "PAYER_835",
              label: "835 ERA",
              sourceDetail: result.testMode
                ? "Stedi test ERA"
                : "Stedi production ERA",
              verified: result.testMode !== true
            }
          )
        )
      };
      if (result.allowedAmount != null) {
        financialUpdates.allowedAmount = result.allowedAmount;
        financialUpdates.approvedAmount = result.allowedAmount;
      }

      const updatedClaim = await tx.claim.update({
        where: { id: claim.id },
        data: financialUpdates
      });

      let denialCase = null;
      if (isDeniedEra) {
        const eraEvidence = {
          transactionType: "835",
          transactionId: result.transactionId,
          claimStatusCode: result.claimStatusCode || null,
          billedAmount: result.billedAmount ?? null,
          allowedAmount: result.allowedAmount ?? null,
          paidAmount: result.paidAmount ?? null,
          patientResponsibility: result.patientResponsibility ?? null,
          adjustments: Array.isArray(result.adjustments) ? result.adjustments : []
        };

        denialCase = await findActiveDenialCase(tx, claim.id);
        if (!denialCase) {
          denialCase = await tx.denialCase.create({
            data: {
              claimId: claim.id,
              source: "ERA",
              status: "OPEN",
              denialCategory: "ERA_ADJUDICATION",
              groupCode: firstAdjustment?.groupCode || null,
              carcCode: firstAdjustment?.reasonCode || null,
              reasonText:
                firstAdjustment?.reason ||
                "835 ERA indicates the claim was denied",
              denialDate: now,
              revenueAtRisk: Math.max(
                0,
                Number(result.billedAmount ?? claim.amount ?? 0) -
                  Number(result.paidAmount || 0)
              ),
              sourceTransactionId: result.transactionId,
              payerEvidence: { era835: eraEvidence },
              recommendedAction:
                "Review the 835 adjustment codes and supporting claim data."
            }
          });
        } else {
          denialCase = await tx.denialCase.update({
            where: { id: denialCase.id },
            data: {
              groupCode: denialCase.groupCode || firstAdjustment?.groupCode || null,
              carcCode: denialCase.carcCode || firstAdjustment?.reasonCode || null,
              reasonText:
                denialCase.reasonText ||
                firstAdjustment?.reason ||
                "835 ERA indicates the claim was denied",
              payerEvidence: {
                ...(denialCase.payerEvidence && typeof denialCase.payerEvidence === "object"
                  ? denialCase.payerEvidence
                  : {}),
                era835: eraEvidence
              }
            }
          });
        }
      }

      let underpaymentCase = null;
      const existingUnderpaymentCase = await tx.underpaymentCase.findUnique({
        where: { claimId: claim.id }
      });

      if (
        !isDeniedEra &&
        result.expectedPayerPayment != null &&
        result.paidAmount != null &&
        underpaymentAmount <= 0.009 &&
        existingUnderpaymentCase &&
        !["RECOVERED", "WRITTEN_OFF", "CLOSED"].includes(existingUnderpaymentCase.status)
      ) {
        underpaymentCase = await tx.underpaymentCase.update({
          where: { claimId: claim.id },
          data: {
            status: "RECOVERED",
            actualPaidAmount: result.paidAmount,
            recoveredAmount: existingUnderpaymentCase.varianceAmount,
            sourceTransactionId: result.transactionId,
            resolvedAt: now,
            notes: existingUnderpaymentCase.notes
              ? `${existingUnderpaymentCase.notes}\nAuto-resolved after later 835 payment satisfied expected payer amount.`
              : "Auto-resolved after later 835 payment satisfied expected payer amount."
          }
        });
      } else if (
        !isDeniedEra &&
        result.expectedPayerPayment != null &&
        result.paidAmount != null &&
        underpaymentAmount > 0.009
      ) {
        underpaymentCase = await tx.underpaymentCase.upsert({
          where: { claimId: claim.id },
          create: {
            claimId: claim.id,
            expectedPayerPayment: result.expectedPayerPayment,
            actualPaidAmount: result.paidAmount,
            varianceAmount: underpaymentAmount,
            sourceTransactionId: result.transactionId,
            reasonCategory: "PAYER_PAYMENT_BELOW_EXPECTED"
          },
          update: {
            expectedPayerPayment: result.expectedPayerPayment,
            actualPaidAmount: result.paidAmount,
            varianceAmount: underpaymentAmount,
            sourceTransactionId: result.transactionId,
            detectedAt: now,
            status:
              existingUnderpaymentCase &&
              ["RECOVERED", "WRITTEN_OFF", "CLOSED"].includes(
                existingUnderpaymentCase.status
              )
                ? "OPEN"
                : undefined,
            resolvedAt: null
          }
        });
      }

        return { transaction, updatedClaim, denialCase, underpaymentCase };
      });
    } catch (error) {
      if (error?.code === "P2002") {
        const duplicateTransaction = await prisma.payerTransaction.findFirst({
          where: {
            transactionId: result.transactionId,
            claimId: claim.id
          }
        });

        if (duplicateTransaction) {
          const currentClaim = await prisma.claim.findFirst({
            where: {
              id: claim.id,
              organizationId: orgId(req),
              deletedAt: null
            }
          });

          return res.json({
            unchanged: true,
            message: "This 835 ERA has already been posted to the claim",
            result: stripSensitivePayerPayload(
              duplicateTransaction.responsePayload
            ),
            transaction: sanitizePayerTransaction(duplicateTransaction),
            claim: sanitizeClaimPayerTransactions(currentClaim || claim)
          });
        }
      }

      throw error;
    }

    logJourneyEvent(claim.id, "era-835-posted", "POSTED", {
      transactionId: result.transactionId,
      testMode: result.testMode === true
    });

    return res.json({
      message: "835 ERA retrieved and posted",
      result: stripSensitivePayerPayload(result),
      transaction: sanitizePayerTransaction(posted.transaction),
      claim: posted.updatedClaim,
      denialCase: posted.denialCase,
      underpaymentCase: posted.underpaymentCase,
      claimStatusNotice:
        "Claim status was not inferred from the 835 payment amount. Use 276/277 for payer claim status."
    });
  } catch (error) {
    console.error("[claim-journey] external ERA refresh failed", {
      claimId: req.params.id,
      code: error?.code || null
    });

    if (sendConnectorFailure(res, error, "835 ERA")) return;
    if (error?.status && Number(error.status) < 500) throw error;

    return res.status(500).json({
      error: "Unable to retrieve 835 ERA"
    });
  }
});

router.patch("/:id/journey/remittance", requirePermission(PERMISSIONS.PAYER_ACTION), requirePermission(PERMISSIONS.FINANCIAL_VIEW), async (req, res) => {
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
    if (error?.status) throw error;
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
