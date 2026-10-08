import test from "node:test";
import assert from "node:assert/strict";
import { classifyDocument, extractFields } from "../src/services/docIntel.js";
import {
  buildFieldCandidates,
  documentAllowsField,
  safeInitialClaimSeed,
  summarizeExtractionQuality
} from "../src/services/extractionEngineV2.js";
import { evaluateExtractionFixtures } from "../src/services/extractionEvaluation.js";

test("Extraction v2 - document-type allowlist prevents coverage money from becoming claim amount", () => {
  assert.equal(documentAllowsField("INSURANCE_CARD", "coverageLimit"), true);
  assert.equal(documentAllowsField("INSURANCE_CARD", "amount"), false);
  assert.equal(documentAllowsField("FINAL_BILL", "amount"), true);

  const candidates = buildFieldCandidates({
    claimId: "claim-1",
    documentId: "doc-1",
    documentType: "INSURANCE_CARD",
    extracted: {
      patientName: "Avery Morgan",
      memberId: "AM-884210",
      coverageLimit: 250000,
      amount: 250000
    },
    intel: {
      ocrProvider: "PDF_PARSE",
      extractionConfidence: 99
    },
    rawText: "Coverage Limit: $250,000.00"
  });

  const amount = candidates.find((item) => item.fieldName === "amount");
  const coverage = candidates.find((item) => item.fieldName === "coverageLimit");
  assert.equal(amount.decision, "ABSTAINED");
  assert.equal(amount.validationStatus, "FORBIDDEN_SOURCE");
  assert.equal(coverage.validationStatus, "VALID");
});

test("Extraction v2 - critical identifiers abstain from silent single-source autofill", () => {
  const extracted = extractFields(`
Insurance Card
Patient Name: Avery Morgan
Date of Birth: 02/14/1986
Member ID: AM-884210
Policy Number: POL-AM-77101
Insurance Company: Cedar Health Plan
Payer EDI ID: 60054
`);

  const seed = safeInitialClaimSeed({
    documentType: "INSURANCE_CARD",
    extracted,
    intel: {
      ocrProvider: "PDF_PARSE",
      extractionConfidence: 99
    },
    rawText: ""
  });

  assert.equal(seed.patientName, "Avery Morgan");
  assert.equal(seed.payerName, "Cedar Health Plan");
  assert.equal(seed.payerEdiId, "60054");
  assert.equal(seed.memberId, undefined);
  assert.equal(seed.policyNo, undefined);
  assert.equal(seed.patientDob, undefined);
});

test("Extraction v2 - structured key/value evidence overrides ambiguous raw text safely", () => {
  const extracted = extractFields(
    `
Insurance Card
Member Identification
Patient Name: Avery Morgan
`,
    {
      keyValues: [
        {
          key: "Member ID",
          value: "AM-884210",
          confidence: 99,
          pageNumber: 1,
          boundingBox: { Left: 0.1, Top: 0.2, Width: 0.2, Height: 0.03 }
        }
      ]
    }
  );

  assert.equal(extracted.memberId, "AM-884210");
  assert.equal(extracted._fieldEvidence.memberId.confidence, 99);
  assert.equal(extracted._fieldEvidence.memberId.pageNumber, 1);
});

test("Extraction v2 - provider and institutional fields extract deterministically", () => {
  const extracted = extractFields(`
Progress Note
Patient Name: Avery Morgan
Billing Provider NPI: 1999999984
Rendering Provider NPI: 1234567893
Referring Provider NPI: 1999999984
Provider TIN: 84-1234567
Provider Taxonomy Code: 207Q00000X
Type of Bill: 111
DRG Code: 343
Plan Administrator Name: Cedar Benefit Administration
Coverage Limit: $250,000.00
Remaining Coverage Limit: $238,500.00
`);

  assert.equal(extracted.billingProviderNpi, "1999999984");
  assert.equal(extracted.renderingProviderNpi, "1234567893");
  assert.equal(extracted.referringProviderNpi, "1999999984");
  assert.equal(extracted.providerTin, "84-1234567");
  assert.equal(extracted.providerTaxonomyCode, "207Q00000X");
  assert.equal(extracted.typeOfBill, "111");
  assert.equal(extracted.drgCode, "343");
  assert.equal(extracted.planAdministratorName, "Cedar Benefit Administration");
  assert.equal(extracted.coverageLimit, 250000);
  assert.equal(extracted.remainingCoverageLimit, 238500);
});

test("Extraction v2 - synthetic golden set has perfect observed extraction precision", () => {
  const fixtures = [
    {
      id: "insurance",
      fileName: "Avery_insurance_card.pdf",
      text: `
Insurance Card
Patient Name: Avery Morgan
Date of Birth: 02/14/1986
Insurance Company: Cedar Health Plan
Member ID: AM-884210
Policy Number: POL-AM-77101
Group Number: GRP-2026-77
Subscriber ID: AM-884210
Subscriber Name: Avery Morgan
Payer EDI ID: 60054
Coverage Limit: $250,000.00
`,
      expected: {
        patientName: "Avery Morgan",
        dateOfBirth: "1986-02-14",
        payerName: "Cedar Health Plan",
        memberId: "AM-884210",
        policyNo: "POL-AM-77101",
        groupNumber: "GRP-2026-77",
        subscriberId: "AM-884210",
        subscriberName: "Avery Morgan",
        payerEdiId: "60054",
        coverageLimit: 250000
      }
    },
    {
      id: "bill",
      fileName: "Avery_final_bill.pdf",
      text: `
Final Bill
Patient Name: Avery Morgan
Member ID: AM-884210
Policy Number: POL-AM-77101
Claim Number: CLM-AM-2026-1001
Grand Total: $12,480.00
Hospital Name: Riverside Medical Center
`,
      expected: {
        patientName: "Avery Morgan",
        memberId: "AM-884210",
        policyNo: "POL-AM-77101",
        claimNo: "CLM-AM-2026-1001",
        amount: 12480,
        hospitalName: "Riverside Medical Center"
      }
    },
    {
      id: "clinical",
      fileName: "Avery_progress_note.pdf",
      text: `
Progress Note
Patient Name: Avery Morgan
Hospital Name: Riverside Medical Center
Doctor Name: Jordan Lee
Date of Service: 10/05/2026
Diagnosis: Acute appendicitis
ICD-10: K35.80
CPT: 44970
Billing Provider NPI: 1999999984
Provider TIN: 84-1234567
`,
      expected: {
        patientName: "Avery Morgan",
        hospitalName: "Riverside Medical Center",
        doctorName: "Jordan Lee",
        dateOfService: "2026-10-05",
        diagnosisText: "Acute appendicitis",
        icd10Codes: ["K35.80"],
        cptCodes: ["44970"],
        billingProviderNpi: "1999999984",
        providerTin: "84-1234567"
      }
    }
  ];

  const result = evaluateExtractionFixtures(fixtures);
  assert.equal(result.wrong, 0);
  assert.equal(result.missing, 0);
  assert.equal(result.precision, 1);
  assert.equal(result.recall, 1);
  assert.equal(result.autoFillPrecision, 1);
});

test("Extraction v2 - quality summary separates automation, confirmation, and abstention", () => {
  const summary = summarizeExtractionQuality([
    { decision: "AUTO_FILLED" },
    { decision: "SUPPORTED" },
    { decision: "CONFIRM" },
    { decision: "ABSTAINED" }
  ]);

  assert.deepEqual(summary, {
    total: 4,
    autoFilled: 1,
    confirmationRequired: 1,
    abstained: 1,
    supported: 1,
    safeAutomationRate: 50
  });
});

test("Extraction v2 - progress note classification remains stable with procedure wording", () => {
  const classified = classifyDocument({
    fileName: "03_Avery_Morgan_progress_note.pdf",
    text: "Progress Note\nProcedure Performed: Laparoscopic appendectomy"
  });
  assert.equal(classified.suggestedType, "PROGRESS_NOTE");
});
