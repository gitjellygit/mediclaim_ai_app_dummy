import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAvailityEligibilityRequest,
  createAvailitySandboxConnector,
  normalizeAvailityEligibilityResponse
} from "../src/services/availitySandboxConnector.js";

const claim = Object.freeze({
  id: "claim-availity-1",
  patientName: "Emma Reynolds",
  subscriberName: "Emma Reynolds",
  patientDob: new Date("1982-03-14T00:00:00.000Z"),
  memberId: "MEM-AVA-1001",
  payerEdiId: "60054",
  billingProviderNpi: "1234567890",
  hospitalName: "Claim App Demo Clinic"
});

test("R2C - builds claim-centric Availity 270/271 demo request", () => {
  const payload = buildAvailityEligibilityRequest(claim);
  assert.equal(payload.transactionType, "270_271");
  assert.equal(payload.payerId, "60054");
  assert.equal(payload.subscriber.memberId, "MEM-AVA-1001");
  assert.equal(payload.subscriber.firstName, "Emma");
  assert.equal(payload.subscriber.lastName, "Reynolds");
  assert.equal(payload.subscriber.dateOfBirth, "1982-03-14");
  assert.equal(payload.provider.npi, "1234567890");
  assert.equal(payload.serviceTypeCode, "30");
});

test("R2C - normalizes Availity sandbox eligibility into shared connector shape", () => {
  const normalized = normalizeAvailityEligibilityResponse(
    {
      transactionId: "ava-tx-100",
      data: {
        coverage: {
          status: "ACTIVE",
          networkStatus: "IN_NETWORK",
          deductibleRemaining: "425.50",
          coinsurancePct: "20",
          planName: "Demo PPO",
          planType: "PPO"
        }
      }
    },
    { latencyMs: 31 }
  );

  assert.equal(normalized.transactionId, "ava-tx-100");
  assert.equal(normalized.status, "ACTIVE");
  assert.equal(normalized.coverageStatus, "ACTIVE");
  assert.equal(normalized.networkStatus, "IN_NETWORK");
  assert.equal(normalized.deductibleRemaining, 425.5);
  assert.equal(normalized.coinsurancePct, 20);
  assert.equal(normalized.testMode, true);
  assert.equal(normalized.livePayerVerification, false);
  assert.equal(normalized.latencyMs, 31);
});

test("R2C - Availity sandbox connector obtains OAuth token then submits eligibility", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url) === "https://sandbox.example.test/oauth/token") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ access_token: "sandbox-token", expires_in: 300 });
        }
      };
    }

    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          transactionId: "ava-e2e-101",
          coverageStatus: "ACTIVE"
        });
      }
    };
  };

  const connector = createAvailitySandboxConnector({
    env: {
      AVAILITY_CLIENT_ID: "demo-client",
      AVAILITY_CLIENT_SECRET: "demo-secret",
      AVAILITY_TOKEN_URL: "https://sandbox.example.test/oauth/token",
      AVAILITY_ELIGIBILITY_URL: "https://sandbox.example.test/eligibility"
    },
    fetchImpl
  });

  const result = await connector.checkEligibility(claim);
  assert.equal(result.status, "ACTIVE");
  assert.equal(result.transactionId, "ava-e2e-101");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.match(calls[0].options.body, /grant_type=client_credentials/);
  assert.equal(calls[1].url, "https://sandbox.example.test/eligibility");
  assert.equal(calls[1].options.headers.Authorization, "Bearer sandbox-token");
  assert.equal(JSON.parse(calls[1].options.body).payerId, "60054");
});

test("R2C - Availity OAuth token is reused while valid", async () => {
  let tokenCalls = 0;
  let eligibilityCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("/oauth/token")) {
      tokenCalls += 1;
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ access_token: "cached-token", expires_in: 300 });
        }
      };
    }
    eligibilityCalls += 1;
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ transactionId: `ava-${eligibilityCalls}`, status: "ACTIVE" });
      }
    };
  };

  const connector = createAvailitySandboxConnector({
    env: {
      AVAILITY_CLIENT_ID: "demo-client",
      AVAILITY_CLIENT_SECRET: "demo-secret",
      AVAILITY_TOKEN_URL: "https://sandbox.example.test/oauth/token",
      AVAILITY_ELIGIBILITY_URL: "https://sandbox.example.test/eligibility"
    },
    fetchImpl
  });

  await connector.checkEligibility(claim);
  await connector.checkEligibility(claim);
  assert.equal(tokenCalls, 1);
  assert.equal(eligibilityCalls, 2);
});

test("R2C - Availity connector fails closed when sandbox config is incomplete", () => {
  assert.throws(
    () => createAvailitySandboxConnector({ env: {} }),
    (error) =>
      error?.code === "PAYER_CONNECTOR_UNAVAILABLE" &&
      error?.connectorId === "AVAILITY_SANDBOX"
  );
});
