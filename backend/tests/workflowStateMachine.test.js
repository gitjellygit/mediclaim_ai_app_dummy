import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransitionClaim,
  assertClaimTransition,
  canTransitionDenial,
  assertDenialTransition
} from "../src/services/workflowStateMachine.js";

test("F7 - claim lifecycle permits intended forward and readiness reset transitions", () => {
  for (const [from, to] of [
    ["DRAFT", "READY"],
    ["READY", "DRAFT"],
    ["DRAFT", "SUBMITTED"],
    ["READY", "SUBMITTED"],
    ["SUBMITTED", "DENIED"],
    ["SUBMITTED", "PAID"],
    ["DENIED", "PAID"],
    ["PAID", "PAID"]
  ]) {
    assert.equal(canTransitionClaim(from, to), true, `${from} -> ${to}`);
    assert.equal(assertClaimTransition(from, to), to);
  }
});

test("F7 - claim lifecycle blocks reopening terminal states implicitly", () => {
  for (const [from, to] of [
    ["SUBMITTED", "DRAFT"],
    ["DENIED", "DRAFT"],
    ["PAID", "SUBMITTED"],
    ["PAID", "DENIED"]
  ]) {
    assert.equal(canTransitionClaim(from, to), false, `${from} -> ${to}`);
    assert.throws(
      () => assertClaimTransition(from, to),
      (error) => error.status === 409 && error.code === "INVALID_STATUS_TRANSITION"
    );
  }
});

test("F7 - denial lifecycle follows explicit recovery paths", () => {
  for (const [from, to] of [
    ["OPEN", "ANALYZED"],
    ["ANALYZED", "CORRECTION_REQUIRED"],
    ["CORRECTION_REQUIRED", "APPEAL_PREPARED"],
    ["APPEAL_PREPARED", "APPEAL_SUBMITTED"],
    ["APPEAL_SUBMITTED", "OVERTURNED"],
    ["APPEAL_SUBMITTED", "UPHELD"],
    ["CORRECTION_REQUIRED", "RESUBMITTED"],
    ["RESUBMITTED", "OVERTURNED"],
    ["UPHELD", "APPEAL_PREPARED"],
    ["OVERTURNED", "CLOSED"]
  ]) {
    assert.equal(canTransitionDenial(from, to), true, `${from} -> ${to}`);
    assert.equal(assertDenialTransition(from, to), to);
  }
});

test("F7 - denial lifecycle blocks skipped or reopened terminal transitions", () => {
  for (const [from, to] of [
    ["OPEN", "APPEAL_SUBMITTED"],
    ["OPEN", "OVERTURNED"],
    ["APPEAL_PREPARED", "OVERTURNED"],
    ["OVERTURNED", "OPEN"],
    ["CLOSED", "OPEN"]
  ]) {
    assert.equal(canTransitionDenial(from, to), false, `${from} -> ${to}`);
    assert.throws(
      () => assertDenialTransition(from, to),
      (error) => error.status === 409 && error.code === "INVALID_STATUS_TRANSITION"
    );
  }
});
