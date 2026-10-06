import test from "node:test";
import assert from "node:assert/strict";
import {
  createPayerConnector,
  createPayerConnectorById,
  createPayerConnectorForClaim,
  listPayerConnectors,
  payerConnectorStatusForClaim,
  resolvePayerConnectorId,
  resolvePayerConnectorMode
} from "../src/services/payerGateway.js";
import {
  assertPayerConnector,
  PAYER_CONNECTOR_METHODS
} from "../src/services/payerConnector.js";

const baseClaim = Object.freeze({
  id: "claim-contract-1",
  memberId: "MEM-1001",
  policyNo: "POL-1001",
  payerName: "Blue Horizon Health",
  amount: 1000,
  totalBilledAmount: 1000,
  eligibilityStatus: "VERIFIED",
  priorAuthRequired: false,
  priorAuthStatus: "NOT_REQUIRED",
  authorizationNo: null,
  payerClaimStatus: "APPROVED",
  remittanceStatus: "AWAITING",
  documents: [],
  icd10Codes: ["M54.50"]
});

function verifyContract(connector) {
  assertPayerConnector(connector);
  for (const method of PAYER_CONNECTOR_METHODS) {
    assert.equal(typeof connector[method], "function", method);
  }
}

test("U6 - LOCAL connector implements the shared payer contract", () => {
  const connector = createPayerConnector("LOCAL");
  verifyContract(connector);
  assert.equal(connector.mode, "LOCAL");

  const eligibility = connector.checkEligibility(baseClaim);
  assert.equal(eligibility.status, "ACTIVE");
  assert.equal(eligibility.livePayerVerification, false);

  const priorAuth = connector.requestPriorAuth(baseClaim, { required: false });
  assert.equal(priorAuth.status, "NOT_REQUIRED");

  const submission = connector.submitClaim(baseClaim);
  assert.equal(submission.status, "SUBMITTED");

  const status = connector.getStatus(baseClaim, { payerClaimStatus: "APPROVED" });
  assert.equal(status.status, "APPROVED");

  const remittance = connector.getRemittance(baseClaim, {
    remittanceStatus: "POSTED",
    allowedAmount: 800,
    paidAmount: 700,
    paymentReference: "PAY-1"
  });
  assert.equal(remittance.status, "POSTED");
  assert.equal(remittance.allowedAmount, "800.00");
  assert.equal(remittance.paidAmount, "700.00");
  assert.equal(remittance.patientResponsibility, 100);
});

test("U6 - SIMULATED connector implements the same contract", () => {
  const connector = createPayerConnector("SIMULATED", "BLUE_HORIZON");
  verifyContract(connector);
  assert.equal(connector.mode, "SIMULATED");

  const eligibility = connector.checkEligibility(baseClaim, { sequence: 1 });
  assert.equal(eligibility.status, "ACTIVE");
  assert.ok(eligibility.transactionId);

  const priorAuth = connector.requestPriorAuth(baseClaim, { sequence: 1 });
  assert.ok(["NOT_REQUIRED", "REQUIRED", "APPROVED", "DENIED"].includes(priorAuth.status));

  const submission = connector.submitClaim(baseClaim, { sequence: 1 });
  assert.ok(["ACCEPTED", "PENDED", "REJECTED"].includes(submission.status));

  const status = connector.getStatus(baseClaim, {
    previousChecks: 2,
    sequence: 3
  });
  assert.ok(status.status);

  const remittance = connector.getRemittance(baseClaim, { sequence: 1 });
  assert.equal(remittance.status, "POSTED");
});

test("U6 - LIVE connector satisfies the contract but fails closed on use", () => {
  const connector = createPayerConnector("LIVE");
  verifyContract(connector);
  assert.equal(connector.mode, "LIVE");

  for (const method of PAYER_CONNECTOR_METHODS) {
    assert.throws(
      () => connector[method](baseClaim),
      (error) =>
        error?.code === "LIVE_PAYER_CONNECTOR_NOT_CONFIGURED" &&
        error?.operation === method
    );
  }
});

test("U6 - connector resolution prefers claim mode and supports config fallback", () => {
  assert.equal(
    resolvePayerConnectorMode({ payerConnectionMode: "SIMULATED" }, {
      PAYER_CONNECTOR_MODE: "LOCAL"
    }),
    "SIMULATED"
  );

  assert.equal(
    resolvePayerConnectorMode({}, { PAYER_CONNECTOR_MODE: "LOCAL" }),
    "LOCAL"
  );

  const connector = createPayerConnectorForClaim(
    { payerConnectionMode: "SIMULATED", simulatedPayerCode: "BLUE_HORIZON" },
    null,
    {}
  );
  assert.equal(connector.mode, "SIMULATED");
});

test("U6 - unknown connector modes fail instead of silently falling back", () => {
  assert.throws(
    () => createPayerConnector("MAGIC"),
    (error) => error?.code === "PAYER_CONNECTOR_NOT_CONFIGURED"
  );
});


test("R1 - connector registry exposes provider environment and capabilities", () => {
  const connectors = listPayerConnectors({});
  const byId = new Map(connectors.map((item) => [item.id, item]));

  assert.equal(byId.get("LOCAL")?.provider, "CLAIM_APP");
  assert.equal(byId.get("LOCAL")?.environment, "LOCAL");
  assert.equal(byId.get("LOCAL")?.configured, true);

  assert.equal(byId.get("SIMULATED")?.environment, "TEST");
  assert.equal(byId.get("AVAILITY_SANDBOX")?.provider, "AVAILITY");
  assert.equal(byId.get("AVAILITY_SANDBOX")?.environment, "SANDBOX");
  assert.deepEqual(byId.get("AVAILITY_SANDBOX")?.capabilities, ["checkEligibility"]);
  assert.equal(byId.get("AVAILITY_SANDBOX")?.configured, false);

  assert.equal(byId.get("OPTUM_SANDBOX")?.provider, "OPTUM");
  assert.equal(byId.get("OPTUM_SANDBOX")?.configured, false);
});

test("R1 - sandbox connectors fail closed until credentials are configured", () => {
  assert.throws(
    () => createPayerConnectorById("AVAILITY_SANDBOX", null, {}),
    (error) =>
      error?.code === "PAYER_CONNECTOR_UNAVAILABLE" &&
      error?.connectorId === "AVAILITY_SANDBOX"
  );

  assert.throws(
    () => createPayerConnectorById("OPTUM_SANDBOX", null, {}),
    (error) =>
      error?.code === "PAYER_CONNECTOR_UNAVAILABLE" &&
      error?.connectorId === "OPTUM_SANDBOX"
  );
});

test("R1 - LIVE mode can resolve an explicit provider connector ID", () => {
  const env = {
    PAYER_CONNECTOR_ID: "AVAILITY_SANDBOX",
    AVAILITY_API_BASE_URL: "https://sandbox.example.test",
    AVAILITY_CLIENT_ID: "test-client",
    AVAILITY_CLIENT_SECRET: "test-secret"
  };

  assert.equal(
    resolvePayerConnectorId({ payerConnectionMode: "LIVE" }, env),
    "AVAILITY_SANDBOX"
  );

  const status = payerConnectorStatusForClaim(
    { payerConnectionMode: "LIVE" },
    env
  );
  assert.equal(status.id, "AVAILITY_SANDBOX");
  assert.equal(status.provider, "AVAILITY");
  assert.equal(status.environment, "SANDBOX");
  assert.equal(status.configured, true);
  assert.deepEqual(status.capabilities, ["checkEligibility"]);
});

test("R1 - claim mode continues to override external connector config for local and simulated workflows", () => {
  const env = { PAYER_CONNECTOR_ID: "AVAILITY_SANDBOX" };

  assert.equal(
    resolvePayerConnectorId({ payerConnectionMode: "LOCAL" }, env),
    "LOCAL"
  );
  assert.equal(
    resolvePayerConnectorId({ payerConnectionMode: "SIMULATED" }, env),
    "SIMULATED"
  );
});
