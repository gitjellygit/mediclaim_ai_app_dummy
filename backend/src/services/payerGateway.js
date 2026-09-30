import {
  getMockPayer,
  simulateEligibility,
  simulatePriorAuth,
  simulateSubmission,
  simulateStatus,
  simulateRemittance
} from "./payerSimulator.js";

export class PayerConnectorNotConfiguredError extends Error {
  constructor(mode) {
    super(`Payer connector is not configured for ${mode}`);
    this.code = "PAYER_CONNECTOR_NOT_CONFIGURED";
  }
}

/**
 * Standard payer contract. Each implementation must provide the same five
 * operations and normalize its result into the existing claim-journey shape.
 * These are structured demo objects, NOT actual HIPAA EDI transactions.
 */
export function createPayerConnector(mode, payerCode) {
  if (mode !== "SIMULATED") {
    // LOCAL remains the existing standalone journey flow. LIVE must be
    // explicitly configured and tested; never fall back to synthetic results.
    throw new PayerConnectorNotConfiguredError(mode);
  }
  const payer = getMockPayer(payerCode);
  if (!payer) throw new PayerConnectorNotConfiguredError(payerCode);

  return Object.freeze({
    mode,
    payer,
    checkEligibility(claim, sequence) {
      return simulateEligibility(payer, claim, sequence);
    },
    requestPriorAuth(claim, sequence) {
      return simulatePriorAuth(payer, claim, sequence);
    },
    submitClaim(claim, sequence) {
      return simulateSubmission(payer, claim, sequence);
    },
    getStatus(claim, previousChecks, sequence) {
      return simulateStatus(payer, claim, previousChecks, sequence);
    },
    getRemittance(claim, sequence) {
      return simulateRemittance(payer, claim, sequence);
    }
  });
}
