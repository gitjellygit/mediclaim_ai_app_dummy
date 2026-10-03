import test from "node:test";
import assert from "node:assert/strict";
import {
  assertClaimTransition,
  assertDenialTransition,
  canTransitionClaim,
  canTransitionDenial,
  claimTransitionMatrix,
  denialTransitionMatrix
} from "../src/services/workflowStateMachine.js";

const claimStates = ["DRAFT", "NEEDS_REVIEW", "READY", "SUBMITTED", "DENIED", "PAID"];
const denialStates = [
  "OPEN",
  "ANALYZED",
  "CORRECTION_REQUIRED",
  "APPEAL_PREPARED",
  "APPEAL_SUBMITTED",
  "RESUBMITTED",
  "OVERTURNED",
  "UPHELD",
  "CLOSED"
];

test("F7 - claim state machine has an explicit rule for every claim status", () => {
  assert.deepEqual(Object.keys(claimTransitionMatrix).sort(), [...claimStates].sort());
  for (const state of claimStates) {
    assert.ok(claimTransitionMatrix[state] instanceof Set);
    assert.ok(claimTransitionMatrix[state].has(state), `${state} must be idempotent`);
  }
});

test("F7 - claim submission transitions are explicit while route prerequisites enforce readiness", () => {
  assert.equal(canTransitionClaim("DRAFT", "SUBMITTED"), true);
  assert.equal(canTransitionClaim("NEEDS_REVIEW", "SUBMITTED"), true);
  assert.equal(canTransitionClaim("READY", "SUBMITTED"), true);
  assert.equal(assertClaimTransition("READY", "SUBMITTED"), "SUBMITTED");

  assert.equal(canTransitionClaim("PAID", "SUBMITTED"), false);
  assert.throws(
    () => assertClaimTransition("PAID", "SUBMITTED"),
    (error) => error.status === 409 && error.code === "INVALID_STATUS_TRANSITION"
  );
});

test("F7 - terminal claim transitions prevent reopening paid claims", () => {
  assert.equal(canTransitionClaim("SUBMITTED", "DENIED"), true);
  assert.equal(canTransitionClaim("SUBMITTED", "PAID"), true);
  assert.equal(canTransitionClaim("DENIED", "PAID"), true);
  assert.equal(canTransitionClaim("PAID", "DRAFT"), false);
  assert.equal(canTransitionClaim("PAID", "READY"), false);
  assert.equal(canTransitionClaim("PAID", "SUBMITTED"), false);
});

test("F7 - denial state machine has an explicit rule for every denial status", () => {
  assert.deepEqual(Object.keys(denialTransitionMatrix).sort(), [...denialStates].sort());
  for (const state of denialStates) {
    assert.ok(denialTransitionMatrix[state] instanceof Set);
    assert.ok(denialTransitionMatrix[state].has(state), `${state} must be idempotent`);
  }
});

test("F7 - denial workflow blocks impossible jumps and preserves appeal progression", () => {
  assert.equal(canTransitionDenial("OPEN", "APPEAL_SUBMITTED"), false);
  assert.equal(canTransitionDenial("OPEN", "ANALYZED"), true);
  assert.equal(canTransitionDenial("ANALYZED", "APPEAL_PREPARED"), true);
  assert.equal(canTransitionDenial("APPEAL_PREPARED", "APPEAL_SUBMITTED"), true);
  assert.equal(canTransitionDenial("APPEAL_SUBMITTED", "OVERTURNED"), true);
  assert.equal(canTransitionDenial("APPEAL_SUBMITTED", "UPHELD"), true);
  assert.equal(canTransitionDenial("CLOSED", "OPEN"), false);

  assert.throws(
    () => assertDenialTransition("OPEN", "APPEAL_SUBMITTED"),
    (error) => error.status === 409 && error.code === "INVALID_STATUS_TRANSITION"
  );
});
