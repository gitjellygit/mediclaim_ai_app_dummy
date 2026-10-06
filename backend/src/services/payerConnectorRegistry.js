export const PAYER_CONNECTOR_IDS = Object.freeze({
  LOCAL: "LOCAL",
  SIMULATED: "SIMULATED",
  LIVE: "LIVE",
  AVAILITY_SANDBOX: "AVAILITY_SANDBOX",
  OPTUM_SANDBOX: "OPTUM_SANDBOX",
  STEDI_TEST: "STEDI_TEST"
});

export const PAYER_CONNECTOR_ENVIRONMENTS = Object.freeze({
  LOCAL: "LOCAL",
  TEST: "TEST",
  SANDBOX: "SANDBOX",
  PRODUCTION: "PRODUCTION"
});

const registry = new Map();

export class UnknownPayerConnectorError extends Error {
  constructor(id) {
    super(`Unknown payer connector: ${id}`);
    this.code = "UNKNOWN_PAYER_CONNECTOR";
    this.connectorId = id;
  }
}

export class PayerConnectorUnavailableError extends Error {
  constructor(id, reason = "Connector is not configured") {
    super(`${id}: ${reason}`);
    this.code = "PAYER_CONNECTOR_UNAVAILABLE";
    this.connectorId = id;
  }
}

export function normalizeConnectorId(value) {
  return String(value || "").trim().toUpperCase();
}

export function registerPayerConnector({
  id,
  mode,
  provider,
  environment,
  capabilities,
  configured,
  factory
}) {
  const normalizedId = normalizeConnectorId(id);
  if (!normalizedId) throw new Error("Payer connector id is required");
  if (typeof factory !== "function") throw new Error(`${normalizedId} connector factory is required`);

  const descriptor = Object.freeze({
    id: normalizedId,
    mode: String(mode || normalizedId).toUpperCase(),
    provider: provider || normalizedId,
    environment: environment || PAYER_CONNECTOR_ENVIRONMENTS.LOCAL,
    capabilities: Object.freeze([...(capabilities || [])]),
    configured: typeof configured === "function" ? configured : () => Boolean(configured ?? true),
    factory
  });

  registry.set(normalizedId, descriptor);
  return descriptor;
}

export function getPayerConnectorDescriptor(id) {
  const normalizedId = normalizeConnectorId(id);
  const descriptor = registry.get(normalizedId);
  if (!descriptor) throw new UnknownPayerConnectorError(normalizedId || id);
  return descriptor;
}

export function listPayerConnectorDescriptors(env = process.env) {
  return [...registry.values()].map((descriptor) => ({
    id: descriptor.id,
    mode: descriptor.mode,
    provider: descriptor.provider,
    environment: descriptor.environment,
    capabilities: descriptor.capabilities,
    configured: Boolean(descriptor.configured(env))
  }));
}

export function createRegisteredPayerConnector(id, context = {}, env = process.env) {
  const descriptor = getPayerConnectorDescriptor(id);
  if (!descriptor.configured(env)) {
    throw new PayerConnectorUnavailableError(
      descriptor.id,
      `${descriptor.provider} ${descriptor.environment.toLowerCase()} connector is not configured`
    );
  }

  const connector = descriptor.factory(context, env);
  return Object.freeze({
    ...connector,
    connectorId: descriptor.id,
    connectorProvider: descriptor.provider,
    connectorEnvironment: descriptor.environment,
    connectorCapabilities: descriptor.capabilities
  });
}

export function clearPayerConnectorRegistryForTests() {
  registry.clear();
}
