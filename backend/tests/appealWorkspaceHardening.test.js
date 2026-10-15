import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Appeal evidence upload is isolated from normal claim editing", () => {
  const route = read("backend/src/routes/denials.js");

  assert.match(route, /"\/:id\/appeal-evidence"/);
  assert.match(route, /requirePermission\(PERMISSIONS\.RECOVERY_EDIT\)/);
  assert.match(route, /requirePermission\(PERMISSIONS\.DOCUMENT_EDIT\)/);
  assert.match(route, /appealCaseId:\s*existing\.id/);
  assert.match(route, /appealEvidenceDocumentIds:\s*\{\s*push:\s*document\.id/);
  assert.match(route, /APPEAL_EVIDENCE_UPLOADED/);
  assert.match(route, /DOCUMENT_PATIENT_MISMATCH/);
});

test("Appeal submission requires confirmation plus structured external submission metadata", () => {
  const route = read("backend/src/routes/denials.js");

  assert.match(route, /req\.body\.confirmed !== true/);
  assert.match(route, /APPEAL_SUBMISSION_CHANNELS/);
  assert.match(route, /submissionChannel/);
  assert.match(route, /submissionDate/);
  assert.match(route, /appealSubmissionChannel:\s*channel/);
  assert.match(route, /appealExternalSubmittedAt:\s*externalSubmittedAt/);
  assert.match(route, /externalTransmissionPerformed:\s*false/);
});

test("Appeal schema tracks uploaded evidence owner and submission metadata", () => {
  const schema = read("backend/prisma/schema.prisma");

  assert.match(schema, /appealCaseId\s+String\?/);
  assert.match(schema, /appealUploadedDocuments\s+Document\[\]/);
  assert.match(schema, /appealSubmissionChannel\s+String\?/);
  assert.match(schema, /appealExternalSubmittedAt\s+DateTime\?/);
});

test("Appeal workspace UI requires confirmations for major state changes", () => {
  const ui = read("frontend/src/modules/recovery/AppealWorkspace.jsx");

  assert.match(ui, /title: "Prepare appeal\?"/);
  assert.match(ui, /title: "Confirm assessment override"/);
  assert.match(ui, /title: "Confirm appeal submission"/);
  assert.match(ui, /Upload Supporting Evidence/);
  assert.match(ui, /Preview Appeal Package/);
  assert.match(ui, /View document/);
  assert.match(ui, /Download document/);
});


test("Material recovery and remittance updates require confirmation", () => {
  const denialUi = read("frontend/src/modules/denials/DenialIntelligence.jsx");
  const underpaymentUi = read("frontend/src/modules/payments/UnderpaymentIntelligence.jsx");
  const journeyUi = read("frontend/src/modules/journey/ClaimJourney.jsx");

  assert.match(denialUi, /title: "Confirm denial case update"/);
  assert.match(underpaymentUi, /title: "Confirm recovery update"/);
  assert.match(journeyUi, /title: "Confirm remittance posting"/);
});


test("Appeal rationale has an explicit minimum and must be saved before preparation", () => {
  const route = read("backend/src/routes/denials.js");
  const ui = read("frontend/src/modules/recovery/AppealWorkspace.jsx");

  assert.match(route, /APPEAL_RATIONALE_MIN_CHARS = 50/);
  assert.match(route, /rationale\.length > 0 && rationale\.length < APPEAL_RATIONALE_MIN_CHARS/);
  assert.match(route, /savedRationale\.length < APPEAL_RATIONALE_MIN_CHARS/);

  assert.match(ui, /APPEAL_RATIONALE_MIN_CHARS = 50/);
  assert.match(ui, /Save Rationale/);
  assert.match(ui, /Clear appeal rationale\?/);
  assert.match(ui, /Rationale ready — save required/);
  assert.match(ui, /Rationale complete/);
  assert.match(ui, /load\(\{ preserveDraft: true \}\)/);
  assert.match(ui, /!draftSaved/);
});
