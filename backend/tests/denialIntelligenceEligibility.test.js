import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDenial } from "../src/services/denialIntelligence.js";

function baseClaim(overrides = {}) {
  return {
    amount: 500,
    paidAmount: 0,
    allowedAmount: null,
    priorAuthRequired: false,
    priorAuthStatus: "NOT_REQUIRED",
    eligibilityStatus: "VERIFIED",
    icd10Codes: ["Z00.00"],
    documents: [{ type: "FINAL_BILL", verified: true }],
    claimType: "PROVIDER_BILLED",
    ...overrides
  };
}

test("eligibility denial does not claim pre-submission eligibility was missing when it was verified", async () => {
  const analysis = await analyzeDenial(
    baseClaim({ eligibilityStatus: "VERIFIED" }),
    {
      denialCategory: "ELIGIBILITY",
      carcCode: "27",
      rarcCode: "N130"
    }
  );

  assert.match(analysis.explanation, /Eligibility was verified in PRISM before claim submission/);
  assert.doesNotMatch(analysis.explanation, /Eligibility is not verified for this claim/);
  assert.match(analysis.recommendedAction, /compare the result with the eligibility response used before submission/i);
  assert.equal(analysis.confidence, 90);
});

test("eligibility denial separates payer evidence from the current unverified claim state", async () => {
  const analysis = await analyzeDenial(
    baseClaim({ eligibilityStatus: "NOT_CHECKED" }),
    {
      denialCategory: "ELIGIBILITY",
      carcCode: "27",
      rarcCode: "N130"
    }
  );

  assert.match(analysis.explanation, /payer denial indicates an eligibility or coverage issue/i);
  assert.match(analysis.explanation, /current claim record is not verified/i);
  assert.match(analysis.recommendedAction, /appeal or a corrected claim/i);
});
