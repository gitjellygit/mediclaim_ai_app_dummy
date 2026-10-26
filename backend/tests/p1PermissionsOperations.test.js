import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { permissionsForRole, PERMISSIONS } from "../src/security/permissions.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("cashier no longer has destructive or clinical workflow permissions", () => {
  const permissions = permissionsForRole("CASHIER");
  for (const permission of [
    PERMISSIONS.CLAIM_DELETE,
    PERMISSIONS.CLAIM_EDIT,
    PERMISSIONS.CLINICAL_EDIT,
    PERMISSIONS.PAYER_ACTION,
    PERMISSIONS.CLAIM_SUBMIT,
    PERMISSIONS.DENIAL_EDIT,
    PERMISSIONS.RECOVERY_EDIT
  ]) {
    assert.equal(permissions.has(permission), false, permission);
  }
  assert.equal(permissions.has(PERMISSIONS.FINANCIAL_EDIT), true);
});

test("claims manager has document delete permission", () => {
  assert.equal(
    permissionsForRole("CLAIMS_MANAGER").has(PERMISSIONS.DOCUMENT_DELETE),
    true
  );
});

const docs = read("backend/src/routes/documents.js");
const claims = read("backend/src/routes/claims.js");
const operations = read("backend/src/routes/operations.js");
const detail = read("frontend/src/modules/ai-claims/ClaimDetail.jsx");
const assignment = read("frontend/src/components/ClaimAssignmentDialog.jsx");
const collaboration = read("frontend/src/modules/operations/ClaimCollaboration.jsx");
const operationsUi = read("frontend/src/modules/operations/Operations.jsx");

test("document mutations use document-specific permissions", () => {
  assert.match(docs, /PERMISSIONS\.DOCUMENT_DELETE/);
  assert.match(docs, /PERMISSIONS\.DOCUMENT_EDIT/);
  assert.match(claims, /documents\/:id"[\s\S]*PERMISSIONS\.DOCUMENT_DELETE/);
});

test("claim detail editing follows claim edit permission instead of requiring clinical edit too", () => {
  assert.match(detail, /const canEditClaim = hasPermission\(user, PERMISSIONS\.CLAIM_EDIT\)/);
});

test("claim delete copy accurately describes soft removal", () => {
  assert.match(detail, /remove the claim from active views/);
  assert.doesNotMatch(detail, /permanently delete the claim and its associated documents/);
});

test("duplicate top ownership action is removed", () => {
  const topArea = detail.slice(detail.indexOf("justifyContent=\"space-between\""), detail.indexOf("claim.status === \"SUBMITTING\""));
  assert.doesNotMatch(topArea, /Assign Owner|Reassign Owner/);
});

test("work-management assignees are active and role scoped", () => {
  assert.match(claims, /CLAIM_ASSIGNABLE_ROLES/);
  assert.match(claims, /status: "ACTIVE"/);
  assert.match(claims, /role: \{ in: CLAIM_ASSIGNABLE_ROLES \}/);
});

test("work-management validates active team and future dates", () => {
  assert.match(claims, /INVALID_WORK_TEAM/);
  assert.match(claims, /PAST_WORK_DATE/);
  assert.match(operations, /Work team must match an active team/);
  assert.match(operations, /cannot be in the past/);
});

test("bulk assignment defaults to no change instead of unassigning", () => {
  assert.match(assignment, /__NO_CHANGE__/);
  assert.match(assignment, /No assignment change/);
  assert.match(assignment, /No team change/);
});

test("assignment uses a real team selector", () => {
  assert.match(assignment, /OperationsApi\.teams/);
  assert.match(assignment, /<InputLabel>Work Team<\/InputLabel>/);
});

test("clinical requests require clinical-role assignees and future due dates", () => {
  assert.match(operations, /CLINICAL_ASSIGNEE_ROLES/);
  assert.match(operations, /Provider or Clinical Reviewer/);
  assert.match(operations, /due date cannot be in the past/);
  assert.doesNotMatch(collaboration, /"CLINICAL_REVIEWER","PROVIDER","ADMIN"/);
});

test("financial approvals require positive amount and cap it at claim amount", () => {
  assert.match(operations, /Amount is required for write-off and large-adjustment approvals/);
  assert.match(operations, /Approval amount cannot exceed the claim amount/);
  assert.match(collaboration, /Amount \*/);
});

test("duplicate pending approvals are rejected", () => {
  assert.match(operations, /matching approval request is already pending/);
});

test("recovery approvals require an active recovery workflow", () => {
  assert.match(operations, /There is no active recovery case to close/);
  assert.match(operations, /There is no active denial appeal to abandon/);
});

test("approval creation notifies managers and writes critical audit", () => {
  assert.match(operations, /APPROVAL_REQUEST_CREATED/);
  assert.match(operations, /Manager approval requested/);
});

test("approved financial and recovery operations are executed", () => {
  assert.match(operations, /deductionAmount: nextDeduction/);
  assert.match(operations, /denialCase\.updateMany/);
  assert.match(operations, /underpaymentCase\.updateMany/);
  assert.match(operations, /decision_and_execute/);
});

test("reject and return decisions require reasons", () => {
  assert.match(operations, /A decision reason is required when rejecting or returning/);
  assert.match(operationsUi, /Reason for rejection/);
  assert.match(operationsUi, /Reason for return/);
});

test("saved queue filters are validated and shared team is captured immutably", () => {
  assert.match(operations, /const filtersSchema = z\.object/);
  assert.match(operations, /_sharedTeamId/);
  assert.match(operations, /Join a team before sharing a saved queue/);
});

test("unread notification count is computed across all notifications", () => {
  assert.match(operations, /prisma\.notification\.count/);
  assert.match(operations, /readAt: null/);
});
