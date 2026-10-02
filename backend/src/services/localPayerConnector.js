import { differenceMoney, validMoney } from "../utils/money.js";

function nowIso() {
  return new Date().toISOString();
}

export function createLocalPayerConnector() {
  return Object.freeze({
    mode: "LOCAL",

    checkEligibility(claim) {
      const missingFields = [];
      if (!claim.memberId) missingFields.push("memberId");
      if (!claim.policyNo) missingFields.push("policyNo");
      if (!claim.payerName) missingFields.push("payerName");

      let status = "ACTIVE";
      let coverageStatus = "UNKNOWN";

      const now = new Date();
      if (missingFields.length > 0) {
        status = "NEEDS_REVIEW";
      } else if (claim.policyEndDate && new Date(claim.policyEndDate) < now) {
        status = "INACTIVE";
        coverageStatus = "INACTIVE";
      } else if (claim.policyStartDate && new Date(claim.policyStartDate) > now) {
        status = "NOT_YET_ACTIVE";
        coverageStatus = "NOT_YET_ACTIVE";
      }

      return {
        transactionId: `LOCAL-ELIG-${claim.id}-${Date.now()}`,
        status,
        coverageStatus,
        networkStatus: null,
        deductibleRemaining: null,
        coinsurancePct: null,
        missingFields,
        latencyMs: 0,
        livePayerVerification: false,
        checkedAt: nowIso()
      };
    },

    requestPriorAuth(claim, context = {}) {
      const required =
        typeof context.required === "boolean"
          ? context.required
          : claim.priorAuthRequired;

      const authorizationNo =
        typeof context.authorizationNo === "string"
          ? context.authorizationNo.trim() || null
          : claim.authorizationNo || null;

      let status = "NEEDS_REVIEW";
      if (required === false) status = "NOT_REQUIRED";
      if (required === true && authorizationNo) status = "APPROVED";
      if (required === true && !authorizationNo) status = "REQUIRED";

      return {
        transactionId: `LOCAL-AUTH-${claim.id}-${Date.now()}`,
        status,
        required,
        authorizationNo,
        expiry: context.expiry ?? claim.priorAuthExpiry ?? null,
        latencyMs: 0,
        livePayerVerification: false
      };
    },

    submitClaim(claim) {
      return {
        transactionId: `LOCAL-CLM-${claim.id}-${Date.now()}`,
        status: "SUBMITTED",
        payerClaimNo: claim.insurerClaimNo || null,
        latencyMs: 0,
        livePayerVerification: false
      };
    },

    getStatus(claim, context = {}) {
      return {
        transactionId: `LOCAL-STS-${claim.id}-${Date.now()}`,
        status: context.payerClaimStatus || claim.payerClaimStatus || "SUBMITTED",
        latencyMs: 0,
        livePayerVerification: false
      };
    },

    getRemittance(claim, context = {}) {
      const allowedAmount =
        context.allowedAmount == null || context.allowedAmount === ""
          ? null
          : validMoney(context.allowedAmount);
      const paidAmount =
        context.paidAmount == null || context.paidAmount === ""
          ? null
          : validMoney(context.paidAmount);
      const requestedPatientResponsibility =
        context.patientResponsibility == null || context.patientResponsibility === ""
          ? null
          : validMoney(context.patientResponsibility);

      const patientResponsibility =
        requestedPatientResponsibility != null
          ? requestedPatientResponsibility
          : allowedAmount != null && paidAmount != null
          ? Math.max(0, differenceMoney(allowedAmount, paidAmount))
          : null;

      return {
        transactionId: `LOCAL-ERA-${claim.id}-${Date.now()}`,
        status: context.remittanceStatus || claim.remittanceStatus || "AWAITING",
        allowedAmount,
        approvedAmount: allowedAmount,
        paidAmount,
        patientResponsibility,
        paymentReference: context.paymentReference || null,
        latencyMs: 0,
        livePayerVerification: false
      };
    }
  });
}
