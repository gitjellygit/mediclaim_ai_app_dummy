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
  assert.match(ui, /title: "Submit appeal\?"/);
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
  assert.match(ui, /2\. Build appeal package/);
  assert.match(ui, /2\. Package complete/);
  assert.match(ui, /load\(\{ preserveDraft: true \}\)/);
  assert.match(ui, /!draftSaved/);
});


test("Prepared appeal is invalidated when the saved package changes", () => {
  const route = read("backend/src/routes/denials.js");
  const ui = read("frontend/src/modules/recovery/AppealWorkspace.jsx");

  assert.match(route, /packageChanged/);
  assert.match(route, /preparationInvalidated/);
  assert.match(route, /status: preparationInvalidated \? "ANALYZED" : undefined/);
  assert.match(route, /appealPreparedAt: preparationInvalidated \? null : undefined/);

  assert.match(ui, /async function toggleEvidence/);
  assert.match(ui, /DenialsApi\.saveAppealDraft\(id/);
  assert.match(ui, /evidenceDocumentIds: next/);
  assert.match(ui, /Appeal package changed/);
  assert.match(ui, /Review Updated Package/);
  assert.match(ui, /Record Appeal Submission/);
  assert.match(ui, /Yes, Submit Appeal/);
});

test("Shared success feedback uses a centered auto-dismiss green check", () => {
  const feedback = read("frontend/src/context/ToastContext.jsx");

  assert.match(feedback, /CheckCircle color="success"/);
  assert.match(feedback, /setTimeout\(\(\) =>/);
  assert.match(feedback, /1800/);
  assert.match(feedback, /setSuccessNotice\(\{ open: true, message \}\)/);
});

test("Claim Detail submission requires explicit confirmation", () => {
  const detail = read("frontend/src/modules/ai-claims/ClaimDetail.jsx");

  assert.match(detail, /title: "Submit claim\?"/);
  assert.match(detail, /confirmLabel: "Submit Claim"/);
  assert.match(detail, /if \(!confirmed\) return/);
});


test("Appeal Workspace exposes eligibility recheck and visible backend analysis progress", () => {
  const ui = read("frontend/src/modules/recovery/AppealWorkspace.jsx");
  const intelligence = read("backend/src/services/denialIntelligence.js");

  assert.match(ui, /Re-check Eligibility/);
  assert.match(ui, /stage=eligibility/);
  assert.match(ui, /Re-checking coverage does not resubmit the claim/);
  assert.match(ui, /Re-running Recovery Analysis/);
  assert.match(ui, /This dialog reflects the active backend analysis request/);
  assert.match(ui, /Recovery Analysis Complete/);

  assert.match(intelligence, /Eligibility was verified in PRISM before claim submission/);
  assert.match(intelligence, /payer denial now indicates an eligibility or coverage issue/);
  assert.match(intelligence, /appeal or a corrected claim/);
});


test("Revenue Recovery paginates sorts and aligns recovered metrics with filters", () => {
  const route = read("backend/src/routes/revenueRecovery.js");
  const ui = read("frontend/src/modules/recovery/RevenueRecovery.jsx");
  const appeal = read("frontend/src/modules/recovery/AppealWorkspace.jsx");

  assert.match(route, /req\.query\.pageSize/);
  assert.match(route, /const sort = String\(req\.query\.sort/);
  assert.match(route, /metrics: summarize\(filteredItems\)/);
  assert.match(route, /items: items\.slice\(offset, offset \+ pageSize\)/);

  assert.match(ui, /TablePagination/);
  assert.match(ui, /rowsPerPageOptions=\{\[10\]\}/);
  assert.match(ui, /TableSortLabel/);
  assert.match(ui, /sortableHeader\("Outstanding", "outstanding"\)/);
  assert.match(ui, /sortableHeader\("Recovered", "recovered"\)/);
  assert.match(ui, /sortableHeader\("Deadline", "deadline"\)/);
  assert.match(ui, /Across all cases matching the current filters/);
  assert.match(ui, /data-testid="recovery-next-action"/);
  assert.doesNotMatch(ui, />Work Case</);

  assert.match(appeal, /data-testid="recovery-achievement"/);
  assert.match(appeal, /Recovery achieved/);
  assert.match(appeal, /Partial recovery/);
  assert.match(appeal, /Why this denial likely occurred/);
  assert.match(appeal, /severity="error" variant="outlined"/);
  assert.match(appeal, /Recommended next action/);
  assert.match(appeal, /severity="warning" variant="outlined"/);
});
