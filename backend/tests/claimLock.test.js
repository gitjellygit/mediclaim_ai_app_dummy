import test from "node:test";
import assert from "node:assert/strict";
import {
  isClaimLocked,
  isClaimSubmittedOrLater
} from "../src/services/claimLock.js";

test("P2 - submitted, denied and paid claims share one lock policy", () => {
  for (const status of ["SUBMITTED", "DENIED", "PAID"]) {
    assert.equal(isClaimLocked({ status }), true);
    assert.equal(isClaimSubmittedOrLater({ status }), true);
  }
});

test("P2 - claim submission timestamp also locks a claim", () => {
  assert.equal(
    isClaimLocked({ status: "READY", claimSubmissionDate: new Date() }),
    true
  );
});

test("P2 - draft and ready claims remain editable before submission", () => {
  assert.equal(isClaimLocked({ status: "DRAFT", claimSubmissionDate: null }), false);
  assert.equal(isClaimLocked({ status: "READY", claimSubmissionDate: null }), false);
});
