import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateConfiguredRules,
  ruleExpectationPasses
} from "../src/services/configurableRuleEngine.js";

function customRule(overrides = {}) {
  return {
    code: "CUSTOM_TEST",
    name: "Custom test",
    description: null,
    category: "CLAIM",
    severity: "WARN",
    enabled: true,
    systemManaged: false,
    scope: "ORGANIZATION",
    payerName: null,
    payerEdiId: null,
    definition: {
      field: "memberId",
      operator: "REQUIRED"
    },
    version: "1.0",
    effectiveFrom: null,
    effectiveTo: null,
    ...overrides
  };
}

function claim(overrides = {}) {
  return {
    memberId: "M-1",
    payerName: "Aetna",
    payerEdiId: "60054",
    claimForm: "PROFESSIONAL",
    amount: 125,
    icd10Codes: ["M54.50"],
    documents: [{ id: "doc-1" }],
    serviceLines: [{ cptHcpcsCode: "99213", verified: true }],
    ...overrides
  };
}

test("custom REQUIRED rule creates readiness issue only when expectation fails", () => {
  assert.equal(evaluateConfiguredRules(claim(), [customRule()]).length, 0);

  const issues = evaluateConfiguredRules(
    claim({ memberId: null }),
    [customRule()]
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, "CUSTOM_TEST");
  assert.equal(issues[0].source, "ADMIN_RULE");
  assert.equal(issues[0].field, "memberId");
});

test("payer rule only applies to the configured payer", () => {
  const rule = customRule({
    scope: "PAYER",
    payerName: "Aetna",
    definition: {
      field: "providerTaxonomyCode",
      operator: "REQUIRED"
    }
  });

  assert.equal(
    evaluateConfiguredRules(claim({ payerName: "Cigna", providerTaxonomyCode: null }), [rule]).length,
    0
  );
  assert.equal(
    evaluateConfiguredRules(claim({ payerName: "Aetna", providerTaxonomyCode: null }), [rule]).length,
    1
  );
});

test("appliesWhen condition limits a custom rule to the intended claim context", () => {
  const rule = customRule({
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

  assert.equal(
    evaluateConfiguredRules(
      claim({ claimForm: "INSTITUTIONAL", renderingProviderNpi: null }),
      [rule]
    ).length,
    0
  );
  assert.equal(
    evaluateConfiguredRules(
      claim({ claimForm: "PROFESSIONAL", renderingProviderNpi: null }),
      [rule]
    ).length,
    1
  );
});

test("effective dates prevent inactive versions from affecting readiness", () => {
  const now = new Date("2026-10-16T12:00:00.000Z");
  const future = customRule({
    effectiveFrom: new Date("2026-11-01T00:00:00.000Z")
  });
  const expired = customRule({
    effectiveTo: new Date("2026-10-01T00:00:00.000Z")
  });

  assert.equal(
    evaluateConfiguredRules(claim({ memberId: null }), [future, expired], { now }).length,
    0
  );
});

test("derived count fields and numeric operators are deterministic", () => {
  const docRule = customRule({
    code: "DOC_COUNT",
    category: "DOCUMENTATION",
    definition: {
      field: "documentCount",
      operator: "GREATER_OR_EQUAL",
      value: 2
    }
  });
  const lineRule = customRule({
    code: "LINE_COUNT",
    category: "CODING",
    definition: {
      field: "verifiedServiceLineCount",
      operator: "LESS_OR_EQUAL",
      value: 1
    }
  });

  const issues = evaluateConfiguredRules(claim(), [docRule, lineRule]);
  assert.deepEqual(issues.map((item) => item.rule), ["DOC_COUNT"]);
});

test("safe expectation operator helpers support configured lists and regex", () => {
  assert.equal(ruleExpectationPasses("A", "IN", "A,B,C"), true);
  assert.equal(ruleExpectationPasses("D", "NOT_IN", ["A", "B"]), true);
  assert.equal(ruleExpectationPasses("1234567890", "MATCHES", "^\\d{10}$"), true);
  assert.equal(ruleExpectationPasses(5, "GREATER_THAN", 3), true);
});
