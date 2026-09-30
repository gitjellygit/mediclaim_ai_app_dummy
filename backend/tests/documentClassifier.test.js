import test from "node:test";
import assert from "node:assert/strict";
import { classifyDocument } from "../src/services/docIntel.js";

// Include negative substrings (doctor/ct, electric/ct, panel/pan) and supported types.
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
    "pan_card.pdf",
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
