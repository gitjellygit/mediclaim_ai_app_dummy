import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStediClaimSubmissionRequest,
  buildStediEligibilityRequest,
  createStediProductionConnector
} from "../src/services/stediTestConnector.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");
const repoRoot = path.resolve(backendRoot, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const profile = {
  stediSubmitterName: "Example Billing Office",
  stediSubmitterId: "SUBMITTER1",
  stediSubmitterPhone: "5552223333",
  stediBillingProviderName: "Example Medical Group",
  stediBillingAddress1: "123 Main St",
  stediBillingAddress2: null,
  stediBillingCity: "Chicago",
  stediBillingState: "IL",
  stediBillingPostalCode: "606010000",
  stediProfessionalSignatureIndicator: "Y",
  stediProfessionalPlanParticipationCode: "A",
  stediInstitutionalPlanParticipationCode: "A",
  stediBenefitsAssignmentIndicator: "Y",
  stediReleaseInformationCode: "Y",
  stediDefaultProfessionalPlaceOfService: "11",
  stediDefaultInstitutionalPlaceOfService: "21"
};

function professionalClaim(overrides = {}) {
  return {
    id: "claim-review-1",
    claimForm: "PROFESSIONAL",
    patientControlNumber: "PCN123456",
    connectedPayerCode: "60054",
    connectedPayerName: "Example Payer",
    claimFilingCode: "CI",
    totalBilledAmount: "125.00",
    patientName: "Alex Patient",
    patientDob: new Date("1980-01-02"),
    patientGender: "MALE",
    patientAddress1: "10 Patient Ave",
    patientCity: "Chicago",
    patientState: "IL",
    patientPostalCode: "606020000",
    subscriberRelationship: "SELF",
    memberId: "MEMBER1",
    billingProviderNpi: "1999999984",
    renderingProviderNpi: "1888888873",
    providerTin: "123456789",
    providerTaxonomyCode: "207Q00000X",
    doctorName: "Jane Smith",
    coordinationOfBenefits: "PRIMARY",
    icd10Codes: ["Z00.00"],
    serviceLines: [
      {
        id: "line-1",
        verified: true,
        cptHcpcsCode: "99213",
        charge: "100.00",
        units: 1,
        diagnosisPointers: ["Z00.00"],
        placeOfService: "11",
        serviceDateFrom: new Date("2026-10-01")
      },
      {
        id: "line-2",
        verified: true,
        cptHcpcsCode: "99214",
        charge: "25.00",
        units: 1,
        diagnosisPointers: ["Z00.00"],
        placeOfService: "22",
        serviceDateFrom: new Date("2026-10-01")
      }
    ],
    ...overrides
  };
}

test("review follow-up - professional 837 includes rendering provider and line-level POS overrides", () => {
  const result = buildStediClaimSubmissionRequest(professionalClaim(), {
    submissionProfile: profile,
    usageIndicator: "T"
  });

  assert.equal(result.claimType, "PROFESSIONAL");
  assert.equal(result.payload.rendering.npi, "1888888873");
  assert.equal(result.payload.rendering.firstName, "Jane");
  assert.equal(result.payload.rendering.lastName, "Smith");
  assert.equal(result.payload.claimInformation.placeOfServiceCode, "11");
  assert.equal(
    result.payload.claimInformation.serviceLines[1].professionalService.placeOfServiceCode,
    "22"
  );
});

test("review follow-up - professional 837 enforces 12 diagnoses and 50 service lines", () => {
  const tooManyDiagnoses = professionalClaim({
    icd10Codes: Array.from({ length: 13 }, (_, index) => `Z${String(index).padStart(2, "0")}.0`)
  });
  assert.throws(
    () =>
      buildStediClaimSubmissionRequest(tooManyDiagnoses, {
        submissionProfile: profile
      }),
    /at most 12 diagnosis codes/
  );

  const baseLine = professionalClaim().serviceLines[0];
  const tooManyLines = professionalClaim({
    serviceLines: Array.from({ length: 51 }, (_, index) => ({
      ...baseLine,
      id: `line-${index + 1}`
    }))
  });
  assert.throws(
    () =>
      buildStediClaimSubmissionRequest(tooManyLines, {
        submissionProfile: profile
      }),
    /at most 50 service lines/
  );
});

test("review follow-up - production eligibility cannot invent a provider name", () => {
  assert.throws(
    () =>
      buildStediEligibilityRequest({
        id: "claim-eligibility-1",
        patientName: "Alex Patient",
        patientDob: new Date("1980-01-02"),
        subscriberRelationship: "SELF",
        memberId: "MEMBER1",
        payerEdiId: "60054",
        billingProviderNpi: "1999999984"
      }),
    /stediBillingProviderName\/provider name/
  );
});

test("review follow-up - production 837I remains independently disabled by default", async () => {
  const connector = createStediProductionConnector({
    env: {
      STEDI_PRODUCTION_API_KEY: "secret",
      STEDI_PRODUCTION_PHI_CONFIRMED: "true",
      STEDI_PRODUCTION_SUBMISSION_ENABLED: "true",
      STEDI_PRODUCTION_837I_ENABLED: "false"
    },
    fetchImpl: async () => {
      throw new Error("network should not be called");
    }
  });

  await assert.rejects(
    connector.submitClaim({ claimForm: "INSTITUTIONAL" }),
    /STEDI_PRODUCTION_837I_ENABLED/
  );
});

test("review follow-up - document identity unchanged responses are sanitized and smart upload update is transactional", () => {
  const documents = read("backend/src/routes/documents.js");

  assert.match(
    documents,
    /message: "This document has no pending identity review"[\s\S]*publicDocument\(doc\)/
  );
  assert.match(
    documents,
    /message: "Document identity has already been reviewed"[\s\S]*publicDocument\(doc\)/
  );

  const staged = documents.indexOf("pendingExistingClaimUpdate =");
  const tx = documents.indexOf("prisma.$transaction(async (tx)", staged);
  const update = documents.indexOf("await tx.claim.update", tx);
  const documentCreate = documents.indexOf("await tx.document.create", tx);
  assert.ok(staged >= 0);
  assert.ok(tx > staged);
  assert.ok(update > tx);
  assert.ok(documentCreate > update);
  assert.doesNotMatch(documents.slice(staged, tx), /await prisma\.claim\.update/);
});

test("review follow-up - 277 PAID remains payer status until remittance confirms payment", () => {
  const journey = read("backend/src/routes/claimJourney.js");

  assert.doesNotMatch(
    journey,
    /normalizedStatus === "PAID"[\s\S]{0,80}\? "PAID"/
  );
  assert.doesNotMatch(
    journey,
    /connectorPayerClaimStatus === "PAID"[\s\S]{0,80}\? "PAID"/
  );
  assert.match(
    journey,
    /remittanceStatus === "POSTED"[\s\S]*\? "PAID"/
  );
});

test("review follow-up - remittance mutation requires financial edit permission", () => {
  const journey = read("backend/src/routes/claimJourney.js");
  assert.match(
    journey,
    /journey\/remittance"[\s\S]*PERMISSIONS\.FINANCIAL_EDIT/
  );
});

test("review follow-up - submission profile writes are audited and admin-scoped", () => {
  const route = read("backend/src/routes/payerConnectors.js");
  assert.match(
    route,
    /submission-profile", requireRoles\(\["ADMIN"\]\)/
  );
  assert.match(route, /SUBMISSION_PROFILE_UPDATED/);
  assert.match(route, /writeCriticalRequestAudit/);
  assert.match(route, /changedFields/);
});

test("review follow-up - dev migrations and production image are explicitly guarded in CI", () => {
  const pkg = JSON.parse(read("backend/package.json"));
  const guard = read("backend/scripts/guardDevMigrations.js");
  const workflow = read(".github/workflows/claim-app-tests.yml");

  assert.match(pkg.scripts.dev, /db:prepare:dev/);
  assert.match(guard, /ALLOW_NONLOCAL_DEV_MIGRATIONS/);
  assert.match(guard, /Refusing to apply development-startup migrations/);
  assert.match(workflow, /Build backend production image/);
  assert.match(workflow, /Boot backend production image/);
  assert.match(workflow, /health\/ready/);
});
