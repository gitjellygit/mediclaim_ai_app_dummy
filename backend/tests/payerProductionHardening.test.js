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


test("hardening - cached eligibility responses stay sanitized and preserve production verification", () => {
  const journey = read("backend/src/routes/claimJourney.js");

  assert.match(
    journey,
    /transaction:\s*sanitizePayerTransaction\(latestEligibilityTransaction\)/
  );
  assert.match(
    journey,
    /latestEligibilityTransaction\.mode === "PRODUCTION"/
  );
  assert.doesNotMatch(
    journey,
    /livePayerVerification:\s*false,\s*transaction:\s*latestEligibilityTransaction/
  );
});

test("hardening - payer transaction responses are sanitized before returning to the browser", () => {
  const journey = read("backend/src/routes/claimJourney.js");

  assert.match(
    journey,
    /transaction:\s*sanitizePayerTransaction\(payerTransaction\)/
  );
  assert.match(
    journey,
    /transaction:\s*sanitizePayerTransaction\(posted\.transaction\)/
  );
  assert.match(
    journey,
    /result:\s*stripSensitivePayerPayload\(result\)/
  );
});


test("hardening - concurrent 835 refreshes recover as idempotent duplicates", () => {
  const journey = read("backend/src/routes/claimJourney.js");

  assert.match(journey, /error\?\.code === "P2002"/);
  assert.match(journey, /duplicateTransaction = await prisma\.payerTransaction\.findFirst/);
  assert.match(
    journey,
    /message: "This 835 ERA has already been posted to the claim"/
  );
});

test("hardening - non-posted ERA responses are sanitized before browser return", () => {
  const journey = read("backend/src/routes/claimJourney.js");

  assert.match(
    journey,
    /available: false,[\s\S]*result: stripSensitivePayerPayload\(result\)/
  );
  assert.match(
    journey,
    /needsReview: true,[\s\S]*result: stripSensitivePayerPayload\(result\)/
  );
});


test("hardening - ERA responses never return unsanitized claim payer history", () => {
  const journey = read("backend/src/routes/claimJourney.js");

  assert.match(journey, /function sanitizeClaimPayerTransactions\(claim\)/);
  assert.match(
    journey,
    /claim:\s*sanitizeClaimPayerTransactions\(claim\)/
  );
  assert.match(
    journey,
    /claim:\s*sanitizeClaimPayerTransactions\(currentClaim \|\| claim\)/
  );
});


test("payer connection - dev startup prepares Prisma and stale schema is actionable", () => {
  const pkg = JSON.parse(read("backend/package.json"));
  const simulation = read("backend/src/routes/claimPayerSimulation.js");

  assert.equal(
    pkg.scripts["db:prepare"],
    "prisma generate && prisma migrate deploy"
  );
  assert.match(pkg.scripts.dev, /npm run db:prepare/);
  assert.equal(pkg.scripts.postinstall, "prisma generate");

  assert.match(simulation, /PAYER_SCHEMA_OUT_OF_DATE/);
  assert.match(simulation, /code === "P2022"/);
  assert.match(simulation, /PrismaClientValidationError/);
  assert.match(
    simulation,
    /Apply Prisma migrations and regenerate the Prisma client/
  );
});
