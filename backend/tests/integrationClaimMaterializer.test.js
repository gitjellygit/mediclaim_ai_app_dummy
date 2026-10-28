import test from "node:test";
import assert from "node:assert/strict";
import {
  canMaterializeCanonicalClaim,
  claimPatchFromCanonical
} from "../src/services/integrationClaimMaterializer.js";

test("integration materializer allows incomplete draft before payer completion", () => {
  const data = {
    patientName: "BILLING DEMO PATIENT",
    amount: 100,
    totalBilledAmount: 100
  };
  assert.equal(canMaterializeCanonicalClaim(data), true);
  const patch = claimPatchFromCanonical(data);
  assert.equal(patch.patientName, "BILLING DEMO PATIENT");
  assert.equal(patch.amount, 100);
  assert.equal(patch.payerName, undefined);
});

test("integration materializer still requires patient and positive amount", () => {
  assert.equal(canMaterializeCanonicalClaim({ patientName: "Patient" }), false);
  assert.equal(canMaterializeCanonicalClaim({ amount: 100 }), false);
  assert.equal(canMaterializeCanonicalClaim({ patientName: "Patient", amount: 0 }), false);
});
