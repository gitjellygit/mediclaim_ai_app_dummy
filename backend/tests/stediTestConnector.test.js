import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStediClaimSubmissionRequest,
  buildStediEligibilityRequest,
  createStediTestConnector,
  listStediPayers,
  normalizeStediClaimSubmissionResponse,
  normalizeStediEligibilityResponse,
  searchStediPayers
} from "../src/services/stediTestConnector.js";

const claim = {
  id: "claim-stedi-1",
  patientName: "Jane Doe",
  subscriberName: "Jane Doe",
  patientDob: new Date("1975-05-05T00:00:00.000Z"),
  memberId: "MEMBER123",
  payerEdiId: "61101",
  billingProviderNpi: "1999999984",
  hospitalName: "CLAIM APP Test Provider"
};

test("R2A - builds Stedi 270/271 JSON request from normalized claim fields", () => {
  const payload = buildStediEligibilityRequest(claim);
  assert.equal(payload.payerId, "61101");
  assert.equal(payload.subscriber.memberId, "MEMBER123");
  assert.equal(payload.subscriber.dateOfBirth, "1975-05-05");
  assert.equal(payload.subscriber.name.person.firstName, "Jane");
  assert.equal(payload.subscriber.name.person.lastName, "Doe");
  assert.equal(payload.provider.npi, "1999999984");
  assert.equal(payload.encounter.services[0].value, "30");
});

test("R2A - explicit test payload override supports Stedi documented mock fixtures", () => {
  const mockPayload = {
    payerId: "87726",
    subscriber: { memberId: "DOCUMENTED-MOCK" },
    provider: { name: { organization: "Test" }, npi: "1999999984" },
    encounter: { services: [{ system: "STC", value: "30" }] }
  };
  assert.equal(
    buildStediEligibilityRequest({}, { requestPayload: mockPayload }),
    mockPayload
  );
});

test("R2A - normalizes current Stedi plans response into CLAIM APP eligibility", () => {
  const normalized = normalizeStediEligibilityResponse({
    id: "ec_test_123",
    result: "ACTIVE",
    plans: [
      {
        benefits: {
          statuses: [
            {
              status: "ACTIVE_COVERAGE",
              network: { indicator: "IN_NETWORK" },
              service: { system: "STC", value: "30" }
            }
          ],
          deductible: [
            {
              amount: "750",
              service: { system: "STC", value: "30" }
            }
          ],
          coInsurance: [
            {
              percent: "0.2",
              service: { system: "STC", value: "30" }
            }
          ]
        }
      }
    ]
  }, { latencyMs: 42 });

  assert.equal(normalized.transactionId, "ec_test_123");
  assert.equal(normalized.status, "ACTIVE");
  assert.equal(normalized.coverageStatus, "ACTIVE");
  assert.equal(normalized.networkStatus, null);
  assert.equal(normalized.deductibleRemaining, null);
  assert.equal(normalized.coinsurancePct, null);
  assert.equal(normalized.benefitSummary.deductibleAmount, 750);
  assert.equal(normalized.benefitSummary.coinsuranceBenefitPct, 20);
  assert.equal(normalized.latencyMs, 42);
  assert.equal(normalized.testMode, true);
});

test("R2A - Stedi test connector sends authorization header and JSON request", async () => {
  let captured = null;
  const fetchImpl = async (url, options) => {
    captured = { url: String(url), options };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      async text() {
        return JSON.stringify({
          id: "ec_test_live",
          result: "ACTIVE",
          plans: [
            {
              benefits: {
                statuses: [{ status: "ACTIVE_COVERAGE" }]
              }
            }
          ]
        });
      }
    };
  };

  const connector = createStediTestConnector({
    env: {
      STEDI_TEST_API_KEY: "test-key",
      STEDI_API_BASE_URL: "https://example.test/2026-06-01"
    },
    fetchImpl
  });

  const result = await connector.checkEligibility(claim);
  assert.equal(result.status, "ACTIVE");
  assert.equal(result.transactionId, "ec_test_live");
  assert.equal(captured.url, "https://example.test/2026-06-01/eligibility-check");
  assert.equal(captured.options.headers.Authorization, "test-key");
  assert.equal(captured.options.headers["Content-Type"], "application/json");
  const body = JSON.parse(captured.options.body);
  assert.equal(body.payerId, "61101");
  assert.equal(body.subscriber.memberId, "MEMBER123");
});

test("R2A - Stedi connector fails closed without a test API key", () => {
  assert.throws(
    () => createStediTestConnector({ env: {} }),
    (error) =>
      error?.code === "PAYER_CONNECTOR_UNAVAILABLE" &&
      error?.connectorId === "STEDI_TEST"
  );
});

test("R2A - Stedi payer list uses authenticated payer-network API", async () => {
  let captured = null;
  const fetchImpl = async (url, options) => {
    captured = { url: String(url), options };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      async text() {
        return JSON.stringify({
          items: [
            {
              stediId: "ABCDE",
              primaryPayerId: "12345",
              displayName: "Example Payer",
              transactionSupport: { eligibilityCheck: "SUPPORTED" }
            }
          ]
        });
      }
    };
  };

  const result = await listStediPayers({
    env: {
      STEDI_TEST_API_KEY: "test-key",
      STEDI_PAYER_API_BASE_URL: "https://example.test/2024-04-01"
    },
    fetchImpl,
    pageSize: 25
  });

  assert.equal(result.items.length, 1);
  assert.match(captured.url, /\/payers\?pageSize=25$/);
  assert.equal(captured.options.headers.Authorization, "test-key");
});


test("R2A - Stedi payer search filters for eligibility support", async () => {
  let captured = null;
  const fetchImpl = async (url, options) => {
    captured = { url: String(url), options };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      async text() {
        return JSON.stringify({ items: [] });
      }
    };
  };

  await searchStediPayers({
    query: "Blue Cross",
    env: {
      STEDI_TEST_API_KEY: "test-key",
      STEDI_PAYER_API_BASE_URL: "https://example.test/2024-04-01"
    },
    fetchImpl,
    pageSize: 20
  });

  assert.match(captured.url, /\/payers\/search\?/);
  assert.match(captured.url, /query=Blue(?:\+|%20)Cross/);
  assert.match(captured.url, /eligibilityCheck=SUPPORTED/);
  assert.equal(captured.options.headers.Authorization, "test-key");
});

test("R2A - Claim Journey source uses the per-claim external connector for eligibility", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(
    path.resolve(here, "../src/routes/claimJourney.js"),
    "utf8"
  );

  assert.match(source, /createPayerConnectorForClaim/);
  assert.match(source, /payerConnectorId: connectorId/);
  assert.match(source, /transactionType: "ELIGIBILITY"/);
  assert.match(source, /connector\.connectorEnvironment === "TEST"/);
});


test("R2B - Stedi claim submission requires explicit validated request payload", () => {
  assert.throws(
    () => buildStediClaimSubmissionRequest({ claimForm: "PROFESSIONAL" }),
    (error) => error?.code === "STEDI_CLAIM_REQUEST_INVALID"
  );
});

test("R2B - Stedi claim payload override is forced into test mode", () => {
  const result = buildStediClaimSubmissionRequest(
    { claimForm: "PROFESSIONAL" },
    {
      requestPayload: {
        usageIndicator: "P",
        tradingPartnerServiceId: "60054"
      }
    }
  );
  assert.equal(result.claimType, "PROFESSIONAL");
  assert.equal(result.payload.usageIndicator, "T");
  assert.equal(result.payload.tradingPartnerServiceId, "60054");
});

test("R2B - normalizes synchronous Stedi 277CA claim response", () => {
  const result = normalizeStediClaimSubmissionResponse(
    {
      claimReference: {
        correlationId: "corr-100",
        claimType: "PROF",
        patientControlNumber: "PCN100",
        payerId: "60054"
      },
      x12: "STC*A1:19*20261006~"
    },
    {
      claimType: "PROFESSIONAL",
      latencyMs: 25,
      idempotencyKey: "idem-100"
    }
  );
  assert.equal(result.transactionId, "corr-100");
  assert.equal(result.status, "ACKNOWLEDGED");
  assert.equal(result.acknowledgmentType, "277CA");
  assert.equal(result.has277CA, true);
  assert.equal(result.patientControlNumber, "PCN100");
  assert.equal(result.payerId, "60054");
  assert.equal(result.testMode, true);
  assert.equal(result.livePayerSubmission, false);
});

test("R2B - Stedi connector submits professional 837P test claim with idempotency", async () => {
  let captured = null;
  const fetchImpl = async (url, options) => {
    captured = { url: String(url), options };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      async text() {
        return JSON.stringify({
          claimReference: {
            correlationId: "corr-prof-1",
            claimType: "PROF",
            patientControlNumber: "PCN-PROF-1",
            payerId: "60054"
          },
          x12: "STC*A1:19*20261006~"
        });
      }
    };
  };

  const connector = createStediTestConnector({
    env: {
      STEDI_TEST_API_KEY: "test-key",
      STEDI_CLAIMS_API_BASE_URL: "https://claims.example.test/2024-04-01"
    },
    fetchImpl
  });

  const result = await connector.submitClaim(
    { id: "claim-prof-1", claimForm: "PROFESSIONAL" },
    {
      idempotencyKey: "idem-prof-1",
      requestPayload: {
        tradingPartnerServiceId: "60054",
        claimInformation: { patientControlNumber: "PCN-PROF-1" }
      }
    }
  );

  assert.equal(
    captured.url,
    "https://claims.example.test/2024-04-01/change/medicalnetwork/professionalclaims/v3/submission"
  );
  assert.equal(captured.options.headers.Authorization, "test-key");
  assert.equal(captured.options.headers["Idempotency-Key"], "idem-prof-1");
  assert.equal(JSON.parse(captured.options.body).usageIndicator, "T");
  assert.equal(result.status, "ACKNOWLEDGED");
  assert.equal(result.transactionId, "corr-prof-1");
});

test("R2B - Stedi connector submits institutional 837I test claim", async () => {
  let captured = null;
  const fetchImpl = async (url, options) => {
    captured = { url: String(url), options };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      async text() {
        return JSON.stringify({
          claimReference: {
            correlationId: "corr-inst-1",
            claimType: "INST",
            patientControlNumber: "PCN-INST-1",
            payerId: "87726"
          },
          x12: "STC*A1:19*20261006~"
        });
      }
    };
  };

  const connector = createStediTestConnector({
    env: {
      STEDI_TEST_API_KEY: "test-key",
      STEDI_CLAIMS_API_BASE_URL: "https://claims.example.test/2024-04-01"
    },
    fetchImpl
  });

  const result = await connector.submitClaim(
    { id: "claim-inst-1", claimForm: "INSTITUTIONAL" },
    {
      requestPayload: {
        tradingPartnerServiceId: "87726",
        claimInformation: { patientControlNumber: "PCN-INST-1" }
      }
    }
  );

  assert.equal(
    captured.url,
    "https://claims.example.test/2024-04-01/change/medicalnetwork/institutionalclaims/v1/submission"
  );
  assert.equal(JSON.parse(captured.options.body).usageIndicator, "T");
  assert.equal(result.status, "ACKNOWLEDGED");
  assert.equal(result.claimType, "INSTITUTIONAL");
});

test("R2B - Stedi claim edit errors normalize to rejected 277CA state", () => {
  const result = normalizeStediClaimSubmissionResponse({
    claimReference: {
      correlationId: "corr-reject-1",
      patientControlNumber: "PCN-REJECT"
    },
    errors: [
      { code: "A3", description: "Invalid claim data" }
    ],
    x12: "STC*A3:21*20261006~"
  }, { claimType: "PROFESSIONAL" });

  assert.equal(result.status, "REJECTED");
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, "A3");
  assert.equal(result.has277CA, true);
});
