import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStediClaimSubmissionRequest,
  buildStediClaimStatusRequest,
  buildStediEligibilityRequest,
  createStediProductionConnector,
  createStediTestConnector,
  listStediPayers,
  normalizeStediClaimSubmissionResponse,
  normalizeStediClaimStatusResponse,
  normalizeStediEligibilityResponse,
  normalizeStedi835Report,
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


test("R2B - Stedi builds trusted professional 837P payload from claim fields", () => {
  const result = buildStediClaimSubmissionRequest(
    {
      id: "claim-prof-build",
      claimForm: "PROFESSIONAL",
      connectedPayerCode: "60054",
      connectedPayerName: "Aetna",
      patientControlNumber: "ABC12345678901234",
      claimFilingCode: "CI",
      amount: "100.00",
      patientName: "Jane Doe",
      patientDob: new Date("1975-05-05T00:00:00.000Z"),
      patientGender: "FEMALE",
      patientAddress1: "123 Main St",
      patientCity: "Denver",
      patientState: "CO",
      patientPostalCode: "80202",
      memberId: "MEMBER123",
      subscriberRelationship: "SELF",
      coordinationOfBenefits: "PRIMARY",
      billingProviderNpi: "1999999984",
      providerTin: "123456789",
      providerTaxonomyCode: "207Q00000X",
      hospitalName: "Example Clinic",
      icd10Codes: ["M54.16"],
      dateOfService: new Date("2026-10-01T00:00:00.000Z"),
      serviceLines: [{
        id: "line-1",
        verified: true,
        cptHcpcsCode: "99213",
        charge: "100.00",
        units: "1",
        placeOfService: "11",
        diagnosisPointers: ["M54.16"],
        modifiers: []
      }]
    },
    {
      usageIndicator: "P",
      env: {
        STEDI_SUBMITTER_NAME: "Example Clinic",
        STEDI_SUBMITTER_PHONE: "3035550100",
        STEDI_BILLING_ADDRESS1: "500 Provider Ave",
        STEDI_BILLING_CITY: "Denver",
        STEDI_BILLING_STATE: "CO",
        STEDI_BILLING_POSTAL_CODE: "80203"
      }
    }
  );

  assert.equal(result.claimType, "PROFESSIONAL");
  assert.equal(result.payload.usageIndicator, "P");
  assert.equal(result.payload.tradingPartnerServiceId, "60054");
  assert.equal(result.payload.subscriber.memberId, "MEMBER123");
  assert.equal(result.payload.claimInformation.patientControlNumber.length, 17);
  assert.equal(result.payload.claimInformation.healthCareCodeInformation[0].diagnosisCode, "M5416");
  assert.equal(result.payload.claimInformation.serviceLines[0].professionalService.procedureCode, "99213");
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


test("R3 - builds minimal Stedi 276 claim status request from normalized claim fields", () => {
  const payload = buildStediClaimStatusRequest({
    ...claim,
    dateOfService: new Date("2026-10-01T00:00:00.000Z")
  });

  assert.equal(payload.tradingPartnerServiceId, "61101");
  assert.equal(payload.providers.length, 1);
  assert.equal(payload.providers[0].npi, "1999999984");
  assert.equal(payload.providers[0].providerType, "BillingProvider");
  assert.equal(payload.subscriber.firstName, "Jane");
  assert.equal(payload.subscriber.lastName, "Doe");
  assert.equal(payload.subscriber.memberId, "MEMBER123");
  assert.equal(payload.subscriber.dateOfBirth, "19750505");
  assert.equal(payload.encounter.beginningDateOfService, "20261001");
});

test("R3 - normalizes paid 277 response without turning it into an ERA", () => {
  const result = normalizeStediClaimStatusResponse(
    {
      controlNumber: "277-control-1",
      claims: [
        {
          claimStatus: {
            statusCategoryCode: "F1",
            statusCategoryCodeValue: "Finalized/Payment - The claim/line has been paid.",
            statusCode: "65",
            statusCodeValue: "Claim/line has been paid.",
            amountPaid: "108.77",
            tradingPartnerClaimNumber: "PAYER-CLM-100"
          }
        }
      ]
    },
    { claim: { insurerClaimNo: "PAYER-CLM-100" }, latencyMs: 31 }
  );

  assert.equal(result.status, "PAID");
  assert.equal(result.transactionId, "277-control-1");
  assert.equal(result.payerClaimNo, "PAYER-CLM-100");
  assert.equal(result.amountPaid, 108.77);
  assert.equal(result.livePayerVerification, true);
  assert.equal(result.testMode, false);
  assert.equal(result.transactionType, "276/277");
});

test("R3 - normalizes pending and denied 277 categories", () => {
  const pending = normalizeStediClaimStatusResponse({
    claims: [{
      claimStatus: {
        statusCategoryCode: "P1",
        statusCategoryCodeValue: "Pending/In Process",
        statusCode: "20",
        statusCodeValue: "Accepted for processing"
      }
    }]
  });
  assert.equal(pending.status, "IN_REVIEW");

  const denied = normalizeStediClaimStatusResponse({
    claims: [{
      claimStatus: {
        statusCategoryCode: "F2",
        statusCategoryCodeValue: "Finalized/Denial",
        statusCode: "88",
        statusCodeValue: "Entity not eligible for benefits"
      }
    }]
  });
  assert.equal(denied.status, "DENIED");
});

test("R3 - multiple unmatched payer claims require review instead of arbitrary selection", () => {
  const result = normalizeStediClaimStatusResponse(
    {
      controlNumber: "multi-277",
      claims: [
        { claimStatus: { tradingPartnerClaimNumber: "A", statusCategoryCode: "P1" } },
        { claimStatus: { tradingPartnerClaimNumber: "B", statusCategoryCode: "F1" } }
      ]
    },
    { claim: { insurerClaimNo: "C" } }
  );

  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.claimCount, 2);
});

test("R3 - connector sends configured production 276 request and receives synchronous 277", async () => {
  let captured = null;
  const fetchImpl = async (url, options) => {
    captured = { url: String(url), options };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      async text() {
        return JSON.stringify({
          controlNumber: "status-control-1",
          claims: [{
            claimStatus: {
              statusCategoryCode: "P1",
              statusCategoryCodeValue: "Pending/In Process",
              statusCode: "20",
              statusCodeValue: "Accepted for processing"
            }
          }]
        });
      }
    };
  };

  const connector = createStediProductionConnector({
    env: {
      STEDI_PRODUCTION_API_KEY: "production-status-key",
      STEDI_PRODUCTION_PHI_CONFIRMED: "true",
      STEDI_CLAIM_STATUS_URL: "https://status.example.test/change/medicalnetwork/claimstatus/v2"
    },
    fetchImpl
  });

  const result = await connector.getStatus({
    ...claim,
    dateOfService: new Date("2026-10-01T00:00:00.000Z")
  });

  assert.equal(
    captured.url,
    "https://status.example.test/change/medicalnetwork/claimstatus/v2"
  );
  assert.equal(captured.options.headers.Authorization, "production-status-key");
  assert.equal(JSON.parse(captured.options.body).tradingPartnerServiceId, "61101");
  assert.equal(result.status, "IN_REVIEW");
  assert.equal(result.livePayerVerification, true);
});


test("R4 - normalizes matched 835 ERA financials and adjustments", () => {
  const result = normalizeStedi835Report(
    {
      meta: {
        applicationMode: "test",
        transactionId: "835-test-1"
      },
      transactions: [
        {
          controlNumber: "CTRL-835-1",
          paymentAndRemitReassociationDetails: {
            checkOrEFTTraceNumber: "EFT-10001"
          },
          financialInformation: {
            paymentMethodCode: "ACH",
            checkIssueOrEFTEffectiveDate: "20261008"
          },
          payer: { name: "TEST PAYER" },
          payee: { npi: "1999999984" },
          detailInfo: [
            {
              paymentInfo: [
                {
                  claimPaymentInfo: {
                    patientControlNumber: "PCN-R4-100",
                    payerClaimControlNumber: "PAYER-R4-100",
                    totalClaimChargeAmount: "1000.00",
                    claimPaymentAmount: "650.00",
                    patientResponsibilityAmount: "150.00",
                    claimStatusCode: "1"
                  },
                  patientName: {
                    firstName: "JANE",
                    lastName: "DOE",
                    memberId: "MEMBER123"
                  },
                  claimAdjustments: [
                    {
                      claimAdjustmentGroupCode: "CO",
                      claimAdjustmentGroupCodeValue: "Contractual Obligation",
                      adjustmentReasonCode1: "45",
                      adjustmentReason1: "Charge exceeds fee schedule",
                      adjustmentAmount1: "200.00"
                    }
                  ],
                  serviceLines: [
                    {
                      lineItemControlNumber: "LINE-1",
                      servicePaymentInformation: {
                        adjudicatedProcedureCode: "99213",
                        lineItemChargeAmount: "1000.00",
                        lineItemProviderPaymentAmount: "650.00"
                      },
                      serviceSupplementalAmounts: {
                        allowedActual: "800.00"
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    { expectedPatientControlNumber: "pcn-r4-100" }
  );

  assert.equal(result.status, "POSTED");
  assert.equal(result.patientControlNumber, "PCN-R4-100");
  assert.equal(result.billedAmount, 1000);
  assert.equal(result.allowedAmount, 800);
  assert.equal(result.paidAmount, 650);
  assert.equal(result.patientResponsibility, 150);
  assert.equal(result.expectedPayerPayment, 650);
  assert.equal(result.potentialUnderpayment, 0);
  assert.equal(result.paymentReference, "EFT-10001");
  assert.equal(result.adjustments[0].groupCode, "CO");
  assert.equal(result.adjustments[0].reasonCode, "45");
  assert.equal(result.testMode, true);
});

test("R4 - 835 normalization refuses unmatched or duplicate claim matches", () => {
  const payment = (pcn) => ({
    claimPaymentInfo: {
      patientControlNumber: pcn,
      totalClaimChargeAmount: "100",
      claimPaymentAmount: "80",
      patientResponsibilityAmount: "20"
    }
  });
  const body = {
    transactions: [
      {
        detailInfo: [
          {
            paymentInfo: [
              payment("PCN-A"),
              payment("PCN-A"),
              payment("PCN-B")
            ]
          }
        ]
      }
    ]
  };

  const missing = normalizeStedi835Report(body, {
    expectedPatientControlNumber: "PCN-Z"
  });
  assert.equal(missing.status, "NOT_FOUND");

  const ambiguous = normalizeStedi835Report(body, {
    expectedPatientControlNumber: "pcn-a"
  });
  assert.equal(ambiguous.status, "NEEDS_REVIEW");
  assert.equal(ambiguous.matchCount, 2);
});

test("R4 - Stedi test connector retrieves a specific 835 report", async () => {
  let capturedUrl = "";
  const fetchImpl = async (url) => {
    capturedUrl = String(url);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      async text() {
        return JSON.stringify({
          meta: { applicationMode: "test", transactionId: "835-uuid-100" },
          transactions: [
            {
              paymentAndRemitReassociationDetails: {
                checkOrEFTTraceNumber: "CHECK-100"
              },
              detailInfo: [
                {
                  paymentInfo: [
                    {
                      claimPaymentInfo: {
                        patientControlNumber: "PCN-100",
                        totalClaimChargeAmount: "500",
                        claimPaymentAmount: "400",
                        patientResponsibilityAmount: "100",
                        claimStatusCode: "1"
                      },
                      serviceLines: [
                        {
                          serviceSupplementalAmounts: {
                            allowedActual: "500"
                          }
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        });
      }
    };
  };

  const connector = createStediTestConnector({
    env: {
      STEDI_TEST_API_KEY: "test-key",
      STEDI_ERA_API_BASE_URL: "https://era.example.test/2024-04-01"
    },
    fetchImpl
  });

  const result = await connector.getRemittance(
    { id: "claim-r4" },
    {
      transactionId: "835-uuid-100",
      expectedPatientControlNumber: "PCN-100"
    }
  );

  assert.match(
    capturedUrl,
    /\/change\/medicalnetwork\/reports\/v2\/835-uuid-100\/835$/
  );
  assert.equal(result.status, "POSTED");
  assert.equal(result.paymentReference, "CHECK-100");
  assert.equal(result.paidAmount, 400);
});


test("R3 - production Stedi submitClaim sends production 837 and never returns raw X12", async () => {
  let captured = null;
  const fetchImpl = async (url, options) => {
    captured = { url: String(url), options };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      async text() {
        return JSON.stringify({
          status: "SUCCESS",
          controlNumber: "1",
          tradingPartnerServiceId: "60054",
          claimReference: {
            correlationId: "corr-production-1",
            patientControlNumber: "ABC12345678901234",
            payerId: "60054"
          },
          x12: "PHI-X12-MUST-NOT-BE-NORMALIZED"
        });
      }
    };
  };

  const connector = createStediProductionConnector({
    env: {
      STEDI_PRODUCTION_API_KEY: "prod-key",
      STEDI_PRODUCTION_PHI_CONFIRMED: "true",
      STEDI_PRODUCTION_CLAIMS_API_BASE_URL: "https://claims.example.test/2024-04-01",
      STEDI_SUBMITTER_NAME: "Example Clinic",
      STEDI_SUBMITTER_PHONE: "3035550100",
      STEDI_BILLING_ADDRESS1: "500 Provider Ave",
      STEDI_BILLING_CITY: "Denver",
      STEDI_BILLING_STATE: "CO",
      STEDI_BILLING_POSTAL_CODE: "80203"
    },
    fetchImpl
  });

  const result = await connector.submitClaim({
    id: "claim-prod",
    claimForm: "PROFESSIONAL",
    connectedPayerCode: "60054",
    connectedPayerName: "Aetna",
    patientControlNumber: "ABC12345678901234",
    claimFilingCode: "CI",
    amount: "100.00",
    patientName: "Jane Doe",
    patientDob: new Date("1975-05-05T00:00:00.000Z"),
    patientGender: "FEMALE",
    patientAddress1: "123 Main St",
    patientCity: "Denver",
    patientState: "CO",
    patientPostalCode: "80202",
    memberId: "MEMBER123",
    subscriberRelationship: "SELF",
    billingProviderNpi: "1999999984",
    providerTin: "123456789",
    providerTaxonomyCode: "207Q00000X",
    hospitalName: "Example Clinic",
    icd10Codes: ["M54.16"],
    dateOfService: new Date("2026-10-01T00:00:00.000Z"),
    serviceLines: [{
      id: "line-1",
      verified: true,
      cptHcpcsCode: "99213",
      charge: "100.00",
      units: "1",
      placeOfService: "11",
      diagnosisPointers: ["M54.16"],
      modifiers: []
    }]
  });

  assert.match(captured.url, /professionalclaims\/v3\/submission$/);
  assert.equal(JSON.parse(captured.options.body).usageIndicator, "P");
  assert.equal(result.status, "ACKNOWLEDGED");
  assert.equal(result.testMode, false);
  assert.equal(result.livePayerSubmission, true);
  assert.equal("x12" in result, false);
});


test("R2C - Stedi builds institutional 837I with interim frequency and admission codes", () => {
  const result = buildStediClaimSubmissionRequest(
    {
      id: "claim-inst-build",
      claimForm: "INSTITUTIONAL",
      connectedPayerCode: "60054",
      connectedPayerName: "Aetna",
      patientControlNumber: "INST1234567890123",
      claimFilingCode: "CI",
      claimFrequencyCode: "INTERIM_FIRST",
      amount: "5000.00",
      patientName: "Alex Morgan",
      patientDob: new Date("1980-01-15T00:00:00.000Z"),
      patientGender: "MALE",
      patientAddress1: "101 Main St",
      patientCity: "Denver",
      patientState: "CO",
      patientPostalCode: "80202",
      memberId: "MEM-INST-1",
      subscriberRelationship: "SELF",
      billingProviderNpi: "1999999984",
      providerTin: "123456789",
      providerTaxonomyCode: "282N00000X",
      hospitalName: "Example Hospital",
      icd10Codes: ["J18.9"],
      admissionDate: new Date("2026-10-01T00:00:00.000Z"),
      dischargeDate: new Date("2026-10-03T00:00:00.000Z"),
      admissionTypeCode: "1",
      admissionSourceCode: "1",
      patientStatusCode: "01",
      serviceLines: [{
        id: "line-inst-1",
        verified: true,
        cptHcpcsCode: "99223",
        revenueCode: "0120",
        charge: "5000.00",
        units: "1",
        placeOfService: "21",
        diagnosisPointers: ["J18.9"]
      }]
    },
    {
      usageIndicator: "P",
      env: {
        STEDI_SUBMITTER_NAME: "Example Hospital",
        STEDI_SUBMITTER_PHONE: "3035550100",
        STEDI_BILLING_ADDRESS1: "500 Provider Ave",
        STEDI_BILLING_CITY: "Denver",
        STEDI_BILLING_STATE: "CO",
        STEDI_BILLING_POSTAL_CODE: "80203"
      }
    }
  );

  assert.equal(result.claimType, "INSTITUTIONAL");
  assert.equal(result.payload.usageIndicator, "P");
  assert.equal(result.payload.claimInformation.claimFrequencyCode, "2");
  assert.equal(result.payload.claimInformation.claimCodeInformation.admissionTypeCode, "1");
  assert.equal(result.payload.claimInformation.claimCodeInformation.patientStatusCode, "01");
  assert.equal(
    result.payload.claimInformation.serviceLines[0].institutionalService.serviceLineRevenueCode,
    "0120"
  );
});
