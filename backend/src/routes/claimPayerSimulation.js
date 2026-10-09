import express from "express";
import { auditOnResponse } from "../services/auditLog.js";
import { emptyMutationSchema, parseMutation, payerConnectSchema, payerPriorAuthSchema } from "../validation/claimMutations.js";
import { prisma } from "../db.js";
import { differenceMoney } from "../utils/money.js";
import {
  mergeProvenance,
  removeProvenanceFields,
  systemProvenance
} from "../services/claimFieldProvenance.js";
import { markReadinessChecksStale } from "../services/readinessHistory.js";
import { createPayerConnectorForClaim } from "../services/payerGateway.js";
import { assertClaimTransition } from "../services/workflowStateMachine.js";
import { findActiveDenialCase } from "../services/denialCaseLifecycle.js";
import { isClaimLocked, isClaimSubmittedOrLater } from "../services/claimLock.js";
import {
  getMockPayer,
  listMockPayers,
  payerInputFingerprint
} from "../services/payerSimulator.js";

const router = express.Router();

router.use((req, res, next) => {
  const match = /^\/([^/]+)\/payer-simulation\/(connect|eligibility|prior-auth|submission|status|remittance)$/.exec(req.path);
  if (match) {
    const [, claimId, operation] = match;
    const actions = {
      connect: "PAYER_CONNECTED",
      eligibility: "PAYER_ELIGIBILITY_CHECKED",
      "prior-auth": "PAYER_PRIOR_AUTH_CHECKED",
      submission: "PAYER_CLAIM_SUBMITTED",
      status: "PAYER_STATUS_CHECKED",
      remittance: "PAYER_REMITTANCE_CHECKED"
    };
    auditOnResponse(prisma, req, res, (statusCode) => ({
      claimId,
      action: actions[operation],
      entityType: "Claim",
      entityId: claimId,
      outcome: statusCode < 400 ? "SUCCESS" : "DENIED",
      metadata: { operation }
    }));
  }
  next();
});

function orgId(req) {
  return req.user.organizationId;
}

router.get("/payers/mock", (_req, res) => {
  res.json({
    mode: "SIMULATED",
    payers: listMockPayers()
  });
});

async function createPayerTransaction(
  claimId,
  payerCode,
  transactionType,
  result,
  requestPayload = {},
  db = prisma
) {
  return db.payerTransaction.create({
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

async function getSimulationClaim(id, organizationId) {
  return prisma.claim.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: {
      documents: { orderBy: { createdAt: "desc" } },
      payerTransactions: { orderBy: { createdAt: "desc" } }
    }
  });
}

router.post("/:id/payer-simulation/connect", async (req, res) => {
  try {
    const parsedInput = parseMutation(payerConnectSchema, req.body);
    if (!parsedInput.ok) return res.status(400).json(parsedInput.response);
    const { payerCode } = parsedInput.data;
    const payer = getMockPayer(payerCode);
    if (!payer) return res.status(400).json({ error: "Unknown mock payer" });

    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null } });
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    if (isClaimLocked(claim)) {
      return res.status(409).json({
        error: "Payer profile cannot be changed after claim submission"
      });
    }

    if (
      claim.payerConnectionMode === "SIMULATED" &&
      claim.simulatedPayerCode === payer.code &&
      claim.connectedPayerCode === payer.code &&
      claim.connectedPayerName === payer.name
    ) {
      return res.json({ unchanged: true, payer, claim });
    }

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        payerConnectionMode: "SIMULATED",
        simulatedPayerCode: payer.code,
        connectedPayerCode: payer.code,
        connectedPayerName: payer.name,
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
        fieldProvenance: removeProvenanceFields(claim.fieldProvenance, [
          "eligibilityStatus",
          "coverageStatus",
          "networkStatus",
          "deductibleRemaining",
          "coinsurancePct",
          "priorAuthRequired",
          "priorAuthStatus",
          "authorizationNo",
          "priorAuthExpiry"
        ])
      }
    });

    await markReadinessChecksStale(prisma, claim.id, "Payer profile changed");
    if (claim.status === "READY") {
      await prisma.claim.update({ where: { id: claim.id }, data: { status: assertClaimTransition(claim.status, "DRAFT") } });
    }

    res.json({
      message: `Connected to ${payer.name} simulator`,
      payer,
      claim: updated
    });
  } catch (error) {
    if (error?.status) throw error;
    console.error("[payer-simulation] connect failed", {
      claimId: req.params.id,
      name: error?.name || "Error"
    });
    res.status(500).json({ error: "Unable to connect mock payer" });
  }
});

router.post("/:id/payer-simulation/eligibility", async (req, res) => {
  try {
    const parsedInput = parseMutation(emptyMutationSchema, req.body);
    if (!parsedInput.ok) return res.status(400).json(parsedInput.response);
    const claim = await getSimulationClaim(req.params.id, orgId(req));
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    const payer = getMockPayer(claim.simulatedPayerCode);
    if (claim.payerConnectionMode !== "SIMULATED" || !payer) {
      return res.status(409).json({ error: "Connect a mock payer first" });
    }
    if (isClaimLocked(claim)) {
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

    const result = createPayerConnectorForClaim(claim, payer.code).checkEligibility(claim, { sequence: priorCount + 1 });
    await new Promise((resolve) => setTimeout(resolve, Math.min(result.latencyMs, 900)));

    const verified = result.status === "ACTIVE";
    const { updated, transaction } = await prisma.$transaction(async (tx) => {
      const updatedClaim = await tx.claim.update({
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

      const payerTransaction = await createPayerTransaction(
        claim.id,
        payer.code,
        "ELIGIBILITY",
        result,
        {
          transaction: "270",
          payerCode: payer.code,
          payerName: payer.name,
          memberId: claim.memberId || null,
          policyNo: claim.policyNo || null,
          memberIdPresent: Boolean(claim.memberId),
          policyNoPresent: Boolean(claim.policyNo),
          inputFingerprint
        },
        tx
      );

      await markReadinessChecksStale(
        tx,
        claim.id,
        "Eligibility information changed"
      );

      return { updated: updatedClaim, transaction: payerTransaction };
    });

    res.json({ result, transaction, claim: updated, livePayerVerification: false });
  } catch (error) {
    if (error?.status) throw error;
    console.error("[payer-simulation] eligibility failed", {
      claimId: req.params.id,
      name: error?.name || "Error"
    });
    res.status(500).json({ error: "Mock eligibility request failed" });
  }
});

router.post("/:id/payer-simulation/prior-auth", async (req, res) => {
  try {
    const parsedInput = parseMutation(payerPriorAuthSchema, req.body);
    if (!parsedInput.ok) return res.status(400).json(parsedInput.response);
    const input = parsedInput.data;
    const claim = await getSimulationClaim(req.params.id, orgId(req));
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    const payer = getMockPayer(claim.simulatedPayerCode);
    if (claim.payerConnectionMode !== "SIMULATED" || !payer) {
      return res.status(409).json({ error: "Connect a mock payer first" });
    }
    if (claim.eligibilityStatus !== "VERIFIED") {
      return res.status(409).json({ error: "Verify eligibility with the payer first" });
    }
    if (isClaimLocked(claim)) {
      return res.status(409).json({ error: "Prior authorization is locked after claim submission" });
    }

    const requestedAuthorizationNo =
      typeof input.authorizationNo === "string"
        ? input.authorizationNo.trim() || null
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

    const result = createPayerConnectorForClaim(claim, payer.code).requestPriorAuth(claimForAuth, { sequence: priorCount + 1 });
    await new Promise((resolve) => setTimeout(resolve, Math.min(result.latencyMs, 900)));

    const { updated, transaction } = await prisma.$transaction(async (tx) => {
      const updatedClaim = await tx.claim.update({
        where: { id: claim.id },
        data: {
          priorAuthRequired: result.required,
          priorAuthStatus: result.status,
          authorizationNo: result.authorizationNo ?? requestedAuthorizationNo,
          priorAuthExpiry: result.expiry ? new Date(result.expiry) : claim.priorAuthExpiry,
          priorAuthCheckedAt: new Date(),
          fieldProvenance: mergeProvenance(
            claim.fieldProvenance,
            systemProvenance(
              ["priorAuthRequired", "priorAuthStatus", "authorizationNo", "priorAuthExpiry"],
              {
                source: "SIMULATED_PAYER",
                label: "Mock Prior Auth Response",
                sourceDetail: payer.name,
                verified: false
              }
            )
          )
        }
      });

      const payerTransaction = await createPayerTransaction(
        claim.id,
        payer.code,
        "PRIOR_AUTH",
        result,
        {
          transaction: "278-style",
          procedurePresent: Boolean(claim.procedureText),
          inputFingerprint
        },
        tx
      );

      await markReadinessChecksStale(
        tx,
        claim.id,
        "Prior authorization information changed"
      );

      return { updated: updatedClaim, transaction: payerTransaction };
    });

    res.json({ result, transaction, claim: updated });
  } catch (error) {
    if (error?.status) throw error;
    console.error("[payer-simulation] prior auth failed", {
      claimId: req.params.id,
      name: error?.name || "Error"
    });
    res.status(500).json({ error: "Mock prior authorization request failed" });
  }
});

router.post("/:id/payer-simulation/submission", async (req, res) => {
  try {
    const parsedInput = parseMutation(emptyMutationSchema, req.body);
    if (!parsedInput.ok) return res.status(400).json(parsedInput.response);
    const claim = await getSimulationClaim(req.params.id, orgId(req));
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    const payer = getMockPayer(claim.simulatedPayerCode);
    if (claim.payerConnectionMode !== "SIMULATED" || !payer) {
      return res.status(409).json({ error: "Connect a mock payer first" });
    }
    if (!isClaimSubmittedOrLater(claim)) {
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

    const result = createPayerConnectorForClaim(claim, payer.code).submitClaim(claim, { sequence: priorCount + 1 });
    await new Promise((resolve) => setTimeout(resolve, Math.min(result.latencyMs, 900)));

    const payerClaimStatus =
      result.status === "ACCEPTED" ? "ACKNOWLEDGED" :
      result.status === "PENDED" ? "PENDED" : "REJECTED";

    const requestAmount =
      claim.amount != null
        ? String(claim.amount)
        : claim.totalBilledAmount != null
        ? String(claim.totalBilledAmount)
        : null;

    const { updated, transaction } = await prisma.$transaction(async (tx) => {
      const updatedClaim = await tx.claim.update({
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

      const payerTransaction = await createPayerTransaction(
        claim.id,
        payer.code,
        "CLAIM_SUBMISSION",
        result,
        {
          transaction: "837-style",
          amount: requestAmount,
          inputFingerprint
        },
        tx
      );

      return {
        updated: updatedClaim,
        transaction: payerTransaction
      };
    });

    res.json({ result, transaction, claim: updated });
  } catch (error) {
    if (error?.status) throw error;
    console.error("[payer-simulation] submission failed", {
      claimId: req.params.id,
      name: error?.name || "Error"
    });
    res.status(500).json({ error: "Mock claim submission failed" });
  }
});

router.post("/:id/payer-simulation/status", async (req, res) => {
  try {
    const parsedInput = parseMutation(emptyMutationSchema, req.body);
    if (!parsedInput.ok) return res.status(400).json(parsedInput.response);
    const claim = await getSimulationClaim(req.params.id, orgId(req));
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

    const result = createPayerConnectorForClaim(claim, payer.code).getStatus(claim, { previousChecks: statusTransactions.length, sequence: statusTransactions.length + 1 });

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

    const { updated, denialCase, transaction } = await prisma.$transaction(async (tx) => {
      const updatedClaim = await tx.claim.update({
        where: { id: claim.id },
        data: {
          payerClaimStatus: result.status,
          claimStatusCheckedAt: new Date(),
          status: assertClaimTransition(claim.status, overallStatus),
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

      let activeDenialCase = null;
      if (["DENIED", "PARTIALLY_APPROVED"].includes(result.status)) {
        activeDenialCase = await findActiveDenialCase(tx, claim.id);
        if (!activeDenialCase) {
          activeDenialCase = await tx.denialCase.create({
            data: {
              claimId: claim.id,
              source: "SIMULATED_PAYER_STATUS",
              status: "OPEN",
              denialCategory: result.status === "DENIED" ? "AUTHORIZATION" : "PAYMENT",
              reasonText: result.reason,
              denialDate: new Date(),
              revenueAtRisk: Math.max(
                0,
                differenceMoney(claim.amount || 0, claim.paidAmount || 0)
              ),
              recommendedAction:
                "Review the simulated payer response and supporting claim data."
            }
          });
        }
      }

      const payerTransaction = await createPayerTransaction(
        claim.id,
        payer.code,
        "CLAIM_STATUS",
        result,
        { transaction: "276", payerClaimNo: claim.insurerClaimNo || null },
        tx
      );

      return {
        updated: updatedClaim,
        denialCase: activeDenialCase,
        transaction: payerTransaction
      };
    });

    res.json({ result, transaction, claim: updated, denialCase });
  } catch (error) {
    if (error?.status) throw error;
    console.error("[payer-simulation] status failed", {
      claimId: req.params.id,
      name: error?.name || "Error"
    });
    res.status(500).json({ error: "Mock payer status request failed" });
  }
});

router.post("/:id/payer-simulation/remittance", async (req, res) => {
  try {
    const parsedInput = parseMutation(emptyMutationSchema, req.body);
    if (!parsedInput.ok) return res.status(400).json(parsedInput.response);
    const claim = await getSimulationClaim(req.params.id, orgId(req));
    if (!claim) return res.status(404).json({ error: "Claim not found" });
    const payer = getMockPayer(claim.simulatedPayerCode);
    if (claim.payerConnectionMode !== "SIMULATED" || !payer) {
      return res.status(409).json({ error: "Connect a mock payer first" });
    }
    if (!["APPROVED", "PARTIALLY_APPROVED", "PAID"].includes(claim.payerClaimStatus || "")) {
      return res.json({
        unchanged: true,
        available: false,
        message: "No remittance is available yet. Refresh again after payer adjudication.",
        claim
      });
    }
    if (claim.remittanceStatus === "POSTED") {
      return res.json({
        unchanged: true,
        message: "Simulated remittance is already posted",
        claim
      });
    }

    const priorCount = claim.payerTransactions.filter((x) => x.transactionType === "REMITTANCE").length;
    const result = createPayerConnectorForClaim(claim, payer.code).getRemittance(claim, { sequence: priorCount + 1 });
    await new Promise((resolve) => setTimeout(resolve, Math.min(result.latencyMs, 900)));

    const { updated, transaction, underpaymentCase } = await prisma.$transaction(async (tx) => {
      const updatedClaim = await tx.claim.update({
        where: { id: claim.id },
        data: {
          remittanceStatus: "POSTED",
          remittanceReceivedAt: new Date(),
          allowedAmount: result.allowedAmount,
          approvedAmount: result.approvedAmount,
          paidAmount: result.paidAmount,
          patientResponsibility: result.patientResponsibility,
          paymentReference: result.paymentReference,
          status: assertClaimTransition(
            claim.status,
            result.paidAmount > 0 ? "PAID" : claim.status
          ),
          payerClaimStatus:
            result.paidAmount > 0 ? "PAID" : claim.payerClaimStatus,
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

      const payerTransaction = await createPayerTransaction(
        claim.id,
        payer.code,
        "REMITTANCE",
        result,
        { transaction: "835-style", payerClaimNo: claim.insurerClaimNo || null },
        tx
      );

      let varianceCase = null;
      if (Number(result.potentialUnderpayment || 0) > 0) {
        varianceCase = await tx.underpaymentCase.upsert({
          where: { claimId: claim.id },
          create: {
            claimId: claim.id,
            expectedPayerPayment: result.expectedPayerPayment,
            actualPaidAmount: result.paidAmount,
            varianceAmount: result.potentialUnderpayment,
            sourceTransactionId: payerTransaction.transactionId
          },
          update: {
            expectedPayerPayment: result.expectedPayerPayment,
            actualPaidAmount: result.paidAmount,
            varianceAmount: result.potentialUnderpayment,
            sourceTransactionId: payerTransaction.transactionId
          }
        });
      }

      return {
        updated: updatedClaim,
        transaction: payerTransaction,
        underpaymentCase: varianceCase
      };
    });

    res.json({ result, transaction, claim: updated, underpaymentCase });
  } catch (error) {
    if (error?.status) throw error;
    console.error("[payer-simulation] remittance failed", {
      claimId: req.params.id,
      name: error?.name || "Error"
    });
    res.status(500).json({ error: "Mock remittance request failed" });
  }
});

export default router;
