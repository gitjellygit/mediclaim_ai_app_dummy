import {
  getMockPayer,
  simulateEligibility,
  simulatePriorAuth,
  simulateSubmission,
  simulateStatus,
  simulateRemittance
} from "./payerSimulator.js";
import { createLocalPayerConnector } from "./localPayerConnector.js";
import { assertPayerConnector } from "./payerConnector.js";

export class PayerConnectorNotConfiguredError extends Error {
  constructor(mode) {
    super(`Payer connector is not configured for ${mode}`);
    this.code = "PAYER_CONNECTOR_NOT_CONFIGURED";
  }
}

function createSimulatedPayerConnector(payerCode) {
  const payer = getMockPayer(payerCode);
  if (!payer) throw new PayerConnectorNotConfiguredError(payerCode);

  return Object.freeze({
    mode: "SIMULATED",
    payer,
    checkEligibility(claim, context = {}) {
      return simulateEligibility(payer, claim, context.sequence || 1);
    },
    requestPriorAuth(claim, context = {}) {
      return simulatePriorAuth(payer, claim, context.sequence || 1);
    },
    submitClaim(claim, context = {}) {
      return simulateSubmission(payer, claim, context.sequence || 1);
    },
    getStatus(claim, context = {}) {
      return simulateStatus(
        payer,
        claim,
        context.previousChecks || 0,
        context.sequence || 1
      );
    },
    getRemittance(claim, context = {}) {
      return simulateRemittance(payer, claim, context.sequence || 1);
    }
  });
}

export function resolvePayerConnectorMode(claim, env = process.env) {
  const requested = String(
    claim?.payerConnectionMode || env.PAYER_CONNECTOR_MODE || "LOCAL"
  ).toUpperCase();

  if (!["LOCAL", "SIMULATED", "LIVE"].includes(requested)) {
    throw new PayerConnectorNotConfiguredError(requested);
  }

  return requested;
}

/**
 * Standard payer contract used by all journey integrations.
 *
 * LOCAL:
 *   deterministic/manual workflow used during local development.
 * SIMULATED:
 *   synthetic payer responses used by demo and automated tests.
 * LIVE:
 *   reserved for a future clearinghouse/payer implementation and deliberately
 *   fails closed until explicitly configured.
 */
export function createPayerConnector(mode, payerCode) {
  const normalizedMode = String(mode || "LOCAL").toUpperCase();

  let connector;
  if (normalizedMode === "LOCAL") {
    connector = createLocalPayerConnector();
  } else if (normalizedMode === "SIMULATED") {
    connector = createSimulatedPayerConnector(payerCode);
  } else {
    throw new PayerConnectorNotConfiguredError(normalizedMode);
  }

  return assertPayerConnector(connector);
}
