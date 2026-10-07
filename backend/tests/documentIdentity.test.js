import test from "node:test";
import assert from "node:assert/strict";
import { validateDocumentIdentityAgainstClaim } from "../src/services/documentIdentity.js";

test("document identity - matching name/member is not rejected when document has no policy", () => {
  const claim = {
    patientName: "Emma Reynolds",
    memberId: "CF-ER-1001",
    policyNo: "POL-ER-77101",
    patientDob: new Date("1982-03-14T00:00:00.000Z")
  };

  const result = validateDocumentIdentityAgainstClaim(claim, {
    patientName: "Emma Reynolds",
    memberId: "CF-ER-1001",
    authorizationNo: "AUTH-ER-9001"
  });

  assert.equal(result.status, "MATCH");
  assert.deepEqual(result.conflicts, []);
  assert.ok(result.matches.includes("patientName"));
  assert.ok(result.matches.includes("memberId"));
});

test("document identity - one strong identifier conflict with matching patient evidence requires review", () => {
  const claim = {
    patientName: "Emma Reynolds",
    memberId: "CF-ER-1001",
    policyNo: "POL-ER-77101"
  };

  const result = validateDocumentIdentityAgainstClaim(claim, {
    patientName: "Emma Reynolds",
    memberId: "OTHER-999",
    policyNo: "POL-ER-77101"
  });

  assert.equal(result.status, "REVIEW");
  assert.ok(result.conflicts.includes("memberId"));
  assert.ok(result.matches.includes("patientName"));
  assert.ok(result.matches.includes("policyNo"));
});


test("document identity - OCR-confusable member ID is treated as the same identifier", () => {
  const claim = {
    patientName: "Emma Reynolds",
    memberId: "CF-ER-1001",
    policyNo: "POL-ER-77101"
  };

  const result = validateDocumentIdentityAgainstClaim(claim, {
    patientName: "Emma Reynolds",
    memberId: "CF-ER-1OO1",
    policyNo: "POL-ER-77101"
  });

  assert.equal(result.status, "MATCH");
  assert.ok(result.matches.includes("memberId"));
  assert.ok(result.tolerantMatches.includes("memberId"));
  assert.deepEqual(result.conflicts, []);
});

test("document identity - one conflicting identifier with matching patient evidence requires review but does not block", () => {
  const claim = {
    patientName: "Emma Reynolds",
    memberId: "CF-ER-1001",
    policyNo: "POL-ER-77101",
    patientDob: new Date("1982-03-14T00:00:00.000Z")
  };

  const result = validateDocumentIdentityAgainstClaim(claim, {
    patientName: "Emma Reynolds",
    memberId: "CF-ER-1007",
    policyNo: "POL-ER-77101",
    dateOfBirth: "1982-03-14"
  });

  assert.equal(result.status, "REVIEW");
  assert.deepEqual(result.conflicts, ["memberId"]);
  assert.ok(result.matches.includes("patientName"));
  assert.ok(result.matches.includes("policyNo"));
  assert.ok(result.matches.includes("patientDob"));
  assert.deepEqual(result.warnings, ["memberId"]);
});

test("document identity - two independent identifier conflicts still hard-block", () => {
  const claim = {
    patientName: "Emma Reynolds",
    memberId: "CF-ER-1001",
    policyNo: "POL-ER-77101"
  };

  const result = validateDocumentIdentityAgainstClaim(claim, {
    patientName: "Emma Reynolds",
    memberId: "OTHER-999",
    policyNo: "OTHER-POLICY"
  });

  assert.equal(result.status, "MISMATCH");
  assert.ok(result.conflicts.includes("memberId"));
  assert.ok(result.conflicts.includes("policyNo"));
});
