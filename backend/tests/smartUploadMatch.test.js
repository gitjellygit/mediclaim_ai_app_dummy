import test from "node:test";
import assert from "node:assert/strict";
import { selectSmartUploadMatch } from "../src/services/smartUploadMatch.js";

const extracted = { patientName: "Alice Johnson", memberId: "MEM-100", policyNo: "POL-200" };
const matching = { id: "claim-1", patientName: "Alice Johnson", memberId: "MEM-100", policyNo: "POL-200" };
const score = (_extracted, claim) => claim.score ?? 100;

test("B14 - a conflicting member identifier blocks automatic merging even with matching policy", () => {
  const conflicting = { ...matching, memberId: "MEM-OTHER", score: 100 };
  const selection = selectSmartUploadMatch(extracted, [conflicting], score);
  assert.equal(selection.matchStatus, "NEW");
  assert.equal(selection.claim, null);
  assert.equal(selection.candidateClaim, null);
});

test("B14 - DOB or policy conflict blocks merging despite high matching member score", () => {
  const document = { ...extracted, dateOfBirth: "1990-01-01" };
  const claim = { ...matching, patientDob: new Date("1991-01-01T00:00:00Z"), score: 100 };
  assert.equal(selectSmartUploadMatch(document, [claim], score).matchStatus, "NEW");
});

test("B14 - one verified, conflict-free candidate can merge", () => {
  const selection = selectSmartUploadMatch(extracted, [matching], score);
  assert.equal(selection.matchStatus, "MERGED");
  assert.equal(selection.claim.id, matching.id);
});

test("B14 - multiple verified matches require review without exposing an arbitrary candidate", () => {
  const selection = selectSmartUploadMatch(extracted,
    [matching, { ...matching, id: "claim-2" }], score);
  assert.equal(selection.matchStatus, "REVIEW");
  assert.equal(selection.claim, null);
  assert.equal(selection.candidateClaim, null);
});

test("B14 - name-only matches can be reviewed but not automatically merged", () => {
  const noIdentifiers = { patientName: "Alice Johnson" };
  const selection = selectSmartUploadMatch(noIdentifiers,
    [{ id: "claim-3", patientName: "Alice Johnson" }], score);
  assert.equal(selection.matchStatus, "REVIEW");
  assert.equal(selection.claim, null);
  assert.equal(selection.candidateClaim.id, "claim-3");
});

test("B14 - unknown-identity documents cannot be merged on contextual score", () => {
  const selection = selectSmartUploadMatch({ patientName: "Unknown Patient" }, [matching], score);
  assert.equal(selection.matchStatus, "NEW");
  assert.equal(selection.claim, null);
});
