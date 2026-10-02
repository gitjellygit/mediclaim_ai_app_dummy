import { differenceMoney, validMoney } from "../utils/money.js";

const TRANSITIONS = {
  OPEN: new Set(["OPEN", "REVIEWING", "WRITTEN_OFF", "CLOSED"]),
  REVIEWING: new Set(["REVIEWING", "DISPUTE_PREPARED", "WRITTEN_OFF", "CLOSED"]),
  DISPUTE_PREPARED: new Set(["DISPUTE_PREPARED", "REVIEWING", "DISPUTE_SUBMITTED", "WRITTEN_OFF", "CLOSED"]),
  DISPUTE_SUBMITTED: new Set(["DISPUTE_SUBMITTED", "RECOVERED", "WRITTEN_OFF", "CLOSED"]),
  RECOVERED: new Set(["RECOVERED", "CLOSED"]),
  WRITTEN_OFF: new Set(["WRITTEN_OFF", "CLOSED"]),
  CLOSED: new Set(["CLOSED"])
};

export function canTransitionUnderpayment(from, to) {
  return Boolean(TRANSITIONS[from]?.has(to));
}

export function assertUnderpaymentTransition(from, to) {
  if (!canTransitionUnderpayment(from, to)) {
    const error = new Error(`Invalid underpayment case status transition: ${from} -> ${to}`);
    error.status = 409;
    error.code = "INVALID_UNDERPAYMENT_TRANSITION";
    throw error;
  }
  return to;
}

export function calculatePaymentVariance(expectedPayerPayment, actualPaidAmount) {
  const expected = validMoney(expectedPayerPayment);
  const actual = validMoney(actualPaidAmount);
  if (expected == null || actual == null) return null;

  const varianceAmount = Math.max(0, differenceMoney(expected, actual));
  return {
    expectedPayerPayment: Number(expected),
    actualPaidAmount: Number(actual),
    varianceAmount
  };
}

export function expectedPaymentFromClaim(claim) {
  const remittance = (claim?.payerTransactions || []).find(
    (tx) => tx.transactionType === "REMITTANCE"
  );
  const response = remittance?.responsePayload || {};
  const expected =
    response.expectedPayerPayment ??
    response.approvedAmount ??
    claim?.approvedAmount ??
    null;

  if (expected == null || claim?.paidAmount == null) return null;

  const variance = calculatePaymentVariance(expected, claim.paidAmount);
  if (!variance) return null;

  return {
    ...variance,
    sourceTransactionId: remittance?.transactionId || null,
    hasUnderpayment: variance.varianceAmount > 0
  };
}

export const underpaymentTransitionMatrix = TRANSITIONS;
