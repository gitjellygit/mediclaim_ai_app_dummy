import test from "node:test";
import assert from "node:assert/strict";
import { buildClaimCompleteness } from "../src/services/claimCompleteness.js";

function baseClaim(overrides = {}) {
  return {
    patientName: "Jane Doe",
    payerName: "Aetna",
    policyNo: "POL-1",
    memberId: "MEM-1",
    diagnosisText: "Low back pain",
    icd10Codes: [],
    serviceLines: [],
    dateOfService: new Date("2026-10-01T00:00:00.000Z"),
    amount: 100,
    totalBilledAmount: 100,
    eligibilityStatus: "VERIFIED",
    priorAuthRequired: false,
    priorAuthStatus: "NOT_REQUIRED",
    documents: [],
    codingSuggestions: [],
    ...overrides
  };
}

function byField(summary, field) {
  return summary.fields.find((item) => item.field === field);
}

test("Completeness - pending ICD/CPT suggestions are review, not missing", () => {
  const summary = buildClaimCompleteness(baseClaim({
    codingSuggestions: [
      { status: "PENDING", system: "ICD10_CM", suggestedCode: "M54.50" },
      { status: "PENDING", system: "CPT", suggestedCode: "99213" }
    ]
  }));

  assert.equal(byField(summary, "icd10Codes")?.state, "review");
  assert.equal(byField(summary, "icd10Codes")?.fixTarget, "coding-review");
  assert.equal(byField(summary, "serviceLines")?.state, "review");
  assert.equal(byField(summary, "serviceLines")?.fixTarget, "coding-review");
  assert.equal(summary.reviewFields >= 2, true);
});

test("Completeness - accepted ICD and verified CPT service line become complete", () => {
  const summary = buildClaimCompleteness(baseClaim({
    icd10Codes: ["M54.50"],
    serviceLines: [
      {
        cptHcpcsCode: "99213",
        verified: true,
        diagnosisPointers: ["M54.50"]
      }
    ]
  }));

  assert.equal(byField(summary, "icd10Codes")?.state, "complete");
  assert.equal(byField(summary, "serviceLines")?.state, "complete");
});

test("Completeness - no code and no suggestion remains genuinely missing", () => {
  const summary = buildClaimCompleteness(baseClaim());

  assert.equal(byField(summary, "icd10Codes")?.state, "missing");
  assert.equal(byField(summary, "serviceLines")?.state, "missing");
});


test("Completeness - saved provider taxonomy code clears review state", () => {
  const summary = buildClaimCompleteness(baseClaim({
    providerTaxonomyCode: "207Q00000X"
  }));

  assert.equal(byField(summary, "providerTaxonomyCode")?.state, "complete");
  assert.equal(byField(summary, "providerTaxonomy") == null, true);
});
