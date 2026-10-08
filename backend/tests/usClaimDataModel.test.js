import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFields } from "../src/services/docIntel.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("U3 - Prisma schema includes US provider coverage facility and service-line fields", () => {
  const schema = read("backend/prisma/schema.prisma");

  for (const expected of [
    "billingProviderNpi",
    "renderingProviderNpi",
    "referringProviderNpi",
    "providerTin",
    "providerTaxonomyCode",
    "groupNumber",
    "subscriberId",
    "subscriberName",
    "subscriberDob",
    "subscriberRelationship",
    "coordinationOfBenefits",
    "payerEdiId",
    "typeOfBill",
    "drgCode",
    "claimFrequencyCode",
    "timelyFilingDeadline",
    "inpatientProcedureCodes",
    "model ServiceLine",
    "cptHcpcsCode",
    "diagnosisPointers",
    "placeOfService",
    "revenueCode",
    "poaIndicator"
  ]) {
    assert.ok(schema.includes(expected), expected);
  }
});

test("U3 - SQL migration creates normalized service lines and US claim columns", () => {
  const migration = read(
    "backend/prisma/migrations/20261002101500_us_claim_data_model/migration.sql"
  );

  assert.ok(migration.includes('CREATE TABLE "ServiceLine"'));
  assert.ok(migration.includes('"billingProviderNpi" TEXT'));
  assert.ok(migration.includes('"subscriberRelationship" "SubscriberRelationship"'));
  assert.ok(migration.includes('"claimFrequencyCode" "ClaimFrequencyCode"'));
  assert.ok(migration.includes('"cptHcpcsCode" TEXT NOT NULL'));
  assert.ok(migration.includes('REFERENCES "Claim"("id")'));
});

test("U3 - claim API validates and persists service-line payloads", () => {
  const claimsRoute = read("backend/src/routes/claims.js");
  const mutations = read("backend/src/validation/claimMutations.js");

  assert.ok(mutations.includes("serviceLineInputSchema"));
  assert.ok(mutations.includes("diagnosisPointers"));
  assert.ok(claimsRoute.includes("normalizeServiceLines"));
  assert.ok(claimsRoute.includes("tx.serviceLine.deleteMany"));
  assert.ok(claimsRoute.includes("tx.serviceLine.createMany"));
  assert.ok(claimsRoute.includes('serviceLines: { orderBy: { createdAt: "asc" } }'));
});

test("U3 - document intelligence CPT extraction is wired to persisted service lines", () => {
  const extracted = extractFields(
    "Patient Name: Jane Doe\nICD-10: M54.50\nCPT Codes: 99213, 72100\nDate of Service: 10/01/2026"
  );
  assert.deepEqual(extracted.cptCodes, ["99213", "72100"]);

  const documentRoute = read("backend/src/routes/documents.js");
  assert.ok(documentRoute.includes("persistExtractedServiceLines"));
  assert.ok(documentRoute.includes("extracted.cptCodes"));
  assert.ok(documentRoute.includes("prismaClient.serviceLine.createMany"));
});

test("U3 - frontend captures and displays US service-line data", () => {
  const newClaim = read("frontend/src/pages/NewClaim.jsx");
  const claimDetail = read("frontend/src/modules/ai-claims/ClaimDetail.jsx");
  const editor = read("frontend/src/components/ServiceLinesEditor.jsx");

  for (const expected of [
    "Billing Provider NPI",
    "Rendering Provider NPI",
    "Provider TIN",
    "Provider Taxonomy Code",
    "Group Number",
    "Subscriber Relationship",
    "Coordination of Benefits",
    "Payer EDI ID",
    "Claim Frequency",
    "Timely Filing Deadline",
    "Type of Bill",
    "DRG",
    "Service Lines"
  ]) {
    assert.ok(newClaim.includes(expected), expected);
  }

  assert.ok(claimDetail.includes("ServiceLinesEditor"));
  assert.ok(claimDetail.includes("ICD-10-PCS"));
  assert.ok(editor.includes("CPT / HCPCS"));
  assert.ok(editor.includes("Linked Diagnosis Codes"));
  assert.ok(editor.includes("Place of Service"));
  assert.ok(editor.includes("Revenue Code"));
  assert.ok(editor.includes("POA Indicator"));
});
