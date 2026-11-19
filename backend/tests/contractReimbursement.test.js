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
    patientResponsibility: 0,
    fieldProvenance: {
      patientResponsibility: {
        source: "PAYER_835",
        label: "835 ERA",
        sourceDetail: "Test remittance",
        verified: true
      }
    },
    serviceLines: [],
    ...overrides
  };
}

function approvedFeeLine(line = {}) {
  return {
    sourceDocumentId: "contract-doc-1",
    sourceDocument: {
      id: "contract-doc-1",
      fileName: "blue-2026-schedule.pdf",
      documentType: "SCHEDULE"
    },
    sourcePage: 4,
    sourceClause: "Fee Schedule",
    extractionMethod: "MANUAL",
    reviewStatus: "APPROVED",
    reviewedByUserId: "reviewer-1",
    reviewedAt: "2026-01-15T00:00:00.000Z",
    ...line
  };
}

function contract(overrides = {}) {
  const merged = {
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
  return {
    ...merged,
    feeScheduleLines: (merged.feeScheduleLines || []).map(approvedFeeLine)
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


test("contract selection does not name-match when explicit payer EDI IDs conflict", () => {
  const selected = selectApplicableContract(claim({
    payerName: "Blue Health",
    payerEdiId: "12345"
  }), [
    contract({
      id: "wrong-edi-same-name",
      payerName: "Blue Health",
      payerEdiId: "99999"
    })
  ]);

  assert.equal(selected, null);
});

test("contract calculation rejects an explicit zero-unit service line", () => {
  const result = calculateContractExpectedPayment(
    claim({
      serviceLines: [{
        id: "zero-units",
        cptHcpcsCode: "99215",
        modifiers: [],
        placeOfService: "11",
        units: 0,
        verified: true
      }]
    }),
    contract({
      feeScheduleLines: [
        { id: "fee", cptHcpcsCode: "99215", modifier: null, placeOfService: null, unitRate: "100.00" }
      ]
    })
  );

  assert.equal(result.available, false);
  assert.equal(result.reason, "INCOMPLETE_FEE_SCHEDULE");
  assert.equal(result.unmatchedLines[0].reason, "INVALID_RATE_OR_UNITS");
});


test("#031 - contract allowance subtracts verified patient share before payer variance", () => {
  const priced = calculateContractExpectedPayment(
    claim({
      patientResponsibility: 30,
      paidAmount: 120,
      fieldProvenance: {
        patientResponsibility: {
          source: "PAYER_835",
          label: "835 ERA",
          sourceDetail: "Posted remittance",
          verified: true
        }
      },
      serviceLines: [{
        id: "line-031",
        cptHcpcsCode: "99215",
        modifiers: [],
        placeOfService: "11",
        units: 1,
        verified: true
      }]
    }),
    contract({
      feeScheduleLines: [
        { id: "fee-031", cptHcpcsCode: "99215", modifier: null, placeOfService: null, unitRate: "150.00" }
      ]
    })
  );

  assert.equal(priced.available, true);
  assert.equal(priced.contractualAllowedAmount, 150);
  assert.equal(priced.patientResponsibility, 30);
  assert.equal(priced.expectedPayerPayment, 120);
  assert.deepEqual(priced.components.contractualAllowedAmount, {
    amount: 150,
    source: "CONTRACT_FEE_SCHEDULE",
    contractId: "contract-1",
    contractVersion: "2026.1"
  });
  assert.equal(priced.components.patientResponsibility.source, "PAYER_835");
  assert.equal(priced.components.patientResponsibility.amount, 30);
  assert.equal(priced.components.expectedPayerPayment.amount, 120);
});

test("#031 - contract pricing refuses to infer zero patient share without verified evidence", () => {
  const priced = calculateContractExpectedPayment(
    claim({
      patientResponsibility: null,
      fieldProvenance: {},
      serviceLines: [{
        id: "line-unverified-share",
        cptHcpcsCode: "99215",
        modifiers: [],
        placeOfService: "11",
        units: 1,
        verified: true
      }]
    }),
    contract({
      feeScheduleLines: [
        { id: "fee-unverified-share", cptHcpcsCode: "99215", unitRate: "150.00" }
      ]
    })
  );

  assert.equal(priced.available, false);
  assert.equal(priced.reason, "PATIENT_RESPONSIBILITY_NOT_VERIFIED");
  assert.equal(priced.contractualAllowedAmount, 150);
  assert.equal(priced.components.expectedPayerPayment.amount, null);
});


test("#034 - unapproved extracted contract term cannot price a claim", () => {
  const result = calculateContractExpectedPayment(
    claim({
      serviceLines: [{
        id: "line-unapproved",
        cptHcpcsCode: "99215",
        modifiers: [],
        placeOfService: "11",
        units: 1,
        verified: true
      }]
    }),
    contract({
      feeScheduleLines: [{
        id: "pending-term",
        cptHcpcsCode: "99215",
        unitRate: "150.00",
        sourceDocumentId: "doc-pending",
        sourceDocument: {
          id: "doc-pending",
          fileName: "payer-amendment.pdf",
          documentType: "AMENDMENT"
        },
        sourcePage: 7,
        sourceClause: "Section 4.2",
        extractionMethod: "OCR",
        reviewStatus: "PENDING",
        reviewedByUserId: null,
        reviewedAt: null
      }]
    })
  );

  assert.equal(result.available, false);
  assert.equal(result.reason, "CONTRACT_TERM_REVIEW_REQUIRED");
  assert.equal(result.unmatchedLines[0].reason, "CONTRACT_TERM_NOT_APPROVED");
});

test("#034 - approved term carries page/clause and reviewer provenance into pricing snapshot", () => {
  const result = calculateContractExpectedPayment(
    claim({
      serviceLines: [{
        id: "line-approved",
        cptHcpcsCode: "99215",
        modifiers: [],
        placeOfService: "11",
        units: 1,
        verified: true
      }]
    }),
    contract({
      feeScheduleLines: [{
        id: "approved-term",
        cptHcpcsCode: "99215",
        unitRate: "150.00",
        sourceDocumentId: "doc-approved",
        sourceDocument: {
          id: "doc-approved",
          fileName: "payer-amendment.pdf",
          documentType: "AMENDMENT"
        },
        sourcePage: 7,
        sourceClause: "Section 4.2",
        extractionMethod: "AI_EXTRACTED",
        reviewStatus: "APPROVED",
        reviewedByUserId: "human-reviewer",
        reviewedAt: "2026-11-01T00:00:00.000Z"
      }]
    })
  );

  assert.equal(result.available, true);
  assert.equal(result.calculatedLines[0].termProvenance.sourceDocumentName, "payer-amendment.pdf");
  assert.equal(result.calculatedLines[0].termProvenance.sourceDocumentType, "AMENDMENT");
  assert.equal(result.calculatedLines[0].termProvenance.sourcePage, 7);
  assert.equal(result.calculatedLines[0].termProvenance.sourceClause, "Section 4.2");
  assert.equal(result.calculatedLines[0].termProvenance.reviewStatus, "APPROVED");
  assert.equal(result.calculatedLines[0].termProvenance.reviewedByUserId, "human-reviewer");
});
