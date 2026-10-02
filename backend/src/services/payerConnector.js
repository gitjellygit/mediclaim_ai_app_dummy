export const PAYER_CONNECTOR_METHODS = Object.freeze([
  "checkEligibility",
  "requestPriorAuth",
  "submitClaim",
  "getStatus",
  "getRemittance"
]);

export class InvalidPayerConnectorError extends Error {
  constructor(message) {
    super(message);
    this.code = "INVALID_PAYER_CONNECTOR";
  }
}

export function assertPayerConnector(connector) {
  if (!connector || typeof connector !== "object") {
    throw new InvalidPayerConnectorError("Payer connector must be an object");
  }

  for (const method of PAYER_CONNECTOR_METHODS) {
    if (typeof connector[method] !== "function") {
      throw new InvalidPayerConnectorError(
        `Payer connector is missing required method: ${method}`
      );
    }
  }

  return connector;
}
