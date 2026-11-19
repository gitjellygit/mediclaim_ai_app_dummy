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


function approvedPercentageContract(overrides = {}) {
  return contract({
    pricingMethod: "PERCENT_MEDICARE",
    referencePercent: 125,
    roundingMode: "HALF_UP",
    pricingSourceDocumentId: "pricing-doc-1",
    pricingSourcePage: 12,
    pricingSourceClause: "Section 5.3",
    pricingExtractionMethod: "AI_EXTRACTED",
    pricingReviewStatus: "APPROVED",
    pricingReviewedByUserId: "contract-reviewer",
    pricingReviewedAt: "2026-01-15T00:00:00.000Z",
    feeScheduleLines: [],
    ...overrides
  });
}

test("#036 - percentage-of-Medicare uses exact schedule year locality percentage and HALF_UP cents", () => {
  const result = calculateContractExpectedPayment(
    claim({
      dateOfService: "2026-10-10",
      patientResponsibility: 10,
      serviceLines: [{
        id: "medicare-line",
        cptHcpcsCode: "99215",
        modifiers: [],
        placeOfService: "11",
        units: 1,
        charge: 200,
        verified: true
      }]
    }),
    approvedPercentageContract({
      medicareRateScheduleId: "medicare-2026-locality-01",
      medicareRateSchedule: {
        id: "medicare-2026-locality-01",
        name: "2026 Test Medicare",
        year: 2026,
        locality: "LOCALITY-01",
        source: "Synthetic CMS fixture",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        lines: [{
          id: "mcr-99215",
          cptHcpcsCode: "99215",
          modifier: null,
          placeOfService: "11",
          amount: "80.03"
        }]
      }
    })
  );

  assert.equal(result.available, true);
  assert.equal(result.source, "CONTRACT_PERCENT_MEDICARE");
  assert.equal(result.contractualAllowedAmount, 100.04);
  assert.equal(result.patientResponsibility, 10);
  assert.equal(result.expectedPayerPayment, 90.04);
  assert.equal(result.calculatedLines[0].medicareScheduleYear, 2026);
  assert.equal(result.calculatedLines[0].medicareLocality, "LOCALITY-01");
  assert.equal(result.calculatedLines[0].referencePercent, 125);
  assert.equal(result.calculatedLines[0].expectedAmount, 100.04);
  assert.equal(result.pricingEvidence.roundingMode, "HALF_UP");
});

test("#036 - Medicare pricing fails closed on schedule year mismatch", () => {
  const result = calculateContractExpectedPayment(
    claim({
      dateOfService: "2026-10-10",
      serviceLines: [{
        id: "wrong-year",
        cptHcpcsCode: "99215",
        placeOfService: "11",
        units: 1,
        verified: true
      }]
    }),
    approvedPercentageContract({
      medicareRateSchedule: {
        id: "medicare-2025-locality-01",
        name: "2025 Test Medicare",
        year: 2025,
        locality: "LOCALITY-01",
        source: "Synthetic CMS fixture",
        effectiveFrom: "2025-01-01",
        effectiveTo: "2026-12-31",
        lines: [{
          id: "mcr-2025",
          cptHcpcsCode: "99215",
          placeOfService: "11",
          amount: "80.03"
        }]
      }
    })
  );

  assert.equal(result.available, false);
  assert.equal(result.reason, "MEDICARE_SCHEDULE_YEAR_MISMATCH");
  assert.equal(result.scheduleYear, 2025);
  assert.equal(result.serviceYear, 2026);
});

test("#036 - percentage-of-charge prices billed line charge with explicit cent rounding", () => {
  const result = calculateContractExpectedPayment(
    claim({
      patientResponsibility: 8.76,
      serviceLines: [{
        id: "charge-line",
        cptHcpcsCode: "99215",
        units: 1,
        charge: "123.45",
        verified: true
      }]
    }),
    approvedPercentageContract({
      pricingMethod: "PERCENT_CHARGE",
      referencePercent: 80,
      medicareRateScheduleId: null,
      medicareRateSchedule: null
    })
  );

  assert.equal(result.available, true);
  assert.equal(result.source, "CONTRACT_PERCENT_CHARGE");
  assert.equal(result.contractualAllowedAmount, 98.76);
  assert.equal(result.expectedPayerPayment, 90);
  assert.equal(result.calculatedLines[0].billedCharge, 123.45);
  assert.equal(result.calculatedLines[0].referencePercent, 80);
});

test("#036 - unapproved percentage term cannot price a claim", () => {
  const result = calculateContractExpectedPayment(
    claim({
      serviceLines: [{
        id: "unapproved-percent",
        cptHcpcsCode: "99215",
        units: 1,
        charge: 100,
        verified: true
      }]
    }),
    approvedPercentageContract({
      pricingMethod: "PERCENT_CHARGE",
      referencePercent: 80,
      pricingReviewStatus: "PENDING",
      pricingReviewedByUserId: null,
      pricingReviewedAt: null
    })
  );

  assert.equal(result.available, false);
  assert.equal(result.reason, "CONTRACT_PRICING_REVIEW_REQUIRED");
});

test("#036 - Medicare pricing explicitly reports missing schedule", () => {
  const result = calculateContractExpectedPayment(
    claim({
      serviceLines: [{
        id: "missing-schedule",
        cptHcpcsCode: "99215",
        units: 1,
        verified: true
      }]
    }),
    approvedPercentageContract({
      medicareRateScheduleId: "missing",
      medicareRateSchedule: null
    })
  );

  assert.equal(result.available, false);
  assert.equal(result.reason, "MEDICARE_SCHEDULE_MISSING");
});


function approvedProvision(provisionType, parameters, overrides = {}) {
  return {
    id: `prov-${provisionType.toLowerCase()}`,
    provisionType,
    parameters,
    priority: 100,
    status: "ACTIVE",
    sourceDocumentId: "prov-doc",
    sourceDocument: {
      id: "prov-doc",
      fileName: "payer-contract.pdf",
      documentType: "CONTRACT"
    },
    sourcePage: 15,
    sourceClause: "Section 7",
    extractionMethod: "MANUAL",
    reviewStatus: "APPROVED",
    reviewedByUserId: "contract-reviewer",
    reviewedAt: "2026-11-01T00:00:00.000Z",
    ...overrides
  };
}

test("#037 - modifier percentage provision adjusts only matching modifier line", () => {
  const result = calculateContractExpectedPayment(
    claim({
      serviceLines: [{
        id: "mod-line",
        cptHcpcsCode: "99215",
        modifiers: ["25"],
        placeOfService: "11",
        units: 1,
        charge: 200,
        verified: true
      }]
    }),
    contract({
      feeScheduleLines: [{
        id: "base-mod",
        cptHcpcsCode: "99215",
        modifier: null,
        placeOfService: null,
        unitRate: "100.00"
      }],
      provisions: [
        approvedProvision("MODIFIER_PERCENT", { modifier: "25", percent: 150 })
      ]
    })
  );

  assert.equal(result.available, true);
  assert.equal(result.contractualAllowedAmount, 150);
  assert.equal(result.expectedPayerPayment, 150);
  assert.equal(result.calculatedLines[0].baseExpectedAmount, 100);
  assert.equal(result.calculatedLines[0].expectedAmount, 150);
  assert.equal(result.calculatedLines[0].appliedProvisions[0].provisionType, "MODIFIER_PERCENT");
});

test("#037 - multiple procedure reduction preserves highest line and reduces secondary line", () => {
  const result = calculateContractExpectedPayment(
    claim({
      serviceLines: [
        { id: "mp-1", cptHcpcsCode: "99215", units: 1, charge: 120, verified: true },
        { id: "mp-2", cptHcpcsCode: "93000", units: 1, charge: 100, verified: true }
      ]
    }),
    contract({
      feeScheduleLines: [
        { id: "mp-fee-1", cptHcpcsCode: "99215", unitRate: "100.00" },
        { id: "mp-fee-2", cptHcpcsCode: "93000", unitRate: "80.00" }
      ],
      provisions: [
        approvedProvision("MULTIPLE_PROCEDURE_REDUCTION", {
          codes: ["99215", "93000"],
          secondaryPercent: 50
        })
      ]
    })
  );

  assert.equal(result.available, true);
  assert.equal(result.contractualAllowedAmount, 140);
  const line1 = result.calculatedLines.find((line) => line.cptHcpcsCode === "99215");
  const line2 = result.calculatedLines.find((line) => line.cptHcpcsCode === "93000");
  assert.equal(line1.expectedAmount, 100);
  assert.equal(line2.expectedAmount, 40);
});

test("#037 - bundle exclusion zeros bundled code when primary code is present", () => {
  const result = calculateContractExpectedPayment(
    claim({
      serviceLines: [
        { id: "bundle-primary", cptHcpcsCode: "99215", units: 1, verified: true },
        { id: "bundle-child", cptHcpcsCode: "93000", units: 1, verified: true }
      ]
    }),
    contract({
      feeScheduleLines: [
        { id: "bundle-fee-1", cptHcpcsCode: "99215", unitRate: "100.00" },
        { id: "bundle-fee-2", cptHcpcsCode: "93000", unitRate: "50.00" }
      ],
      provisions: [
        approvedProvision("BUNDLE_EXCLUSION", {
          primaryCode: "99215",
          bundledCodes: ["93000"]
        })
      ]
    })
  );

  assert.equal(result.available, true);
  assert.equal(result.contractualAllowedAmount, 100);
  assert.equal(
    result.calculatedLines.find((line) => line.cptHcpcsCode === "93000").expectedAmount,
    0
  );
});

test("#037 - lesser-of-charge caps contract rate at billed line charge", () => {
  const result = calculateContractExpectedPayment(
    claim({
      serviceLines: [{
        id: "lesser-line",
        cptHcpcsCode: "99215",
        units: 1,
        charge: "90.00",
        verified: true
      }]
    }),
    contract({
      feeScheduleLines: [
        { id: "lesser-fee", cptHcpcsCode: "99215", unitRate: "120.00" }
      ],
      provisions: [
        approvedProvision("LESSER_OF_CHARGE", { codes: ["99215"] })
      ]
    })
  );

  assert.equal(result.available, true);
  assert.equal(result.contractualAllowedAmount, 90);
  assert.equal(result.calculatedLines[0].baseExpectedAmount, 120);
  assert.equal(result.calculatedLines[0].expectedAmount, 90);
});

test("#037 - unapproved provision stops automatic pricing", () => {
  const result = calculateContractExpectedPayment(
    claim({
      serviceLines: [{
        id: "pending-prov-line",
        cptHcpcsCode: "99215",
        units: 1,
        verified: true
      }]
    }),
    contract({
      feeScheduleLines: [
        { id: "pending-prov-fee", cptHcpcsCode: "99215", unitRate: "100.00" }
      ],
      provisions: [
        approvedProvision(
          "MODIFIER_PERCENT",
          { modifier: "25", percent: 150 },
          { reviewStatus: "PENDING", reviewedByUserId: null, reviewedAt: null }
        )
      ]
    })
  );

  assert.equal(result.available, false);
  assert.equal(result.reason, "CONTRACT_PROVISION_REVIEW_REQUIRED");
});

test("#037 - unsupported reviewed clause routes pricing to review instead of flat multiplication", () => {
  const result = calculateContractExpectedPayment(
    claim({
      serviceLines: [{
        id: "unsupported-line",
        cptHcpcsCode: "99215",
        units: 1,
        verified: true
      }]
    }),
    contract({
      feeScheduleLines: [
        { id: "unsupported-fee", cptHcpcsCode: "99215", unitRate: "100.00" }
      ],
      provisions: [
        approvedProvision("UNSUPPORTED_CLAUSE", {
          clauseText: "Complex stop-loss carveout requiring manual adjudication"
        })
      ]
    })
  );

  assert.equal(result.available, false);
  assert.equal(result.reason, "UNSUPPORTED_CONTRACT_PROVISION");
  assert.equal(result.provision.provisionType, "UNSUPPORTED_CLAUSE");
});
