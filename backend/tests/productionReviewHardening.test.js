import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStediClaimSubmissionRequest,
  createStediProductionConnector,
  createStediTestConnector
} from "../src/services/stediTestConnector.js";
import {
  listPayerConnectors,
  payerConnectorStatusForClaim
} from "../src/services/payerGateway.js";
import {
  writeCriticalAuditEvent,
  writeAuditEvent
} from "../src/services/auditLog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const billingProfile = Object.freeze({
  active: true,
  submitterName: "Tenant Clinic",
  submitterId: "TENANT-SUBMITTER",
  submitterPhone: "3035550100",
  billingProviderName: "Tenant Clinic LLC",
  billingAddress1: "500 Provider Ave",
  billingAddress2: null,
  billingCity: "Denver",
  billingState: "CO",
  billingPostalCode: "80203",
  signatureOnFile: false,
  assignmentOfBenefits: true,
  releaseOfInformation: false,
  professionalPlanParticipationCode: "B",
  institutionalPlanParticipationCode: "D",
  defaultProfessionalPlaceOfService: "12",
  defaultInstitutionalPlaceOfService: "22"
});

const professionalClaim = Object.freeze({
  id: "review-hardening-claim",
  claimForm: "PROFESSIONAL",
  connectedPayerCode: "60054",
  connectedPayerName: "Aetna",
  patientControlNumber: "REVIEW12345678901",
  claimFilingCode: "CI",
  claimFrequencyCode: "ORIGINAL",
  amount: "100.00",
  totalBilledAmount: "100.00",
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
  icd10Codes: ["M54.16"],
  dateOfService: new Date("2026-10-01T00:00:00.000Z"),
  serviceLines: [{
    id: "line-1",
    verified: true,
    cptHcpcsCode: "99213",
    charge: "100.00",
    units: "1",
    placeOfService: null,
    diagnosisPointers: ["M54.16"],
    modifiers: []
  }]
});

test("review - production 837 requires organization billing profile", () => {
  assert.throws(
    () =>
      buildStediClaimSubmissionRequest(professionalClaim, {
        usageIndicator: "P"
      }),
    (error) =>
      error?.code === "STEDI_CLAIM_REQUEST_INVALID" &&
      /organization billing profile/i.test(error.message)
  );
});

test("review - production 837 uses explicit org attestations and defaults", () => {
  const result = buildStediClaimSubmissionRequest(professionalClaim, {
    usageIndicator: "P",
    billingProfile
  });

  assert.equal(result.payload.submitter.organizationName, "Tenant Clinic");
  assert.equal(result.payload.billing.organizationName, "Tenant Clinic LLC");
  assert.equal(result.payload.billing.address.address1, "500 Provider Ave");
  assert.equal(result.payload.claimInformation.signatureIndicator, "N");
  assert.equal(
    result.payload.claimInformation.benefitsAssignmentCertificationIndicator,
    "Y"
  );
  assert.equal(result.payload.claimInformation.releaseInformationCode, "N");
  assert.equal(result.payload.claimInformation.planParticipationCode, "B");
  assert.equal(result.payload.claimInformation.placeOfServiceCode, "12");
});

test("review - production connector separates PHI, submit, and ERA enablement", async () => {
  const baseEnv = {
    STEDI_PRODUCTION_API_KEY: "prod-key",
    STEDI_PRODUCTION_PHI_CONFIRMED: "true"
  };

  const disabled = new Map(
    listPayerConnectors(baseEnv).map((item) => [item.id, item])
  ).get("STEDI_PRODUCTION");

  assert.equal(disabled.configured, true);
  assert.equal(disabled.capabilities.includes("checkEligibility"), true);
  assert.equal(disabled.capabilities.includes("submitClaim"), false);
  assert.equal(disabled.capabilities.includes("getRemittance"), false);

  const connector = createStediProductionConnector({
    env: baseEnv,
    fetchImpl: async () => {
      throw new Error("network should not be reached");
    }
  });

  await assert.rejects(
    () =>
      connector.submitClaim(professionalClaim, {
        billingProfile
      }),
    (error) =>
      error?.code === "PAYER_CONNECTOR_UNAVAILABLE" &&
      /submission is disabled/i.test(error.message)
  );

  await assert.rejects(
    () =>
      connector.getRemittance(professionalClaim, {
        expectedPatientControlNumber: professionalClaim.patientControlNumber
      }),
    (error) =>
      error?.code === "PAYER_CONNECTOR_UNAVAILABLE" &&
      /tenant isolation/i.test(error.message)
  );

  const enabled = payerConnectorStatusForClaim(
    {
      payerConnectionMode: "LIVE",
      payerConnectorId: "STEDI_PRODUCTION"
    },
    {
      ...baseEnv,
      STEDI_PRODUCTION_SUBMISSION_ENABLED: "true",
      STEDI_PRODUCTION_ERA_TENANT_ISOLATION_CONFIRMED: "true"
    }
  );

  assert.equal(enabled.capabilities.includes("submitClaim"), true);
  assert.equal(enabled.capabilities.includes("getRemittance"), true);
});

test("review - idempotency key is stable for same payload and changes with payload", async () => {
  const seen = [];
  const fetchImpl = async (_url, options) => {
    seen.push(options.headers["Idempotency-Key"]);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      async text() {
        return JSON.stringify({
          claimReference: {
            correlationId: `corr-${seen.length}`,
            patientControlNumber: "PCN"
          }
        });
      }
    };
  };

  const connector = createStediTestConnector({
    env: {
      STEDI_TEST_API_KEY: "test-key",
      STEDI_CLAIMS_API_BASE_URL: "https://claims.example.test"
    },
    fetchImpl
  });

  const context = {
    idempotencyKey: "claim-app-idem",
    requestPayload: {
      tradingPartnerServiceId: "60054",
      claimInformation: { patientControlNumber: "PCN", charge: "100" }
    }
  };

  const first = await connector.submitClaim(
    { id: "idem-claim", claimForm: "PROFESSIONAL" },
    context
  );
  const second = await connector.submitClaim(
    { id: "idem-claim", claimForm: "PROFESSIONAL" },
    context
  );
  const changed = await connector.submitClaim(
    { id: "idem-claim", claimForm: "PROFESSIONAL" },
    {
      ...context,
      requestPayload: {
        ...context.requestPayload,
        claimInformation: { patientControlNumber: "PCN", charge: "101" }
      }
    }
  );

  assert.equal(seen[0], seen[1]);
  assert.notEqual(seen[0], seen[2]);
  assert.equal(first.payloadHash, second.payloadHash);
  assert.notEqual(first.payloadHash, changed.payloadHash);
  assert.match(first.payloadHash, /^[a-f0-9]{64}$/);
});

test("review - submit route requires explicit production confirmation and safe unknown outcome", () => {
  const claims = read("src/routes/claims.js");
  const journey = read("../frontend/src/modules/journey/ClaimJourney.jsx");
  const api = read("../frontend/src/api/claims.js");

  assert.match(claims, /confirmProductionSubmission/);
  assert.match(claims, /PRODUCTION_SUBMISSION_CONFIRMATION_REQUIRED/);
  assert.match(claims, /PAYER_SUBMISSION_OUTCOME_UNKNOWN/);
  assert.match(claims, /retrySafe: true/);
  assert.match(claims, /billingProfile: claim\.organization\?\.billingProfile/);

  assert.match(journey, /Transmit production 837 claim\?/);
  assert.match(journey, /PHI to the production payer\/clearinghouse/);
  assert.match(api, /confirmProductionSubmission/);
});

test("review - organization billing profile is one-to-one and admin managed", () => {
  const schema = read("prisma/schema.prisma");
  const route = read("src/routes/organizationBillingProfile.js");
  const app = read("../frontend/src/App.jsx");

  assert.match(schema, /model OrganizationBillingProfile/);
  assert.match(schema, /organizationId\s+String\s+@unique/);
  assert.match(schema, /signatureOnFile\s+Boolean\?/);
  assert.match(schema, /assignmentOfBenefits\s+Boolean\?/);
  assert.match(schema, /releaseOfInformation\s+Boolean\?/);

  assert.match(route, /requirePermission\(PERMISSIONS\.USER_ADMIN\)/);
  assert.match(route, /ORGANIZATION_BILLING_PROFILE_UPDATED/);
  assert.match(app, /\/settings\/billing-profile/);
  assert.match(app, /PERMISSIONS\.USER_ADMIN/);
});

test("review - runtime exposes hardened health shutdown headers and throttling", () => {
  const index = read("src/index.js");
  const headers = read("src/middleware/securityHeaders.js");
  const rate = read("src/middleware/apiRateLimit.js");
  const dockerfile = read("Dockerfile");

  assert.match(index, /app\.disable\("x-powered-by"\)/);
  assert.match(index, /\/health\/ready/);
  assert.match(index, /SELECT 1/);
  assert.match(index, /const server = app\.listen/);
  assert.match(index, /server\.close/);
  assert.match(index, /express\.json\(\{ limit:/);
  assert.match(headers, /Strict-Transport-Security/);
  assert.match(headers, /Content-Security-Policy/);
  assert.match(rate, /API_RATE_LIMITED/);
  assert.match(rate, /maxExpensiveRequests/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /HEALTHCHECK/);
});

test("review - ERA discovery and tenant lists are bounded", () => {
  const stedi = read("src/services/stediTestConnector.js");
  const claims = read("src/routes/claims.js");
  const documents = read("src/routes/documents.js");

  assert.match(stedi, /ERA_DISCOVERY_DEADLINE_MS = 20000/);
  assert.match(stedi, /ERA_DISCOVERY_MAX_PAGES = 3/);
  assert.match(stedi, /ERA_DISCOVERY_MAX_CANDIDATES = 20/);
  assert.match(stedi, /pageToken/);
  assert.match(stedi, /AbortSignal\.timeout/);

  assert.match(claims, /pageSize[^\n]*50/);
  assert.match(claims, /take: pageSize/);
  assert.match(claims, /X-Total-Count/);
  assert.match(documents, /take: pageSize/);
  assert.match(documents, /X-Total-Count/);
});

test("review - critical audit export fails closed while normal telemetry stays best effort", async () => {
  const failingPrisma = {
    auditEvent: {
      async create() {
        throw Object.assign(new Error("audit database unavailable"), {
          code: "DB_DOWN"
        });
      }
    }
  };
  const event = {
    organizationId: "org-1",
    action: "TEST",
    entityType: "Test"
  };

  const bestEffort = await writeAuditEvent(failingPrisma, event);
  assert.equal(bestEffort, null);

  await assert.rejects(
    () => writeCriticalAuditEvent(failingPrisma, event),
    /audit database unavailable/
  );

  const auditRoute = read("src/routes/audit.js");
  const claimsRoute = read("src/routes/claims.js");
  assert.match(auditRoute, /writeCriticalRequestAudit/);
  assert.match(auditRoute, /AUDIT_TRAIL_EXPORTED/);
  assert.match(claimsRoute, /CLAIM_PERMANENTLY_PURGED[\s\S]*tx\.claim\.delete/);
});

test("review - CI and release tooling are explicit", () => {
  const workflow = read("../.github/workflows/claim-app-tests.yml");
  const codeql = read("../.github/workflows/codeql.yml");
  const dependabot = read("../.github/dependabot.yml");
  const backendPkg = JSON.parse(read("package.json"));
  const frontendPkg = JSON.parse(read("../frontend/package.json"));
  const migrationRunbook = read("../docs/MIGRATION_REHEARSAL.md");

  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /Check backend formatting/);
  assert.match(workflow, /Check frontend formatting/);
  assert.equal(backendPkg.scripts.lint, "npx --yes eslint@9.39.1 .");
  assert.equal(backendPkg.scripts["format:check"], "npx --yes prettier@3.6.2 --check .");
  assert.equal(frontendPkg.scripts.lint, "npx --yes eslint@9.39.1 .");
  assert.match(codeql, /github\/codeql-action\/analyze@v4/);
  assert.match(dependabot, /package-ecosystem: "npm"/);
  assert.match(migrationRunbook, /representative existing data/);
});
