import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { classifyDocument } from "../src/services/docIntel.js";
import {
  resolveStoredDocument,
  safeDownloadName
} from "../src/services/storedDocumentPath.js";

const good = [
  ["discharge_summary.pdf", "DISCHARGE_SUMMARY"],
  ["final_bill.pdf", "FINAL_BILL"],
  ["itemized_bill.pdf", "BREAKUP_BILL"],
  ["invoice.pdf", "FINAL_BILL"],
  ["lab_report.pdf", "LAB_REPORT"],
  ["CT_chest.pdf", "RADIOLOGY"],
  ["MRI lumbar.pdf", "RADIOLOGY"],
  ["prescription.pdf", "PRESCRIPTION"],
  ["RX.pdf", "PRESCRIPTION"],
  ["insurance_card.pdf", "INSURANCE_CARD"],
  ["prior_auth.pdf", "PRIOR_AUTHORIZATION"],
  ["operative_note.pdf", "OPERATIVE_NOTE"],
  ["progress_note.pdf", "PROGRESS_NOTE"],
  ["eob.pdf", "EOB"]
];

test("document classifier recognizes named document fixtures", () => {
  for (const [fileName, expected] of good) {
    assert.equal(classifyDocument({ fileName, text: "" }).suggestedType, expected, fileName);
  }
});

test("document classifier avoids unsafe word-substring false positives", () => {
  for (const fileName of [
    "doctor_notes.pdf", "electric_panel.pdf", "panelling.pdf",
    "billionaire.pdf", "reporting_tool.pdf", "context.pdf"
  ]) {
    assert.equal(classifyDocument({ fileName, text: "" }).suggestedType, "OTHER", fileName);
  }
});

test("document storage resolver keeps old and new paths inside upload root", () => {
  const root = path.resolve("/tmp/claim-app-upload-tests");
  assert.equal(resolveStoredDocument("uploads/a.pdf", root), path.join(root, "a.pdf"));
  assert.equal(resolveStoredDocument("a.pdf", root), path.join(root, "a.pdf"));
  assert.equal(resolveStoredDocument("../../secrets.pdf", root), path.join(root, "secrets.pdf"));
  assert.equal(resolveStoredDocument("", root), null);
  assert.ok(!safeDownloadName("../../evil.pdf").includes("/"));
  assert.ok(!safeDownloadName("line\r\nHeader: leaked.pdf").includes("\n"));
});
