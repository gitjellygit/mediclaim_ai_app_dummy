import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateConfiguredRules,
  ruleExpectationPasses,
  ruleScopeMatches
} from "../src/services/configurableRuleEngine.js";
import {
  applicableRules,
  rulesetFingerprint
} from "../src/services/ruleLifecycle.js";

function rule(overrides = {}) {
  return {
    code: "RULE_TEST",
    name: "Rule test",
    category: "CLAIM",
    severity: "WARN",
    enabled: true,
    systemManaged: false,
    mandatory: false,
    scope: "ORGANIZATION",
    payerName: null,
    payerEdiId: null,
    definition: { field: "memberId", operator: "REQUIRED" },
    source: "ORGANIZATION",
    version: "1.0",
    revision: 1,
    effectiveFrom: null,
    effectiveTo: null,
    deletedAt: null,
    ...overrides
  };
}

function claim(overrides = {}) {
  return {
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    patientName: "Rules Patient",
    memberId: "MEM-1",
    payerName: "Aetna",
    payerEdiId: "60054",
    connectedPayerName: "Aetna",
    connectedPayerCode: "60054",
    dateOfService: new Date("2026-10-10T00:00:00.000Z"),
    timelyFilingDeadline: new Date("2026-12-31T00:00:00.000Z"),
    eligibilityCheckedAt: new Date("2026-10-18T12:00:00.000Z"),
    priorAuthCheckedAt: new Date("2026-10-15T00:00:00.000Z"),
    amount: 100,
    totalBilledAmount: 100,
    documents: [{ id: "d1" }],
    icd10Codes: ["M54.50"],
    serviceLines: [
      { cptHcpcsCode: "99213", units: 1, charge: 60, verified: true },
      { cptHcpcsCode: "97110", units: 2, charge: 40, verified: true }
    ],
    ...overrides
  };
}

test("string operators are deterministic and case-insensitive", () => {
  assert.equal(ruleExpectationPasses("Aetna Commercial", "STARTS_WITH", "aetna"), true);
  assert.equal(ruleExpectationPasses("Aetna Commercial", "ENDS_WITH", "commercial"), true);
  assert.equal(ruleExpectationPasses("Aetna Commercial", "CONTAINS", "etna comm"), true);
  assert.equal(ruleExpectationPasses("ABC123", "LENGTH_EQUALS", 6), true);
  assert.equal(ruleExpectationPasses("ABC123", "LENGTH_BETWEEN", "5,7"), true);
  assert.equal(ruleExpectationPasses("ABC123", "LENGTH_BETWEEN", [7, 9]), false);
});

test("date operators use UTC business-date comparison", () => {
  assert.equal(ruleExpectationPasses("2026-10-18", "BEFORE", "2026-10-19"), true);
  assert.equal(ruleExpectationPasses("2026-10-19", "ON_OR_BEFORE", "2026-10-19"), true);
  assert.equal(ruleExpectationPasses("2026-10-20", "AFTER", "2026-10-19"), true);
  assert.equal(ruleExpectationPasses("2026-10-19", "ON_OR_AFTER", "2026-10-19"), true);
});

test("payer EDI is authoritative when both EDI and name are configured", () => {
  const scoped = rule({ scope: "PAYER", payerName: "Aetna", payerEdiId: "60054" });
  assert.equal(ruleScopeMatches(scoped, claim({ payerName: "Aetna", payerEdiId: "99999" })), false);
  assert.equal(ruleScopeMatches(scoped, claim({ payerName: "Wrong Name", payerEdiId: "60054" })), true);
});

test("payer name is used only when no EDI is configured", () => {
  const scoped = rule({ scope: "PAYER", payerName: "Aetna", payerEdiId: null });
  assert.equal(ruleScopeMatches(scoped, claim({ payerName: "aetna", payerEdiId: "OTHER" })), true);
  assert.equal(ruleScopeMatches(scoped, claim({ payerName: "Cigna", payerEdiId: "60054" })), false);
});

test("derived service-line financial fields evaluate correctly", () => {
  const rules = [
    rule({ code: "LINE_COUNT", definition: { field: "serviceLineCount", operator: "EQUALS", value: 2 } }),
    rule({ code: "TOTAL_UNITS", definition: { field: "totalUnits", operator: "EQUALS", value: 3 } }),
    rule({ code: "LINE_CHARGES", definition: { field: "totalServiceLineCharges", operator: "EQUALS", value: 100 } }),
    rule({ code: "CHARGE_DIFF", definition: { field: "claimVsLineChargeDifference", operator: "EQUALS", value: 0 } })
  ];
  assert.deepEqual(evaluateConfiguredRules(claim(), rules), []);
});

test("derived age and filing fields evaluate relative to supplied now", () => {
  const now = new Date("2026-10-19T12:00:00.000Z");
  const rules = [
    rule({ code: "CLAIM_AGE", definition: { field: "claimAgeDays", operator: "EQUALS", value: 18 } }),
    rule({ code: "DOS_AGE", definition: { field: "daysSinceService", operator: "EQUALS", value: 9 } }),
    rule({ code: "ELIG_AGE", definition: { field: "eligibilityAgeHours", operator: "EQUALS", value: 24 } }),
    rule({ code: "AUTH_AGE", definition: { field: "authorizationAgeDays", operator: "EQUALS", value: 4 } })
  ];
  assert.deepEqual(evaluateConfiguredRules(claim(), rules, { now }), []);
});

test("ruleset fingerprint is stable regardless of rule query order", () => {
  const rulesA = [
    rule({ code: "B_RULE", revision: 2 }),
    rule({ code: "A_RULE", revision: 1 })
  ];
  const rulesB = [...rulesA].reverse();
  assert.equal(rulesetFingerprint(rulesA, claim()), rulesetFingerprint(rulesB, claim()));
});

test("ruleset fingerprint changes when an applicable rule revision changes", () => {
  const before = [rule({ code: "A_RULE", revision: 1 })];
  const after = [rule({ code: "A_RULE", revision: 2 })];
  assert.notEqual(rulesetFingerprint(before, claim()), rulesetFingerprint(after, claim()));
});

test("unrelated payer rule does not change another payer claim fingerprint", () => {
  const baseline = [rule({ code: "ORG_RULE" })];
  const withAetna = [
    ...baseline,
    rule({
      code: "AETNA_RULE",
      scope: "PAYER",
      payerEdiId: "60054",
      revision: 5
    })
  ];
  const cigna = claim({ payerName: "Cigna", payerEdiId: "62308", connectedPayerName: "Cigna", connectedPayerCode: "62308" });
  assert.equal(rulesetFingerprint(baseline, cigna), rulesetFingerprint(withAetna, cigna));
});

test("future effective rule enters applicable set exactly at activation boundary", () => {
  const future = rule({
    code: "FUTURE",
    effectiveFrom: new Date("2026-11-01T00:00:00.000Z")
  });
  assert.equal(applicableRules([future], claim(), new Date("2026-10-31T23:59:59.999Z")).length, 0);
  assert.equal(applicableRules([future], claim(), new Date("2026-11-01T00:00:00.000Z")).length, 1);
});

test("expiring rule remains applicable at exact end instant and drops after it", () => {
  const expiring = rule({
    code: "EXPIRING",
    effectiveTo: new Date("2026-10-31T23:59:59.999Z")
  });
  assert.equal(applicableRules([expiring], claim(), new Date("2026-10-31T23:59:59.999Z")).length, 1);
  assert.equal(applicableRules([expiring], claim(), new Date("2026-11-01T00:00:00.000Z")).length, 0);
});

test("future activation and expiration both change claim fingerprint", () => {
  const timed = rule({
    code: "TIMED",
    effectiveFrom: new Date("2026-11-01T00:00:00.000Z"),
    effectiveTo: new Date("2026-11-30T23:59:59.999Z")
  });
  const before = rulesetFingerprint([timed], claim(), new Date("2026-10-31T00:00:00.000Z"));
  const during = rulesetFingerprint([timed], claim(), new Date("2026-11-15T00:00:00.000Z"));
  const after = rulesetFingerprint([timed], claim(), new Date("2026-12-01T00:00:00.000Z"));
  assert.notEqual(before, during);
  assert.notEqual(during, after);
  assert.equal(before, after);
});

test("disabled and archived rules never enter current fingerprint", () => {
  const base = rulesetFingerprint([], claim());
  assert.equal(rulesetFingerprint([rule({ enabled: false })], claim()), base);
  assert.equal(rulesetFingerprint([rule({ deletedAt: new Date() })], claim()), base);
});

test("legacy MATCHES support is bounded and invalid patterns fail closed", () => {
  assert.equal(ruleExpectationPasses("ABC123", "MATCHES", "^ABC"), true);
  assert.equal(ruleExpectationPasses("ABC123", "MATCHES", "["), false);
  assert.equal(ruleExpectationPasses("ABC123", "MATCHES", "x".repeat(101)), false);
});
