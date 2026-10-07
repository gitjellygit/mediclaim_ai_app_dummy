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

test("document identity - a real strong identifier conflict still blocks", () => {
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

  assert.equal(result.status, "MISMATCH");
  assert.ok(result.conflicts.includes("memberId"));
  assert.ok(result.matches.includes("patientName"));
  assert.ok(result.matches.includes("policyNo"));
});
