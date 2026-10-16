import test from "node:test";
import assert from "node:assert/strict";
import { evaluateConfiguredRules } from "../src/services/configurableRuleEngine.js";

function rule(overrides = {}) {
  return {
    code: "R_TEST",
    name: "Test rule",
    description: null,
    category: "CLAIM",
    severity: "WARN",
    enabled: true,
    systemManaged: false,
    scope: "ORGANIZATION",
    payerName: null,
    payerEdiId: null,
    definition: { field: "memberId", operator: "REQUIRED" },
    version: "1.0",
    effectiveFrom: null,
    effectiveTo: null,
    ...overrides
  };
}

function claim(overrides = {}) {
  return {
    patientName: "Jane Doe",
    patientDob: new Date("1980-01-01T00:00:00.000Z"),
    memberId: "MEM-1",
    policyNo: "POL-1",
    groupNumber: "GRP-1",
    subscriberId: "SUB-1",
    subscriberRelationship: "SELF",
    eligibilityStatus: "VERIFIED",
    billingProviderNpi: "1234567890",
    renderingProviderNpi: "1987654321",
    providerTin: "123456789",
    providerTaxonomyCode: "207Q00000X",
    claimForm: "PROFESSIONAL",
    claimFilingCode: "CI",
    claimFrequencyCode: "ORIGINAL",
    payerName: "Aetna",
    payerEdiId: "60054",
    dateOfService: new Date("2026-10-01T00:00:00.000Z"),
    timelyFilingDeadline: new Date("2026-12-31T00:00:00.000Z"),
    typeOfBill: null,
    icd10Codes: ["M54.50"],
    documents: [{ id: "d1" }, { id: "d2" }],
    serviceLines: [
      { cptHcpcsCode: "99213", verified: true },
      { cptHcpcsCode: "97110", verified: false }
    ],
    amount: 100,
    totalBilledAmount: 100,
    priorAuthRequired: false,
    priorAuthStatus: "NOT_REQUIRED",
    authorizationNo: null,
    ...overrides
  };
}

function issueCodes(result) {
  return result.map((item) => item.rule);
}

test("patient/coverage rule blocks when member ID is absent", () => {
  const result = evaluateConfiguredRules(
    claim({ memberId: null }),
    [rule({ code: "PAT_MEMBER", category: "PATIENT_COVERAGE", severity: "BLOCK" })]
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, "BLOCK");
  assert.equal(result[0].fixTarget, "claim");
});

test("provider rule can be conditional on professional claim form", () => {
  const providerRule = rule({
    code: "PRO_RENDERING",
    category: "PROVIDER",
    definition: {
      field: "renderingProviderNpi",
      operator: "REQUIRED",
      appliesWhen: {
        field: "claimForm",
        operator: "EQUALS",
        value: "PROFESSIONAL"
      }
    }
  });

  assert.deepEqual(
    issueCodes(evaluateConfiguredRules(
      claim({ claimForm: "PROFESSIONAL", renderingProviderNpi: null }),
      [providerRule]
    )),
    ["PRO_RENDERING"]
  );
  assert.equal(
    evaluateConfiguredRules(
      claim({ claimForm: "INSTITUTIONAL", renderingProviderNpi: null }),
      [providerRule]
    ).length,
    0
  );
});

test("payer-name scoped rule does not leak to another payer", () => {
  const payerRule = rule({
    code: "AETNA_GROUP",
    scope: "PAYER",
    payerName: "Aetna",
    category: "PAYER",
    definition: { field: "groupNumber", operator: "REQUIRED" }
  });

  assert.equal(
    evaluateConfiguredRules(claim({ payerName: "Aetna", groupNumber: null }), [payerRule]).length,
    1
  );
  assert.equal(
    evaluateConfiguredRules(claim({ payerName: "Cigna", groupNumber: null }), [payerRule]).length,
    0
  );
});

test("payer EDI scope matches even when payer display name differs", () => {
  const payerRule = rule({
    code: "EDI_GROUP",
    scope: "PAYER",
    payerEdiId: "60054",
    category: "PAYER",
    definition: { field: "groupNumber", operator: "REQUIRED" }
  });

  assert.equal(
    evaluateConfiguredRules(
      claim({ payerName: "Aetna Commercial", payerEdiId: "60054", groupNumber: null }),
      [payerRule]
    ).length,
    1
  );
});

test("financial minimum rule supports numeric comparison", () => {
  const minRule = rule({
    code: "MIN_AMOUNT",
    category: "FINANCIAL",
    definition: { field: "amount", operator: "GREATER_OR_EQUAL", value: 50 }
  });

  assert.equal(evaluateConfiguredRules(claim({ amount: 49.99 }), [minRule]).length, 1);
  assert.equal(evaluateConfiguredRules(claim({ amount: 50 }), [minRule]).length, 0);
});

test("financial maximum rule supports numeric comparison", () => {
  const maxRule = rule({
    code: "MAX_AMOUNT",
    category: "FINANCIAL",
    definition: { field: "amount", operator: "LESS_OR_EQUAL", value: 25000 }
  });

  assert.equal(evaluateConfiguredRules(claim({ amount: 25000.01 }), [maxRule]).length, 1);
  assert.equal(evaluateConfiguredRules(claim({ amount: 25000 }), [maxRule]).length, 0);
});

test("documentation rule uses derived document count", () => {
  const docRule = rule({
    code: "DOC_MIN_2",
    category: "DOCUMENTATION",
    definition: { field: "documentCount", operator: "GREATER_OR_EQUAL", value: 2 }
  });

  assert.equal(evaluateConfiguredRules(claim({ documents: [{ id: "d1" }] }), [docRule]).length, 1);
  assert.equal(evaluateConfiguredRules(claim(), [docRule]).length, 0);
});

test("coding rule counts verified service lines only", () => {
  const lineRule = rule({
    code: "VERIFIED_LINE",
    category: "CODING",
    definition: { field: "verifiedServiceLineCount", operator: "GREATER_OR_EQUAL", value: 2 }
  });

  assert.equal(evaluateConfiguredRules(claim(), [lineRule]).length, 1);
  assert.equal(
    evaluateConfiguredRules(
      claim({
        serviceLines: [
          { cptHcpcsCode: "99213", verified: true },
          { cptHcpcsCode: "97110", verified: true }
        ]
      }),
      [lineRule]
    ).length,
    0
  );
});

test("coding rule uses diagnosis count derived from structured ICD codes", () => {
  const diagnosisRule = rule({
    code: "DX_MAX_12",
    category: "CODING",
    definition: { field: "diagnosisCount", operator: "LESS_OR_EQUAL", value: 12 }
  });

  assert.equal(
    evaluateConfiguredRules(claim({ icd10Codes: Array.from({ length: 13 }, (_, i) => "Z" + i) }), [diagnosisRule]).length,
    1
  );
});

test("authorization rule can require authorization number only when auth is required", () => {
  const authRule = rule({
    code: "AUTH_NUMBER",
    category: "AUTHORIZATION",
    severity: "BLOCK",
    definition: {
      field: "authorizationNo",
      operator: "REQUIRED",
      appliesWhen: {
        field: "priorAuthRequired",
        operator: "EQUALS",
        value: true
      }
    }
  });

  assert.equal(
    evaluateConfiguredRules(
      claim({ priorAuthRequired: true, authorizationNo: null }),
      [authRule]
    ).length,
    1
  );
  assert.equal(
    evaluateConfiguredRules(
      claim({ priorAuthRequired: false, authorizationNo: null }),
      [authRule]
    ).length,
    0
  );
});

test("allowed-value rule accepts comma-delimited configured values case-insensitively", () => {
  const formRule = rule({
    code: "FORM_ALLOWED",
    definition: {
      field: "claimForm",
      operator: "IN",
      value: "PROFESSIONAL,INSTITUTIONAL"
    }
  });

  assert.equal(evaluateConfiguredRules(claim({ claimForm: "professional" }), [formRule]).length, 0);
  assert.equal(evaluateConfiguredRules(claim({ claimForm: "DENTAL" }), [formRule]).length, 1);
});

test("NOT_IN rule rejects configured disallowed value", () => {
  const filingRule = rule({
    code: "FILING_DISALLOW",
    definition: {
      field: "claimFilingCode",
      operator: "NOT_IN",
      value: ["ZZ", "XX"]
    }
  });

  assert.equal(evaluateConfiguredRules(claim({ claimFilingCode: "ZZ" }), [filingRule]).length, 1);
  assert.equal(evaluateConfiguredRules(claim({ claimFilingCode: "CI" }), [filingRule]).length, 0);
});

test("regex rule fails closed on invalid configured pattern", () => {
  const regexRule = rule({
    code: "NPI_PATTERN",
    definition: {
      field: "billingProviderNpi",
      operator: "MATCHES",
      value: "["
    }
  });

  assert.equal(evaluateConfiguredRules(claim(), [regexRule]).length, 1);
});

test("disabled custom rule never contributes an issue", () => {
  const disabled = rule({
    code: "DISABLED",
    enabled: false,
    definition: { field: "memberId", operator: "REQUIRED" }
  });
  assert.equal(evaluateConfiguredRules(claim({ memberId: null }), [disabled]).length, 0);
});

test("system-managed row is ignored by generic custom evaluator", () => {
  const system = rule({
    code: "SYSTEM_ROW",
    systemManaged: true,
    definition: { field: "memberId", operator: "REQUIRED" }
  });
  assert.equal(evaluateConfiguredRules(claim({ memberId: null }), [system]).length, 0);
});

test("future rule does not apply before effective date", () => {
  const future = rule({
    code: "FUTURE",
    effectiveFrom: new Date("2026-11-01T00:00:00.000Z")
  });
  assert.equal(
    evaluateConfiguredRules(
      claim({ memberId: null }),
      [future],
      { now: new Date("2026-10-16T00:00:00.000Z") }
    ).length,
    0
  );
});

test("expired rule does not apply after effective-to date", () => {
  const expired = rule({
    code: "EXPIRED",
    effectiveTo: new Date("2026-10-01T00:00:00.000Z")
  });
  assert.equal(
    evaluateConfiguredRules(
      claim({ memberId: null }),
      [expired],
      { now: new Date("2026-10-16T00:00:00.000Z") }
    ).length,
    0
  );
});

test("rule is active inside its effective window", () => {
  const active = rule({
    code: "ACTIVE_WINDOW",
    effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
    effectiveTo: new Date("2026-10-31T23:59:59.999Z")
  });
  assert.equal(
    evaluateConfiguredRules(
      claim({ memberId: null }),
      [active],
      { now: new Date("2026-10-16T00:00:00.000Z") }
    ).length,
    1
  );
});

test("custom failure description becomes the readiness message", () => {
  const described = rule({
    code: "MESSAGE",
    description: "Payer requires group number for this plan.",
    definition: { field: "groupNumber", operator: "REQUIRED" }
  });
  const [issue] = evaluateConfiguredRules(claim({ groupNumber: null }), [described]);
  assert.equal(issue.message, "Payer requires group number for this plan.");
});

test("multiple rule failures are returned independently without short-circuiting", () => {
  const rules = [
    rule({ code: "R_MEMBER", definition: { field: "memberId", operator: "REQUIRED" } }),
    rule({ code: "R_GROUP", definition: { field: "groupNumber", operator: "REQUIRED" } }),
    rule({ code: "R_TAX", definition: { field: "providerTaxonomyCode", operator: "REQUIRED" } })
  ];
  const result = evaluateConfiguredRules(
    claim({ memberId: null, groupNumber: null, providerTaxonomyCode: null }),
    rules
  );
  assert.deepEqual(issueCodes(result).sort(), ["R_GROUP", "R_MEMBER", "R_TAX"]);
});
