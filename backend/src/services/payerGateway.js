import {
  getMockPayer,
  simulateEligibility,
  simulatePriorAuth,
  simulateSubmission,
  simulateStatus,
  simulateRemittance
} from "./payerSimulator.js";
import { createLocalPayerConnector } from "./localPayerConnector.js";
import { assertPayerConnector, PAYER_CONNECTOR_METHODS } from "./payerConnector.js";
import { createLivePayerConnector } from "./livePayerConnector.js";
import {
  createStediProductionConnector,
  createStediTestConnector
} from "./stediTestConnector.js";
import { createAvailitySandboxConnector } from "./availitySandboxConnector.js";
import {
  PAYER_CONNECTOR_ENVIRONMENTS,
  PAYER_CONNECTOR_IDS,
  PayerConnectorUnavailableError,
  createRegisteredPayerConnector,
  getPayerConnectorDescriptor,
  listPayerConnectorDescriptors,
  registerPayerConnector
} from "./payerConnectorRegistry.js";

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

function createUnavailableSandboxConnector(id) {
  const operation = (name) => () => {
    throw new PayerConnectorUnavailableError(
      id,
      `${name} is not wired yet; complete the Release 1 sandbox integration first`
    );
  };

  return {
    mode: "LIVE",
    checkEligibility: operation("checkEligibility"),
    requestPriorAuth: operation("requestPriorAuth"),
    submitClaim: operation("submitClaim"),
    getStatus: operation("getStatus"),
    getRemittance: operation("getRemittance")
  };
}

let defaultsRegistered = false;

export function registerDefaultPayerConnectors() {
  if (defaultsRegistered) return;
  const allCapabilities = [...PAYER_CONNECTOR_METHODS];

  registerPayerConnector({
    id: PAYER_CONNECTOR_IDS.LOCAL,
    mode: "LOCAL",
    provider: "CLAIM_APP",
    environment: PAYER_CONNECTOR_ENVIRONMENTS.LOCAL,
    capabilities: allCapabilities,
    configured: true,
    factory: () => createLocalPayerConnector()
  });

  registerPayerConnector({
    id: PAYER_CONNECTOR_IDS.SIMULATED,
    mode: "SIMULATED",
    provider: "CLAIM_APP",
    environment: PAYER_CONNECTOR_ENVIRONMENTS.TEST,
    capabilities: allCapabilities,
    configured: true,
    factory: ({ payerCode }) => createSimulatedPayerConnector(payerCode)
  });

  registerPayerConnector({
    id: PAYER_CONNECTOR_IDS.LIVE,
    mode: "LIVE",
    provider: "UNCONFIGURED",
    environment: PAYER_CONNECTOR_ENVIRONMENTS.PRODUCTION,
    capabilities: [],
    configured: false,
    factory: () => createLivePayerConnector()
  });

  registerPayerConnector({
    id: PAYER_CONNECTOR_IDS.AVAILITY_SANDBOX,
    mode: "LIVE",
    provider: "AVAILITY",
    environment: PAYER_CONNECTOR_ENVIRONMENTS.SANDBOX,
    capabilities: ["checkEligibility"],
    configured: (env) =>
      Boolean(
        env.AVAILITY_CLIENT_ID &&
        env.AVAILITY_CLIENT_SECRET &&
        env.AVAILITY_TOKEN_URL &&
        env.AVAILITY_ELIGIBILITY_URL
      ),
    factory: (_context, env) => createAvailitySandboxConnector({ env })
  });

  registerPayerConnector({
    id: PAYER_CONNECTOR_IDS.OPTUM_SANDBOX,
    mode: "LIVE",
    provider: "OPTUM",
    environment: PAYER_CONNECTOR_ENVIRONMENTS.SANDBOX,
    capabilities: [],
    configured: false,
    factory: () => createUnavailableSandboxConnector(PAYER_CONNECTOR_IDS.OPTUM_SANDBOX)
  });

  registerPayerConnector({
    id: PAYER_CONNECTOR_IDS.STEDI_TEST,
    mode: "LIVE",
    provider: "STEDI",
    environment: PAYER_CONNECTOR_ENVIRONMENTS.TEST,
    capabilities: ["checkEligibility", "listPayers", "submitClaim", "getRemittance"],
    configured: (env) =>
      env.NODE_ENV !== "production" && Boolean(env.STEDI_TEST_API_KEY),
    factory: (_context, env) => {
      if (env.NODE_ENV === "production") {
        throw new PayerConnectorUnavailableError(
          PAYER_CONNECTOR_IDS.STEDI_TEST,
          "Stedi test connector is disabled in production"
        );
      }
      return createStediTestConnector({ env });
    }
  });

  registerPayerConnector({
    id: PAYER_CONNECTOR_IDS.STEDI_PRODUCTION,
    mode: "LIVE",
    provider: "STEDI",
    environment: PAYER_CONNECTOR_ENVIRONMENTS.PRODUCTION,
    capabilities: [
      "checkEligibility",
      "submitClaim",
      "getStatus",
      "getRemittance"
    ],
    configured: (env) =>
      Boolean(env.STEDI_PRODUCTION_API_KEY) &&
      env.STEDI_PRODUCTION_PHI_CONFIRMED === "true",
    factory: (_context, env) => {
      if (env.STEDI_PRODUCTION_PHI_CONFIRMED !== "true") {
        throw new PayerConnectorUnavailableError(
          PAYER_CONNECTOR_IDS.STEDI_PRODUCTION,
          "Production PHI transmission is not explicitly enabled"
        );
      }
      return createStediProductionConnector({ env });
    }
  });

  defaultsRegistered = true;
}

registerDefaultPayerConnectors();

export function listPayerConnectors(env = process.env) {
  return listPayerConnectorDescriptors(env);
}

export function createPayerConnectorById(id, payerCode, env = process.env) {
  const connector = createRegisteredPayerConnector(id, { payerCode }, env);
  return assertPayerConnector(connector);
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

export function resolvePayerConnectorId(claim, env = process.env) {
  const claimConnector = String(claim?.payerConnectorId || "").trim().toUpperCase();
  const explicit = claimConnector || String(env.PAYER_CONNECTOR_ID || "").trim().toUpperCase();
  const mode = resolvePayerConnectorMode(claim, env);

  if (mode === "LOCAL") return PAYER_CONNECTOR_IDS.LOCAL;
  if (mode === "SIMULATED") return PAYER_CONNECTOR_IDS.SIMULATED;

  if (explicit) {
    const descriptor = getPayerConnectorDescriptor(explicit);
    if (descriptor.mode !== "LIVE") {
      throw new PayerConnectorNotConfiguredError(explicit);
    }
    return descriptor.id;
  }

  return PAYER_CONNECTOR_IDS.LIVE;
}

/**
 * Backward-compatible factory used by current Journey and simulation routes.
 * New external integrations should use createPayerConnectorById so provider
 * identity is explicit and route code stays vendor-neutral.
 */
export function createPayerConnector(mode, payerCode, env = process.env) {
  const normalizedMode = String(mode || "LOCAL").toUpperCase();
  if (!["LOCAL", "SIMULATED", "LIVE"].includes(normalizedMode)) {
    throw new PayerConnectorNotConfiguredError(normalizedMode);
  }
  return createPayerConnectorById(normalizedMode, payerCode, env);
}

export function payerConnectorStatusForClaim(claim, env = process.env) {
  const id = resolvePayerConnectorId(claim, env);
  const descriptor = listPayerConnectorDescriptors(env).find(
    (item) => item.id === id
  );
  if (!descriptor) {
    throw new PayerConnectorNotConfiguredError(id);
  }
  return descriptor;
}

export function createPayerConnectorForClaim(claim, payerCode, env = process.env) {
  return createPayerConnectorById(
    resolvePayerConnectorId(claim, env),
    payerCode || claim?.simulatedPayerCode,
    env
  );
}
