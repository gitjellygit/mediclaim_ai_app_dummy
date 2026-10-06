import test from "node:test";
import assert from "node:assert/strict";
import { classifyDocument, extractFields } from "../src/services/docIntel.js";

// Include negative substrings and U.S.-oriented supported document types.
const fixtures = [
  [
    "doctor_notes.pdf",
    "",
    "OTHER"
  ],
  [
    "electric_meter.pdf",
    "",
    "OTHER"
  ],
  [
    "panel_layout.pdf",
    "",
    "OTHER"
  ],
  [
    "billing_policy.pdf",
    "",
    "OTHER"
  ],
  [
    "reports_archive.pdf",
    "",
    "OTHER"
  ],
  [
    "rxn_notes.pdf",
    "",
    "OTHER"
  ],
  [
    "ctscan_image.pdf",
    "",
    "OTHER"
  ],
  [
    "pancake_receipt.pdf",
    "",
    "OTHER"
  ],
  [
    "labyrinth_plan.pdf",
    "",
    "OTHER"
  ],
  [
    "preauthorizationist.txt",
    "",
    "OTHER"
  ],
  [
    "discharge_summary.pdf",
    "",
    "DISCHARGE_SUMMARY"
  ],
  [
    "breakup_bill.pdf",
    "",
    "BREAKUP_BILL"
  ],
  [
    "final_bill.pdf",
    "",
    "FINAL_BILL"
  ],
  [
    "lab_report.pdf",
    "",
    "LAB_REPORT"
  ],
  [
    "ct_scan.pdf",
    "",
    "RADIOLOGY"
  ],
  [
    "rx_order.pdf",
    "",
    "PRESCRIPTION"
  ],
  [
    "state_id.pdf",
    "",
    "ID_PROOF"
  ],
  [
    "insurance_card.pdf",
    "",
    "INSURANCE_CARD"
  ],
  [
    "prior_auth.pdf",
    "",
    "PRIOR_AUTHORIZATION"
  ],
  [
    "operative_note.pdf",
    "",
    "OPERATIVE_NOTE"
  ],
  [
    "daily_progress_note.pdf",
    "",
    "PROGRESS_NOTE"
  ],
  [
    "eob.pdf",
    "",
    "EOB"
  ],
  [
    "document.pdf",
    "Pathology sample type blood",
    "LAB_REPORT"
  ],
  [
    "document.pdf",
    "An explanation of benefits",
    "EOB"
  ]
];

test("B11 - classification recognizes intended terms without substring false positives", () => {
  for (const [fileName, text, expected] of fixtures) {
    const actual = classifyDocument({ fileName, text }).suggestedType;
    assert.equal(actual, expected, `${fileName} [${text}] should be ${expected}`);
  }
  assert.ok(fixtures.length >= 20);
});


test("B11 - insurance document extraction captures claim identity fields", () => {
  const extracted = extractFields(`
Patient Name: Olivia Parker
Date of Birth: 04/18/1978
Insurance Company: Cedar Health Plan
Member ID: CF-OP-4411
Policy Number: POL-OP-77420
Group Number: GRP-2026-77
Subscriber ID: SUB-OP-4411
Subscriber Name: Olivia Parker
Payer EDI ID: 60054
Medical Record Number: MRN-OP-2026
Patient Phone: +1 303-555-0188
Claim Number: CLM-OP-2026-10067
`);

  assert.equal(extracted.patientName, "Olivia Parker");
  assert.equal(extracted.payerName, "Cedar Health Plan");
  assert.equal(extracted.memberId, "CF-OP-4411");
  assert.equal(extracted.policyNo, "POL-OP-77420");
  assert.equal(extracted.groupNumber, "GRP-2026-77");
  assert.equal(extracted.subscriberId, "SUB-OP-4411");
  assert.equal(extracted.subscriberName, "Olivia Parker");
  assert.equal(extracted.payerEdiId, "60054");
  assert.equal(extracted.medicalRecordNumber, "MRN-OP-2026");
  assert.match(extracted.patientMobile, /303-555-0188/);
  assert.equal(extracted.claimNo, "CLM-OP-2026-10067");
});
