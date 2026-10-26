import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { humanizeEnum, roleLabel } from "../../frontend/src/utils/displayLabels.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("humanizeEnum converts internal enum values to user-facing labels", () => {
  assert.equal(humanizeEnum("NEEDS_REVIEW"), "Needs Review");
  assert.equal(humanizeEnum("APPEAL_SUBMITTED"), "Appeal Submitted");
  assert.equal(humanizeEnum("NOT_REQUIRED"), "Not Required");
});

test("roleLabel humanizes role enums", () => {
  assert.equal(roleLabel("CLAIMS_SPECIALIST"), "Claims Specialist");
  assert.equal(roleLabel("CLINICAL_REVIEWER"), "Clinical Reviewer");
});

const summary = read("frontend/src/modules/ai-claims/claim-detail/ClaimSummaryCard.jsx");
const claims = read("frontend/src/modules/ai-claims/ClaimsList.jsx");
const recovery = read("frontend/src/modules/recovery/RevenueRecovery.jsx");
const medical = read("frontend/src/modules/medical-ai/MedicalConsistency.jsx");
const operations = read("frontend/src/modules/operations/Operations.jsx");
const collaboration = read("frontend/src/modules/operations/ClaimCollaboration.jsx");
const audit = read("frontend/src/modules/audit/AuditTrail.jsx");
const assignment = read("frontend/src/components/ClaimAssignmentDialog.jsx");

test("claim summary no longer exposes raw status enums", () => {
  assert.match(summary, /humanizeEnum\(claim\.status/);
  assert.doesNotMatch(summary, /<Chip label=\{claim\.status\}/);
});

test("claim list no longer exposes raw status enums", () => {
  assert.match(claims, /humanizeEnum\(claim\.status/);
});

test("missing hospital data is not fabricated as generic Hospital", () => {
  assert.match(summary, /claim\.hospitalName \|\| "Not provided"/);
});

test("revenue recovery humanizes workflow and cause labels", () => {
  assert.match(recovery, /humanizeEnum\(item\.status/);
  assert.match(recovery, /humanizeEnum\(item\.rootCause/);
  assert.match(recovery, /humanizeEnum\(cause\.label/);
});

test("medical consistency uses shared display formatter", () => {
  assert.match(medical, /return humanizeEnum\(value\)/);
});

test("operations and collaboration humanize clinical statuses", () => {
  assert.match(operations, /humanizeEnum\(item\.status\)/);
  assert.match(collaboration, /humanizeEnum\(item\.status\)/);
});

test("audit trail humanizes roles and outcomes", () => {
  assert.match(audit, /roleLabel\(item\.actor\.role\)/);
  assert.match(audit, /humanizeEnum\(item\.outcome\)/);
});

test("assignment dialog humanizes role names", () => {
  assert.match(assignment, /roleLabel\(person\.role\)/);
});
