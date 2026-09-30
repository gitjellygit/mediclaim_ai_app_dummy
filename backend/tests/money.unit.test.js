import test from "node:test";
import assert from "node:assert/strict";
import {
  moneyCents,
  moneyFromCents,
  validMoney,
  numberMoney,
  differenceMoney,
  percentageMoney
} from "../src/utils/money.js";
import {
  getMockPayer,
  listMockPayers,
  simulateRemittance,
  calculateAdjudication
} from "../src/services/payerSimulator.js";

test("money parser round-trips cents without float arithmetic", () => {
  for (const [input, expected] of [
    ["0", "0.00"], ["0.01", "0.01"], ["1.2", "1.20"],
    ["1234.56", "1234.56"], ["999999999999.99", "999999999999.99"]
  ]) {
    assert.equal(moneyFromCents(moneyCents(input)), expected);
  }
  assert.equal(numberMoney("1234.56"), 1234.56);
  assert.equal(differenceMoney("1234.56", "1000.01"), 234.55);
  assert.equal(percentageMoney("1.01", 5000), 0.51);
});

test("money validation rejects negatives, extra cents, scientific notation and overflow", () => {
  for (const value of ["-1", "1.001", "1e5", "Infinity", "NaN", "1000000000000.00"]) {
    assert.equal(validMoney(value), null, value);
  }
  assert.equal(validMoney("0"), "0.00");
});

test("payer financial output conserves cents for all payer, amount and coinsurance combinations", () => {
  let cases = 0;
  for (const { code } of listMockPayers()) {
    const payer = getMockPayer(code);
    for (const amount of ["0.01", "0.05", "1.01", "1234.56", "98765.43"]) {
      for (const coinsurancePct of [0, 10, 15, 20, 30, 100]) {
        const claim = { id: String(cases), amount, coinsurancePct };
        const approval = calculateAdjudication(payer, claim);
        const era = simulateRemittance(payer, claim);
        assert.equal(
          moneyCents(era.allowedAmount),
          moneyCents(era.paidAmount) +
            moneyCents(era.patientResponsibility) +
            moneyCents(era.potentialUnderpayment)
        );
        assert.equal(approval.approvedAmount, era.expectedPayerPayment);
        cases += 1;
      }
    }
  }
  assert.equal(cases, 150);
});
