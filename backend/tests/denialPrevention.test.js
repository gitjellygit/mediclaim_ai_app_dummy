import test from "node:test";
import assert from "node:assert/strict";
import {
  detectDenialPreventionPatterns,
  preventionRuleProposalFor
} from "../src/services/denialPrevention.js";

function fakeDb(denials) {
  return {
    denialCase: {
      findMany: async () => denials
    }
  };
}

test("recurring authorization denials create one payer-scoped deterministic recommendation", async () => {
  const denials = [1, 2, 3].map((index) => ({
    denialCategory: "AUTHORIZATION",
    carcCode: "197",
    rarcCode: null,
    revenueAtRisk: String(100 * index),
    denialDate: new Date(`2026-10-0${index}T00:00:00.000Z`),
    createdAt: new Date(),
    claim: {
      payerName: "Synthetic Health",
      payerEdiId: "SYN123"
    }
  }));

  const patterns = await detectDenialPreventionPatterns(
    fakeDb(denials),
    "org-1",
    { minimumOccurrences: 3 }
  );

  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].occurrenceCount, 3);
  assert.equal(patterns[0].revenueAtRisk, 600);
  assert.equal(patterns[0].proposedRule.enabled, false);
  assert.equal(patterns[0].proposedRule.scope, "PAYER");
  assert.equal(patterns[0].proposedRule.payerEdiId, "SYN123");
  assert.deepEqual(patterns[0].proposedRule.definition, {
    field: "authorizationNo",
    operator: "REQUIRED"
  });
});

test("pattern threshold prevents one-off denial noise from becoming recommendations", async () => {
  const patterns = await detectDenialPreventionPatterns(
    fakeDb([{
      denialCategory: "AUTHORIZATION",
      carcCode: "197",
      rarcCode: null,
      revenueAtRisk: "100",
      denialDate: new Date(),
      createdAt: new Date(),
      claim: { payerName: "Synthetic Health", payerEdiId: "SYN123" }
    }]),
    "org-1",
    { minimumOccurrences: 3 }
  );

  assert.equal(patterns.length, 0);
});

test("unsupported denial category remains review-only rather than inventing a rule", () => {
  const proposed = preventionRuleProposalFor({
    denialCategory: "MEDICAL_NECESSITY",
    payerName: "Synthetic Health",
    payerEdiId: "SYN123",
    carcCode: "50",
    rarcCode: null,
    occurrenceCount: 8,
    revenueAtRisk: 9000
  });

  assert.equal(proposed, null);
});
