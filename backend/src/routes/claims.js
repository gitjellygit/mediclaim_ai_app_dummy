import { z } from "zod";
import { parseClaimDate } from "../utils/claimDate.js";
import { serveStoredDocument } from "../services/documentResponse.js";
import { deleteStoredDocument } from "../services/documentDeletion.js";
import express from "express";
import { requireRoles } from "../middleware/auth.js";
import fs from "fs";
import { prisma } from "../db.js";
import {
  removeManuallyEditedFields,
  recomputeDerivedClaimPatch
} from "../services/claimDocumentProvenance.js";
import {
  buildAutomationSummary,
  changedFields,
  manualProvenance,
  mergeProvenance,
  removeProvenanceFields,
  systemProvenance
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
import { createPayerConnector } from "../services/payerGateway.js";
import {
  getMockPayer,
  listMockPayers,
  simulateEligibility,
  simulatePriorAuth,
  simulateSubmission,
  simulateStatus,
  simulateRemittance,
  payerInputFingerprint
} from "../services/payerSimulator.js";

const router = express.Router();

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
  const submitted = Boolean(claim.claimSubmissionDate) ||
    ["SUBMITTED", "DENIED", "PAID"].includes(claim.status);

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

router.get("/", async (req, res) => {
  try {
    const claims = await prisma.claim.findMany({
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
    res.status(500).json({ error: error.message });
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
      : {};

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

router.get("/payers/mock", (_req, res) => {
  res.json({
    mode: "SIMULATED",
    payers: listMockPayers()
  });
});

async function createPayerTransaction(claimId, payerCode, transactionType, result, requestPayload = {}) {
  return prisma.payerTransaction.create({
    data: {
      claimId,
      transactionId: result.transactionId,
      mode: "SIMULATED",
      payerCode,
      transactionType,
      status: result.status,
      latencyMs: result.latencyMs || null,
      requestPayload,
      responsePayload: result
    }
  });
}

async function getSimulationClaim(id) {
  return prisma.claim.findUnique({
    where: { id },
    include: {
      documents: { orderBy: { createdAt: "desc" } },
      payerTransactions: { orderBy: { createdAt: "desc" } }
    }
  });
}

router.post("/:id/payer-simulation/connect", async (req, res) => {
  try {
    const payerCode = String(req.body.payerCode || "").trim().toUpperCase();
    const payer = getMockPayer(payerCode);
    if (!payer) return res.status(400).json({ error: "Unknown mock payer" });

    const claim = await prisma.claim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    if (claim.claimSubmissionDate || ["SUBMITTED", "DENIED", "PAID"].includes(claim.status)) {
      return res.status(409).json({
        error: "Payer profile cannot be changed after claim submission"
      });
    }

    if (
      claim.payerConnectionMode === "SIMULATED" &&
      claim.simulatedPayerCode === payer.code
    ) {
      return res.json({ unchanged: true, payer, claim });
    }

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        payerConnectionMode: "SIMULATED",
        simulatedPayerCode: payer.code,
        payerName: payer.name,
        // Changing payer invalidates earlier coverage and authorization responses.
        // A previous payer's approval must not carry over to a new insurer.
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
        priorAuthExpiry: null,
        fieldProvenance: mergeProvenance(
          removeProvenanceFields(claim.fieldProvenance, [
            "eligibilityStatus",
            "coverageStatus",
            "networkStatus",
            "deductibleRemaining",
            "coinsurancePct",
            "priorAuthRequired",
            "priorAuthStatus",
            "authorizationNo",
            "priorAuthExpiry"
          ]),
          systemProvenance(["payerName"], {
            source: "SIMULATED_PAYER",
            label: "Demo Payer Profile",
            sourceDetail: payer.name,
            verified: false
          })
        )
      }
    });

    await markReadinessChecksStale(prisma, claim.id, "Payer profile changed");
    if (claim.status === "READY") {
      await prisma.claim.update({ where: { id: claim.id }, data: { status: "DRAFT" } });
    }

    res.json({
      message: `Connected to ${payer.name} simulator`,
      payer,
      claim: updated
    });
  } catch (error) {
    console.error("[payer-simulation] connect failed", {
      claimId: req.params.id,
      name: error?.name || "Error"
    });
    res.status(500).json({ error: "Unable to connect mock payer" });
  }
});

router.post("/:id/payer-simulation/eligibility", async (req, res) => {
  try {
    const claim = await getSimulationClaim(req.params.id);
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    const payer = getMockPayer(claim.simulatedPayerCode);
    if (claim.payerConnectionMode !== "SIMULATED" || !payer) {
      return res.status(409).json({ error: "Connect a mock payer first" });
    }
    if (claim.claimSubmissionDate || ["SUBMITTED", "DENIED", "PAID"].includes(claim.status)) {
      return res.status(409).json({ error: "Eligibility is locked after claim submission" });
    }

    const eligibilityTransactions = claim.payerTransactions.filter((x) => x.transactionType === "ELIGIBILITY");
    const priorCount = eligibilityTransactions.length;
    const inputFingerprint = payerInputFingerprint("ELIGIBILITY", payer, claim);
    const latestEligibility = eligibilityTransactions[0];
    if (
      latestEligibility?.requestPayload?.inputFingerprint === inputFingerprint &&
      ["ACTIVE", "MEMBER_NOT_FOUND"].includes(latestEligibility.status)
    ) {
      return res.json({
        unchanged: true,
        message: "Eligibility is already current",
        result: latestEligibility.responsePayload,
        transaction: latestEligibility,
        claim
      });
    }

    const result = createPayerConnector(claim.payerConnectionMode, payer.code).checkEligibility(claim, priorCount + 1);
    await new Promise((resolve) => setTimeout(resolve, Math.min(result.latencyMs, 900)));

    const verified = result.status === "ACTIVE";
    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        eligibilityStatus: verified ? "VERIFIED" : "FAILED",
        coverageStatus: result.coverageStatus,
        networkStatus: result.networkStatus,
        deductibleRemaining: result.deductibleRemaining,
        coinsurancePct: result.coinsurancePct,
        eligibilityCheckedAt: new Date(),
        fieldProvenance: mergeProvenance(
          claim.fieldProvenance,
          systemProvenance(
            ["eligibilityStatus", "coverageStatus", "networkStatus", "deductibleRemaining", "coinsurancePct"],
            {
              source: "SIMULATED_PAYER",
              label: "Mock 271 Response",
              sourceDetail: payer.name,
              verified: false
            }
          )
        )
      }
    });

    const transaction = await createPayerTransaction(
      claim.id,
      payer.code,
      "ELIGIBILITY",
      result,
      {
        transaction: "270",
        memberIdPresent: Boolean(claim.memberId),
        policyNoPresent: Boolean(claim.policyNo),
        inputFingerprint
      }
    );
    await markReadinessChecksStale(prisma, claim.id, "Eligibility information changed");

    res.json({ result, transaction, claim: updated, livePayerVerification: false });
  } catch (error) {
    console.error("[payer-simulation] eligibility failed", {
      claimId: req.params.id,
      name: error?.name || "Error"
    });
    res.status(500).json({ error: "Mock eligibility request failed" });
  }
});

router.post("/:id/payer-simulation/prior-auth", async (req, res) => {
  try {
    const claim = await getSimulationClaim(req.params.id);
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    const payer = getMockPayer(claim.simulatedPayerCode);
    if (claim.payerConnectionMode !== "SIMULATED" || !payer) {
      return res.status(409).json({ error: "Connect a mock payer first" });
    }
    if (claim.eligibilityStatus !== "VERIFIED") {
      return res.status(409).json({ error: "Verify eligibility with the payer first" });
    }
    if (claim.claimSubmissionDate || ["SUBMITTED", "DENIED", "PAID"].includes(claim.status)) {
      return res.status(409).json({ error: "Prior authorization is locked after claim submission" });
    }

    const requestedAuthorizationNo =
      typeof req.body?.authorizationNo === "string"
        ? req.body.authorizationNo.trim() || null
        : claim.authorizationNo;

    const claimForAuth = {
      ...claim,
      authorizationNo: requestedAuthorizationNo
    };

    const authTransactions = claim.payerTransactions.filter((x) => x.transactionType === "PRIOR_AUTH");
    const priorCount = authTransactions.length;
    const inputFingerprint = payerInputFingerprint("PRIOR_AUTH", payer, claimForAuth);
    const latestAuth = authTransactions[0];

    if (
      latestAuth?.requestPayload?.inputFingerprint === inputFingerprint &&
      ["NOT_REQUIRED", "APPROVED", "DENIED", "REQUIRED"].includes(latestAuth.status)
    ) {
      return res.json({
        unchanged: true,
        message: "Prior authorization is already current",
        result: latestAuth.responsePayload,
        transaction: latestAuth,
        claim
      });
    }

    const result = createPayerConnector(claim.payerConnectionMode, payer.code).requestPriorAuth(claimForAuth, priorCount + 1);
    await new Promise((resolve) => setTimeout(resolve, Math.min(result.latencyMs, 900)));

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        priorAuthRequired: result.required,
        priorAuthStatus: result.status,
        authorizationNo: result.authorizationNo ?? requestedAuthorizationNo,
        priorAuthExpiry: result.expiry ? new Date(result.expiry) : claim.priorAuthExpiry,
        priorAuthCheckedAt: new Date(),
        fieldProvenance: mergeProvenance(
          claim.fieldProvenance,
          systemProvenance(["priorAuthRequired", "priorAuthStatus", "authorizationNo", "priorAuthExpiry"], {
            source: "SIMULATED_PAYER",
            label: "Mock Prior Auth Response",
            sourceDetail: payer.name,
            verified: false
          })
        )
      }
    });

    const transaction = await createPayerTransaction(
      claim.id,
      payer.code,
      "PRIOR_AUTH",
      result,
      {
        transaction: "278-style",
        procedurePresent: Boolean(claim.procedureText),
        inputFingerprint
      }
    );
    await markReadinessChecksStale(prisma, claim.id, "Prior authorization information changed");

    res.json({ result, transaction, claim: updated });
  } catch (error) {
    console.error("[payer-simulation] prior auth failed", {
      claimId: req.params.id,
      name: error?.name || "Error"
    });
    res.status(500).json({ error: "Mock prior authorization request failed" });
  }
});

router.post("/:id/payer-simulation/submission", async (req, res) => {
  try {
    const claim = await getSimulationClaim(req.params.id);
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    const payer = getMockPayer(claim.simulatedPayerCode);
    if (claim.payerConnectionMode !== "SIMULATED" || !payer) {
      return res.status(409).json({ error: "Connect a mock payer first" });
    }
    if (!claim.claimSubmissionDate && claim.status !== "SUBMITTED") {
      return res.status(409).json({ error: "Submit the claim in Claim Journey first" });
    }

    const submissionTransactions = claim.payerTransactions.filter((x) => x.transactionType === "CLAIM_SUBMISSION");
    const priorCount = submissionTransactions.length;
    const inputFingerprint = payerInputFingerprint("CLAIM_SUBMISSION", payer, claim);
    const latestSubmission = submissionTransactions[0];

    if (
      latestSubmission?.requestPayload?.inputFingerprint === inputFingerprint &&
      ["ACCEPTED", "PENDED", "REJECTED"].includes(latestSubmission.status)
    ) {
      return res.json({
        unchanged: true,
        message: "Claim transmission is already current",
        result: latestSubmission.responsePayload,
        transaction: latestSubmission,
        claim
      });
    }

    const result = createPayerConnector(claim.payerConnectionMode, payer.code).submitClaim(claim, priorCount + 1);
    await new Promise((resolve) => setTimeout(resolve, Math.min(result.latencyMs, 900)));

    const payerClaimStatus =
      result.status === "ACCEPTED" ? "ACKNOWLEDGED" :
      result.status === "PENDED" ? "PENDED" : "REJECTED";

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        payerClaimStatus,
        insurerClaimNo: result.payerClaimNo || claim.insurerClaimNo,
        claimStatusCheckedAt: new Date(),
        fieldProvenance: mergeProvenance(
          claim.fieldProvenance,
          systemProvenance(["payerClaimStatus", "insurerClaimNo"], {
            source: "SIMULATED_PAYER",
            label: "Mock Claim Acknowledgment",
            sourceDetail: payer.name,
            verified: false
          })
        )
      }
    });

    const transaction = await createPayerTransaction(
      claim.id,
      payer.code,
      "CLAIM_SUBMISSION",
      result,
      {
        transaction: "837-style",
        amount: claim.amount || claim.totalBilledAmount || null,
        inputFingerprint
      }
    );

    res.json({ result, transaction, claim: updated });
  } catch (error) {
    console.error("[payer-simulation] submission failed", {
      claimId: req.params.id,
      name: error?.name || "Error"
    });
    res.status(500).json({ error: "Mock claim submission failed" });
  }
});

router.post("/:id/payer-simulation/status", async (req, res) => {
  try {
    const claim = await getSimulationClaim(req.params.id);
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    const payer = getMockPayer(claim.simulatedPayerCode);
    if (claim.payerConnectionMode !== "SIMULATED" || !payer) {
      return res.status(409).json({ error: "Connect a payer first" });
    }
    const transmitted = claim.payerTransactions.find(
      (tx) => tx.transactionType === "CLAIM_SUBMISSION"
    );
    if (!transmitted || !["ACCEPTED", "PENDED"].includes(transmitted.status)) {
      return res.status(409).json({
        error: "Wait until the claim has been transmitted and acknowledged"
      });
    }

    const statusTransactions = claim.payerTransactions.filter((x) => x.transactionType === "CLAIM_STATUS");
    const latestStatus = statusTransactions[0];
    if (latestStatus && ["APPROVED", "PARTIALLY_APPROVED", "DENIED", "PAID"].includes(latestStatus.status)) {
      return res.json({
        unchanged: true,
        message: "Payer status is final",
        result: latestStatus.responsePayload,
        transaction: latestStatus,
        claim
      });
    }

    const result = createPayerConnector(claim.payerConnectionMode, payer.code).getStatus(claim, statusTransactions.length, statusTransactions.length + 1);

    // Polling may legitimately happen more than once, but do not create an
    // endless activity feed when the payer returns the same state repeatedly.
    if (latestStatus?.status === result.status) {
      return res.json({
        unchanged: true,
        message: "Payer status has not changed",
        result,
        transaction: latestStatus,
        claim
      });
    }

    await new Promise((resolve) => setTimeout(resolve, Math.min(result.latencyMs, 900)));

    const overallStatus =
      result.status === "DENIED" ? "DENIED" :
      result.status === "PAID" ? "PAID" : claim.status;

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        payerClaimStatus: result.status,
        claimStatusCheckedAt: new Date(),
        status: overallStatus,
        allowedAmount:
          result.allowedAmount != null ? result.allowedAmount : claim.allowedAmount,
        approvedAmount:
          result.approvedAmount != null ? result.approvedAmount : claim.approvedAmount,
        patientResponsibility:
          result.patientResponsibility != null
            ? result.patientResponsibility
            : claim.patientResponsibility,
        fieldProvenance: mergeProvenance(
          claim.fieldProvenance,
          systemProvenance(["payerClaimStatus"], {
            source: "SIMULATED_PAYER",
            label: "Mock 277 Response",
            sourceDetail: payer.name,
            verified: false
          })
        )
      }
    });

    let denialCase = null;
    if (["DENIED", "PARTIALLY_APPROVED"].includes(result.status)) {
      denialCase = await prisma.denialCase.findFirst({
        where: { claimId: claim.id, status: { in: ["OPEN", "ANALYZED", "CORRECTION_REQUIRED"] } },
        orderBy: { createdAt: "desc" }
      });
      if (!denialCase) {
        denialCase = await prisma.denialCase.create({
          data: {
            claimId: claim.id,
            source: "SIMULATED_PAYER_STATUS",
            status: "OPEN",
            denialCategory: result.status === "DENIED" ? "AUTHORIZATION" : "PAYMENT",
            reasonText: result.reason,
            denialDate: new Date(),
            revenueAtRisk: Math.max(0, Number(claim.amount || 0) - Number(claim.paidAmount || 0)),
            recommendedAction: "Review the simulated payer response and supporting claim data."
          }
        });
      }
    }

    const transaction = await createPayerTransaction(
      claim.id,
      payer.code,
      "CLAIM_STATUS",
      result,
      { transaction: "276", payerClaimNo: claim.insurerClaimNo || null }
    );

    res.json({ result, transaction, claim: updated, denialCase });
  } catch (error) {
    console.error("[payer-simulation] status failed", {
      claimId: req.params.id,
      name: error?.name || "Error"
    });
    res.status(500).json({ error: "Mock payer status request failed" });
  }
});

router.post("/:id/payer-simulation/remittance", async (req, res) => {
  try {
    const claim = await getSimulationClaim(req.params.id);
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    const payer = getMockPayer(claim.simulatedPayerCode);
    if (claim.payerConnectionMode !== "SIMULATED" || !payer) {
      return res.status(409).json({ error: "Connect a mock payer first" });
    }
    if (!["APPROVED", "PARTIALLY_APPROVED", "PAID"].includes(claim.payerClaimStatus || "")) {
      return res.status(409).json({ error: "A final payable payer status is required before remittance" });
    }
    if (claim.remittanceStatus === "POSTED") {
      return res.json({
        unchanged: true,
        message: "Simulated remittance is already posted",
        claim
      });
    }

    const priorCount = claim.payerTransactions.filter((x) => x.transactionType === "REMITTANCE").length;
    const result = createPayerConnector(claim.payerConnectionMode, payer.code).getRemittance(claim, priorCount + 1);
    await new Promise((resolve) => setTimeout(resolve, Math.min(result.latencyMs, 900)));

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        remittanceStatus: "POSTED",
        remittanceReceivedAt: new Date(),
        allowedAmount: result.allowedAmount,
        approvedAmount: result.approvedAmount,
        paidAmount: result.paidAmount,
        patientResponsibility: result.patientResponsibility,
        paymentReference: result.paymentReference,
        status: result.paidAmount > 0 ? "PAID" : claim.status,
        payerClaimStatus: result.paidAmount > 0 ? "PAID" : claim.payerClaimStatus,
        fieldProvenance: mergeProvenance(
          claim.fieldProvenance,
          systemProvenance(
            ["remittanceStatus", "allowedAmount", "paidAmount", "patientResponsibility", "paymentReference"],
            {
              source: "SIMULATED_PAYER",
              label: "Mock 835 Response",
              sourceDetail: payer.name,
              verified: false
            }
          )
        )
      }
    });

    const transaction = await createPayerTransaction(
      claim.id,
      payer.code,
      "REMITTANCE",
      result,
      { transaction: "835-style", payerClaimNo: claim.insurerClaimNo || null }
    );

    res.json({ result, transaction, claim: updated });
  } catch (error) {
    console.error("[payer-simulation] remittance failed", {
      claimId: req.params.id,
      name: error?.name || "Error"
    });
    res.status(500).json({ error: "Mock remittance request failed" });
  }
});

router.get("/:id/journey", async (req, res) => {
  try {
    const claim = await prisma.claim.findUnique({
      where: { id: req.params.id },
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
    const claim = await prisma.claim.findUnique({ where: { id: req.params.id } });
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

    const now = new Date();
    const missing = [];
    if (!claim.memberId) missing.push("memberId");
    if (!claim.policyNo) missing.push("policyNo");
    if (!claim.payerName) missing.push("payerName");

    let eligibilityStatus = "VERIFIED";
    // A local pre-check can validate that we have the minimum identity/policy
    // information required to query a payer, but it cannot prove active coverage.
    // Keep coverage UNKNOWN until a real 271/payer response is recorded.
    let coverageStatus = "UNKNOWN";

    if (missing.length > 0) {
      eligibilityStatus = "NEEDS_REVIEW";
      coverageStatus = "UNKNOWN";
    } else if (claim.policyEndDate && new Date(claim.policyEndDate) < now) {
      eligibilityStatus = "FAILED";
      coverageStatus = "INACTIVE";
    } else if (claim.policyStartDate && new Date(claim.policyStartDate) > now) {
      eligibilityStatus = "FAILED";
      coverageStatus = "NOT_YET_ACTIVE";
    }

    const updated = await prisma.claim.update({
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

    // Journey changes invalidate an old readiness result.
    await markReadinessChecksStale(
      prisma,
      claim.id,
      "Eligibility information changed"
    );
    if (claim.status === "READY") {
      await prisma.claim.update({
        where: { id: claim.id },
        data: { status: "DRAFT" }
      });
    }

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
    const claim = await prisma.claim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    if (
      claim.claimSubmissionDate ||
      ["SUBMITTED", "DENIED", "PAID"].includes(claim.status)
    ) {
      return res.status(409).json({
        error: "Prior authorization is locked after claim submission"
      });
    }

    if (claim.eligibilityStatus !== "VERIFIED") {
      return res.status(409).json({
        error: "Eligibility must be verified before prior authorization can be evaluated"
      });
    }

    const required =
      typeof req.body.required === "boolean"
        ? req.body.required
        : claim.priorAuthRequired;

    const authorizationNo =
      typeof req.body.authorizationNo === "string"
        ? req.body.authorizationNo.trim() || null
        : claim.authorizationNo;

    let priorAuthStatus = "NEEDS_REVIEW";
    if (required === false) priorAuthStatus = "NOT_REQUIRED";
    if (required === true && authorizationNo) priorAuthStatus = "APPROVED";
    if (required === true && !authorizationNo) priorAuthStatus = "REQUIRED";

    const expiry =
      req.body.expiry != null && req.body.expiry !== ""
        ? new Date(req.body.expiry)
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
        data: { status: "DRAFT" }
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
    const allowed = [
      "ACKNOWLEDGED",
      "IN_REVIEW",
      "APPROVED",
      "PARTIALLY_APPROVED",
      "DENIED",
      "PAID"
    ];
    const payerClaimStatus = String(req.body.payerClaimStatus || "").toUpperCase();

    if (!allowed.includes(payerClaimStatus)) {
      return res.status(400).json({ error: "Invalid payer claim status" });
    }

    const claim = await prisma.claim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    if (
      !claim.claimSubmissionDate &&
      !["SUBMITTED", "DENIED", "PAID"].includes(claim.status)
    ) {
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

    if ((claim.payerClaimStatus || null) === payerClaimStatus) {
      return res.json({
        ...claim,
        unchanged: true,
        message: "Payer claim status is already up to date",
        denialCase: null
      });
    }

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        payerClaimStatus,
        claimStatusCheckedAt: new Date(),
        status:
          payerClaimStatus === "DENIED"
            ? "DENIED"
            : payerClaimStatus === "PAID"
            ? "PAID"
            : claim.status,
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

    // A denial/partial approval automatically opens a denial-workflow case.
    // Re-recording the same payer status does not create duplicate active cases.
    let denialCase = null;
    if (["DENIED", "PARTIALLY_APPROVED"].includes(payerClaimStatus)) {
      denialCase = await prisma.denialCase.findFirst({
        where: {
          claimId: claim.id,
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
        orderBy: { createdAt: "desc" }
      });

      if (!denialCase) {
        const claimed = Number(claim.amount || 0);
        const paid = Number(claim.paidAmount || 0);
        const allowedAmount = Number(claim.allowedAmount || 0);
        const revenueAtRisk =
          paid > 0
            ? Math.max(0, claimed - paid)
            : allowedAmount > 0
            ? Math.max(0, claimed - allowedAmount)
            : claimed;

        denialCase = await prisma.denialCase.create({
          data: {
            claimId: claim.id,
            source: "PAYER_STATUS",
            status: "OPEN",
            denialCategory: null,
            denialDate: new Date(),
            revenueAtRisk
          }
        });

        try {
          await prisma.auditEvent.create({
            data: {
              claimId: claim.id,
              actorUserId: req.user?.id || null,
              action: "DENIAL_CASE_AUTO_CREATED",
              entityType: "DenialCase",
              entityId: denialCase.id,
              outcome: "SUCCESS",
              metadata: {
                payerClaimStatus
              }
            }
          });
        } catch (auditError) {
          console.error("[audit] denial auto-create audit failed", {
            claimId: claim.id,
            message: auditError.message
          });
        }
      }
    }

    logJourneyEvent(claim.id, "payer-status-recorded", payerClaimStatus);
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
    const allowedStatuses = ["AWAITING", "RECEIVED", "POSTED"];
    const remittanceStatus = String(req.body.remittanceStatus || "").toUpperCase();

    if (!allowedStatuses.includes(remittanceStatus)) {
      return res.status(400).json({ error: "Invalid remittance status" });
    }

    const claim = await prisma.claim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    if (
      !claim.claimSubmissionDate &&
      !["SUBMITTED", "DENIED", "PAID"].includes(claim.status)
    ) {
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
      return Math.round(number);
    };

    const allowedAmount = parseOptionalMoney(req.body.allowedAmount, "Allowed amount");
    const requestedPatientResponsibility = parseOptionalMoney(
      req.body.patientResponsibility,
      "Patient responsibility"
    );
    const paidAmount = parseOptionalMoney(req.body.paidAmount, "Paid amount");

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
      paidAmount > allowedAmount
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
        ? Math.max(0, allowedAmount - paidAmount)
        : null;

    const normalizedPaymentReference =
      typeof req.body.paymentReference === "string"
        ? req.body.paymentReference.trim() || null
        : null;

    const remittanceUnchanged =
      claim.remittanceStatus === remittanceStatus &&
      (claim.allowedAmount ?? null) === allowedAmount &&
      (claim.patientResponsibility ?? null) === patientResponsibility &&
      (claim.paidAmount ?? null) === paidAmount &&
      (claim.paymentReference || null) === normalizedPaymentReference;

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
        allowedAmount,
        patientResponsibility,
        paidAmount,
        paymentReference: normalizedPaymentReference,
        approvedAmount: allowedAmount,
        fieldProvenance: mergeProvenance(
          claim.fieldProvenance,
          remittanceProvenance
        ),
        status:
          remittanceStatus === "POSTED" && paidAmount != null && paidAmount > 0
            ? "PAID"
            : claim.payerClaimStatus === "DENIED"
            ? "DENIED"
            : claim.status
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
          OR: [
            { id: { equals: q } },
            { patientName: { contains: q, mode: "insensitive" } },
            { payerName: { contains: q, mode: "insensitive" } },
            { policyNo: { contains: q, mode: "insensitive" } },
            { memberId: { contains: q, mode: "insensitive" } }
          ]
        }
      : {};

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
    const claim = await prisma.claim.findUnique({
      where: { id: req.params.id },
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

router.get("/:id", async (req, res) => {
  const claim = await prisma.claim.findUnique({
    where: { id: req.params.id },
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
      claimType: z.enum(["CASHLESS", "REIMBURSEMENT"]).optional()
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
        fieldProvenance: manualProvenance(
          manuallyEnteredFields,
          "Entered at Claim Creation"
        )
      }
    });

    res.json(claim);
  } catch (e) {
    console.error("[claim-create] failed", { name: e.name, code: e.code || null });
    res.status(500).json({ error: "Unable to create claim", code: "CLAIM_CREATE_FAILED" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const existing = await prisma.claim.findUnique({
      where: { id: req.params.id }
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
      patientName: req.body.patientName,
      payerName: req.body.payerName,
      policyNo: req.body.policyNo || null,
      memberId: req.body.memberId || null,
      patientDob:
        req.body.patientDob
          ? new Date(req.body.patientDob)
          : null,
      hospitalName: req.body.hospitalName || null,
      diagnosisText: req.body.diagnosisText || null,
      claimType: req.body.claimType,
      dateOfService: req.body.dateOfService ? new Date(req.body.dateOfService) : null,
      admissionDate: req.body.admissionDate ? new Date(req.body.admissionDate) : null,
      dischargeDate: req.body.dischargeDate ? new Date(req.body.dischargeDate) : null,
      admissionType: req.body.admissionType || null,
      roomCategory: req.body.roomCategory || null,
      icuDays:
        req.body.icuDays != null && req.body.icuDays !== ""
          ? Number(req.body.icuDays)
          : null,
      procedureText: req.body.procedureText || null,
      procedureDate: req.body.procedureDate ? new Date(req.body.procedureDate) : null,
      icd10Codes: Array.isArray(req.body.icd10Codes)
        ? req.body.icd10Codes
        : [],
      amount: req.body.amount != null && req.body.amount !== ""
        ? Number(req.body.amount)
        : null,
      totalBilledAmount:
        req.body.totalBilledAmount != null &&
        req.body.totalBilledAmount !== ""
          ? Number(req.body.totalBilledAmount)
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
      (!Number.isFinite(payload.amount) || payload.amount <= 0)
    ) {
      return res.status(400).json({
        error: "Claimed amount must be a valid number greater than 0"
      });
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

    await prisma.claim.update({
      where: { id: req.params.id },
      data: {
        ...payload,
        documentDerivedFields,
        fieldProvenance,
        status: "DRAFT"
      }
    });

    if (manuallyChangedFields.length > 0) {
      await markReadinessChecksStale(
        prisma,
        req.params.id,
        "Claim details changed"
      );
    }

    const updated = await prisma.claim.findUnique({
      where: { id: req.params.id },
      include: {
        documents: true,
        checks: { orderBy: { createdAt: "desc" } }
      }
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

    const claim = await prisma.claim.findUnique({ where: { id } });
    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    if (claim.status === "SUBMITTED") {
      return res.status(409).json({
        error: "Submitted claims are locked and cannot be permanently deleted."
      });
    }

    const documents = await prisma.document.findMany({
      where: { claimId: id }
    });

    for (const doc of documents) {
      if (doc.path && fs.existsSync(doc.path)) {
        fs.unlinkSync(doc.path);
      }
    }

    await prisma.document.deleteMany({ where: { claimId: id } });
    await prisma.check.deleteMany({ where: { claimId: id } });
    await prisma.claim.delete({ where: { id } });

    res.json({ success: true });
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
    const claim = await prisma.claim.findUnique({
      where: { id: req.params.id },
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

    await prisma.claim.update({
      where: { id: claim.id },
      data: {
        status: !hasBlock && readinessScore >= 80 ? "READY" : "DRAFT"
      }
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
    res.status(400).json({ error: e.message });
  }
});



router.post("/:id/submit", requireRoles(["ADMIN", "CASHIER"]), async (req, res) => {
  try {
    const claim = await prisma.claim.findUnique({
      where: { id: req.params.id },
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

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        status: "SUBMITTED",
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

    res.json({
      success: true,
      message: "Claim submitted successfully",
      claim: updated
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;