import test from "node:test";
import assert from "node:assert/strict";
import {
  assertUnderpaymentTransition,
  calculatePaymentVariance,
  canTransitionUnderpayment,
  expectedPaymentFromClaim
} from "../src/services/underpaymentRecovery.js";

test("payment variance excludes patient responsibility and compares payer expectation to payer cash", () => {
  assert.deepEqual(calculatePaymentVariance(80, 64), {
    expectedPayerPayment: 80,
    actualPaidAmount: 64,
    varianceAmount: 16
  });
});

test("payment variance never reports an overpayment as an underpayment", () => {
  assert.equal(calculatePaymentVariance(80, 90).varianceAmount, 0);
});

test("underpayment detection prefers remittance expected payer payment", () => {
  const result = expectedPaymentFromClaim({
    approvedAmount: 75,
    paidAmount: 64,
    payerTransactions: [{
      transactionId: "ERA-1",
      transactionType: "REMITTANCE",
      responsePayload: {
        expectedPayerPayment: 80,
        patientResponsibility: 20
      }
    }]
  });
  assert.equal(result.expectedPayerPayment, 80);
  assert.equal(result.varianceAmount, 16);
  assert.equal(result.sourceTransactionId, "ERA-1");
  assert.equal(result.hasUnderpayment, true);
});

test("underpayment lifecycle requires an explicit recovery path", () => {
  for (const [from, to] of [
    ["OPEN", "REVIEWING"],
    ["REVIEWING", "DISPUTE_PREPARED"],
    ["DISPUTE_PREPARED", "DISPUTE_SUBMITTED"],
    ["DISPUTE_SUBMITTED", "RECOVERED"],
    ["RECOVERED", "CLOSED"]
  ]) {
    assert.equal(canTransitionUnderpayment(from, to), true);
    assert.equal(assertUnderpaymentTransition(from, to), to);
  }

  assert.equal(canTransitionUnderpayment("OPEN", "RECOVERED"), false);
  assert.throws(
    () => assertUnderpaymentTransition("OPEN", "RECOVERED"),
    (error) => error.status === 409 && error.code === "INVALID_UNDERPAYMENT_TRANSITION"
  );
});
