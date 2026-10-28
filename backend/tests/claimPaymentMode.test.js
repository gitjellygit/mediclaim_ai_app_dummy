import test from "node:test";
import assert from "node:assert/strict";
import { isSelfPayClaim } from "../src/services/claimPaymentMode.js";

test("self-pay detection accepts Oracle-style payer labels", () => {
  assert.equal(isSelfPayClaim({ payerName: "Self Pay" }), true);
  assert.equal(isSelfPayClaim({ payerName: "SELF-PAY" }), true);
  assert.equal(isSelfPayClaim({ payerName: "Patient Responsibility" }), true);
  assert.equal(isSelfPayClaim({ payerName: "Aetna" }), false);
});
