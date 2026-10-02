export class LivePayerConnectorNotConfiguredError extends Error {
  constructor(operation) {
    super(`LIVE payer connector is not configured for ${operation}`);
    this.code = "LIVE_PAYER_CONNECTOR_NOT_CONFIGURED";
    this.operation = operation;
  }
}

function unavailable(operation) {
  throw new LivePayerConnectorNotConfiguredError(operation);
}

export function createLivePayerConnector() {
  return Object.freeze({
    mode: "LIVE",
    checkEligibility() {
      return unavailable("checkEligibility");
    },
    requestPriorAuth() {
      return unavailable("requestPriorAuth");
    },
    submitClaim() {
      return unavailable("submitClaim");
    },
    getStatus() {
      return unavailable("getStatus");
    },
    getRemittance() {
      return unavailable("getRemittance");
    }
  });
}
