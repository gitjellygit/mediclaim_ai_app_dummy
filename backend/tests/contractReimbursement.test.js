import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateContractExpectedPayment,
  selectApplicableContract
} from "../src/services/contractReimbursement.js";

function claim(overrides = {}) {
  return {
    claimForm: "PROFESSIONAL",
    payerName: "Blue Health",
    payerEdiId: "12345",
    dateOfService: "2026-10-10",
    serviceLines: [],
    ...overrides
  };
}

function contract(overrides = {}) {
  return {
    id: "contract-1",
    name: "Blue 2026 PPO",
    version: "2026.1",
    status: "ACTIVE",
    payerName: "Blue Health",
    payerEdiId: "12345",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    feeScheduleLines: [],
    ...overrides
  };
}

test("contract selection prefers payer EDI match and effective date", () => {
  const selected = selectApplicableContract(claim(), [
    contract({ id: "wrong", payerEdiId: "99999", payerName: "Blue Health", effectiveFrom: "2026-09-01" }),
    contract({ id: "edi", payerEdiId: "12345", payerName: "Other", effectiveFrom: "2026-01-01" })
  ]);
  assert.equal(selected.id, "edi");
});

test("contract calculation multiplies units and prefers modifier/POS-specific rate", () => {
  const result = calculateContractExpectedPayment(
    claim({
      serviceLines: [{
        id: "line-1",
        cptHcpcsCode: "99215",
        modifiers: ["25"],
        placeOfService: "11",
        units: 2,
        verified: true
      }]
    }),
    contract({
      feeScheduleLines: [
        { id: "generic", cptHcpcsCode: "99215", modifier: null, placeOfService: null, unitRate: "100.00" },
        { id: "modifier", cptHcpcsCode: "99215", modifier: "25", placeOfService: null, unitRate: "125.00" },
        { id: "specific", cptHcpcsCode: "99215", modifier: "25", placeOfService: "11", unitRate: "150.00" }
      ]
    })
  );

  assert.equal(result.available, true);
  assert.equal(result.expectedPayerPayment, 300);
  assert.equal(result.calculatedLines[0].feeScheduleLineId, "specific");
  assert.equal(result.calculatedLines[0].expectedAmount, 300);
});

test("contract calculation fails closed when any verified service line is unmatched", () => {
  const result = calculateContractExpectedPayment(
    claim({
      serviceLines: [
        { id: "one", cptHcpcsCode: "99215", modifiers: [], placeOfService: "11", units: 1, verified: true },
        { id: "two", cptHcpcsCode: "93000", modifiers: [], placeOfService: "11", units: 1, verified: true }
      ]
    }),
    contract({
      feeScheduleLines: [
        { id: "fee-one", cptHcpcsCode: "99215", modifier: null, placeOfService: null, unitRate: "100.00" }
      ]
    })
  );

  assert.equal(result.available, false);
  assert.equal(result.reason, "INCOMPLETE_FEE_SCHEDULE");
  assert.equal(result.unmatchedLines.length, 1);
  assert.equal(result.unmatchedLines[0].cptHcpcsCode, "93000");
});

test("institutional contract reimbursement fails closed rather than guessing", () => {
  const result = calculateContractExpectedPayment(
    claim({ claimForm: "INSTITUTIONAL", serviceLines: [{ id: "x", cptHcpcsCode: "99215", units: 1, verified: true }] }),
    contract({ feeScheduleLines: [{ id: "fee", cptHcpcsCode: "99215", unitRate: "100.00" }] })
  );
  assert.equal(result.available, false);
  assert.equal(result.reason, "INSTITUTIONAL_CONTRACT_CALCULATION_NOT_SUPPORTED");
});
