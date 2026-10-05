import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateUsReadinessRules,
  US_READINESS_RULE_DEFAULTS
} from "../src/services/usReadinessRules.js";

function claim(overrides = {}) {
  return {
    billingProviderNpi: "1234567890",
    renderingProviderNpi: "1987654321",
    referringProviderNpi: null,
    memberId: "MEM-1001",
    icd10Codes: ["M54.50"],
    timelyFilingDeadline: new Date("2026-12-31T00:00:00.000Z"),
    priorAuthRequired: false,
    priorAuthStatus: "NOT_REQUIRED",
    authorizationNo: null,
    serviceLines: [
      {
        cptHcpcsCode: "99213",
        diagnosisPointers: ["M54.50"]
      }
    ],
    ...overrides
  };
}

function codes(issues) {
  return issues.map((issue) => issue.rule);
}

test("U7 - valid US claim produces no configurable readiness issues", () => {
  const issues = evaluateUsReadinessRules(
    claim(),
    US_READINESS_RULE_DEFAULTS,
    { now: new Date("2026-10-02T12:00:00.000Z") }
  );
  assert.deepEqual(issues, []);
});

test("U7 - NPI rule checks presence and 10-digit format", () => {
  assert.ok(codes(evaluateUsReadinessRules(
    claim({ billingProviderNpi: null }),
    US_READINESS_RULE_DEFAULTS
  )).includes("US_NPI_VALID"));

  const invalid = evaluateUsReadinessRules(
    claim({ renderingProviderNpi: "ABC" }),
    US_READINESS_RULE_DEFAULTS
  );
  assert.ok(codes(invalid).includes("US_NPI_VALID"));
});

test("U7 - CPT and diagnosis linkage rules evaluate service lines", () => {
  const noCpt = evaluateUsReadinessRules(
    claim({ serviceLines: [] }),
    US_READINESS_RULE_DEFAULTS
  );
  assert.ok(codes(noCpt).includes("US_CPT_PRESENT"));

  const unlinked = evaluateUsReadinessRules(
    claim({
      serviceLines: [{ cptHcpcsCode: "99213", diagnosisPointers: [] }]
    }),
    US_READINESS_RULE_DEFAULTS
  );
  assert.ok(codes(unlinked).includes("US_DIAGNOSIS_CPT_LINK"));

  const wrongCode = evaluateUsReadinessRules(
    claim({
      serviceLines: [{ cptHcpcsCode: "99213", diagnosisPointers: ["J18.9"] }]
    }),
    US_READINESS_RULE_DEFAULTS
  );
  assert.ok(codes(wrongCode).includes("US_DIAGNOSIS_CPT_LINK"));
});

test("U7 - timely filing rule blocks only after configured deadline", () => {
  const before = evaluateUsReadinessRules(
    claim({ timelyFilingDeadline: new Date("2026-10-03T00:00:00.000Z") }),
    US_READINESS_RULE_DEFAULTS,
    { now: new Date("2026-10-02T23:59:59.000Z") }
  );
  assert.equal(codes(before).includes("US_TIMELY_FILING"), false);

  const after = evaluateUsReadinessRules(
    claim({ timelyFilingDeadline: new Date("2026-10-01T00:00:00.000Z") }),
    US_READINESS_RULE_DEFAULTS,
    { now: new Date("2026-10-02T00:00:00.000Z") }
  );
  assert.ok(codes(after).includes("US_TIMELY_FILING"));
});

test("U7 - member ID and required prior auth are data-driven rules", () => {
  const missingMember = evaluateUsReadinessRules(
    claim({ memberId: null }),
    US_READINESS_RULE_DEFAULTS
  );
  assert.ok(codes(missingMember).includes("US_MEMBER_ID"));

  const missingAuth = evaluateUsReadinessRules(
    claim({
      priorAuthRequired: true,
      priorAuthStatus: "REQUIRED",
      authorizationNo: null
    }),
    US_READINESS_RULE_DEFAULTS
  );
  assert.ok(codes(missingAuth).includes("US_PRIOR_AUTH"));

  const approved = evaluateUsReadinessRules(
    claim({
      priorAuthRequired: true,
      priorAuthStatus: "APPROVED",
      authorizationNo: "AUTH-100"
    }),
    US_READINESS_RULE_DEFAULTS
  );
  assert.equal(codes(approved).includes("US_PRIOR_AUTH"), false);
});

test("U7 - disabled rule produces no issue and configured severity is honored", () => {
  const disabled = US_READINESS_RULE_DEFAULTS.map((rule) =>
    rule.code === "US_MEMBER_ID" ? { ...rule, enabled: false } : rule
  );
  assert.equal(
    codes(evaluateUsReadinessRules(claim({ memberId: null }), disabled))
      .includes("US_MEMBER_ID"),
    false
  );

  const warned = US_READINESS_RULE_DEFAULTS.map((rule) =>
    rule.code === "US_MEMBER_ID" ? { ...rule, severity: "WARN" } : rule
  );
  const issue = evaluateUsReadinessRules(claim({ memberId: null }), warned)
    .find((item) => item.rule === "US_MEMBER_ID");
  assert.equal(issue.severity, "WARN");
});

test("H3 - OCR-created unverified service lines do not satisfy CPT readiness", () => {
  const issues = evaluateUsReadinessRules(
    claim({
      serviceLines: [{
        cptHcpcsCode: "99213",
        diagnosisPointers: ["M54.50"],
        verified: false,
        source: "DOCUMENT_OCR",
        sourceDocumentId: "doc-ocr-1"
      }]
    }),
    US_READINESS_RULE_DEFAULTS
  );

  assert.ok(codes(issues).includes("US_CPT_PRESENT"));
});

test("H3 - user-confirmed service lines can satisfy CPT and diagnosis linkage", () => {
  const issues = evaluateUsReadinessRules(
    claim({
      serviceLines: [{
        cptHcpcsCode: "99213",
        diagnosisPointers: ["M54.50"],
        verified: true,
        source: "USER"
      }]
    }),
    US_READINESS_RULE_DEFAULTS
  );

  assert.equal(codes(issues).includes("US_CPT_PRESENT"), false);
  assert.equal(codes(issues).includes("US_DIAGNOSIS_CPT_LINK"), false);
});
