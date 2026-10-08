import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStediEligibilityRequest,
  normalizeStediClaimStatusResponse,
  normalizeStediEligibilityResponse,
  normalizeStedi835Report
} from "../src/services/stediTestConnector.js";
import { listPayerConnectors } from "../src/services/payerGateway.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(backendRoot, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("hardening - production Stedi requires explicit PHI enablement and test is disabled in production", () => {
  const productionWithoutGate = listPayerConnectors({
    NODE_ENV: "production",
    STEDI_PRODUCTION_API_KEY: "secret",
    STEDI_PRODUCTION_PHI_CONFIRMED: "false",
    STEDI_TEST_API_KEY: "test-secret"
  });
  assert.equal(
    productionWithoutGate.find((item) => item.id === "STEDI_PRODUCTION")?.configured,
    false
  );
  assert.equal(
    productionWithoutGate.find((item) => item.id === "STEDI_TEST")?.configured,
    false
  );

  const productionWithGate = listPayerConnectors({
    NODE_ENV: "production",
    STEDI_PRODUCTION_API_KEY: "secret",
    STEDI_PRODUCTION_PHI_CONFIRMED: "true"
  });
  assert.equal(
    productionWithGate.find((item) => item.id === "STEDI_PRODUCTION")?.configured,
    true
  );
});

test("hardening - dependent eligibility uses subscriber DOB and name", () => {
  const request = buildStediEligibilityRequest({
    id: "claim-1",
    patientName: "Dependent Child",
    patientDob: new Date("2016-01-02"),
    subscriberId: "SUB-100",
    subscriberName: "Taylor Parent",
    subscriberDob: new Date("1985-04-05"),
    subscriberRelationship: "CHILD",
    payerEdiId: "60054",
    billingProviderNpi: "1999999984"
  });

  assert.equal(request.subscriber.memberId, "SUB-100");
  assert.equal(request.subscriber.dateOfBirth, "1985-04-05");
  assert.equal(request.subscriber.name.person.firstName, "Taylor");
  assert.equal(request.subscriber.name.person.lastName, "Parent");
});

test("hardening - benefits without explicit coverage status do not become ACTIVE", () => {
  const result = normalizeStediEligibilityResponse({
    plans: [
      {
        benefits: {
          deductible: [{ amount: "1000.00" }]
        }
      }
    ]
  });
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.coverageStatus, "UNKNOWN");
});

test("hardening - partial amountPaid alone does not mark 277 as PAID", () => {
  const result = normalizeStediClaimStatusResponse(
    {
      claims: [
        {
          claimStatus: {
            statusCategoryCode: "P1",
            statusCategoryCodeValue: "Pending",
            amountPaid: "10.00"
          }
        }
      ]
    },
    { claim: {} }
  );
  assert.equal(result.status, "IN_REVIEW");
  assert.equal(result.amountPaid, 10);
  assert.equal("raw" in result, false);
});

test("hardening - normalized 835 does not retain raw payer body", () => {
  const result = normalizeStedi835Report(
    {
      meta: { transactionId: "era-1", applicationMode: "test" },
      transactions: [
        {
          detailInfo: [
            {
              paymentInfo: [
                {
                  claimPaymentInfo: {
                    patientControlNumber: "PCN-1",
                    totalClaimChargeAmount: "100.00",
                    claimPaymentAmount: "80.00",
                    patientResponsibilityAmount: "20.00"
                  },
                  serviceLines: [
                    {
                      serviceSupplementalAmounts: { allowedActual: "100.00" }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    { expectedPatientControlNumber: "PCN-1" }
  );
  assert.equal(result.status, "POSTED");
  assert.equal("raw" in result, false);
  assert.equal(result.potentialUnderpayment, 0);
});

test("hardening - payer transaction and ERA trust boundaries are claim-scoped", () => {
  const schema = read("backend/prisma/schema.prisma");
  const journey = read("backend/src/routes/claimJourney.js");

  assert.match(schema, /@@unique\(\[transactionId, claimId\]\)/);
  assert.doesNotMatch(schema, /transactionId\s+String\s+@unique/);
  assert.match(
    journey,
    /requireRoles\(\["ADMIN"\]\)[\s\S]*payer-connection|payer-connection[\s\S]*requireRoles\(\["ADMIN"\]\)/
  );
  assert.match(journey, /parseMutation\(emptyMutationSchema, req\.body\)/);
  assert.doesNotMatch(
    journey,
    /req\.body\?\.patientControlNumber/
  );
  assert.doesNotMatch(
    journey,
    /typeof req\.body\?\.transactionId/
  );
});

test("hardening - audit CSV neutralizes spreadsheet formulas", () => {
  const audit = read("backend/src/routes/audit.js");
  assert.match(audit, /\/\^\[=\+\\-@\]\//);
});

test("hardening - smart upload creates new claim inside first-document transaction", () => {
  const documents = read("backend/src/routes/documents.js");
  const createIndex = documents.indexOf("pendingNewClaimData");
  const txIndex = documents.indexOf("prisma.$transaction(async (tx)");
  const transactionalCreateIndex = documents.indexOf("await tx.claim.create", txIndex);
  assert.ok(createIndex >= 0);
  assert.ok(txIndex >= 0);
  assert.ok(transactionalCreateIndex > txIndex);
  assert.doesNotMatch(
    documents.slice(createIndex, txIndex),
    /await prisma\.claim\.create/
  );
});

test("hardening - readiness accepts member/subscriber ID when policy number is absent", () => {
  const claims = read("backend/src/routes/claims.js");
  assert.match(
    claims,
    /!claim\.policyNo\s*&&\s*!claim\.memberId\s*&&\s*!claim\.subscriberId/
  );
});

test("hardening - upstream Stedi errors are translated before generic HTTP status handling", () => {
  const journey = read("backend/src/routes/claimJourney.js");
  assert.match(journey, /sendConnectorFailure\(res, error, "Claim status"\)/);
  assert.match(journey, /sendConnectorFailure\(res, error, "835 ERA"\)/);
  assert.match(journey, /sendConnectorFailure\(res, error, "Eligibility"\)/);
});
