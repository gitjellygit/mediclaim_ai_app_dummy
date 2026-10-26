import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { permissionsForRole, PERMISSIONS } from "../src/security/permissions.js";
import { buildApprovalIntelligenceItem } from "../src/services/approvalIntelligence.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("production role templates expose least-privilege operations access", () => {
  const provider = permissionsForRole("PROVIDER");
  assert.equal(provider.has(PERMISSIONS.OPERATIONS_VIEW), true);
  assert.equal(provider.has(PERMISSIONS.CLINICAL_VIEW), true);
  assert.equal(provider.has(PERMISSIONS.CLAIM_VIEW), false);

  const manager = permissionsForRole("CLAIMS_MANAGER");
  assert.equal(manager.has(PERMISSIONS.CLAIM_EDIT), true);
  assert.equal(manager.has(PERMISSIONS.AUDIT_VIEW), true);

  const accountant = permissionsForRole("ACCOUNTANT");
  assert.equal(accountant.has(PERMISSIONS.FINANCIAL_VIEW), true);
  assert.equal(accountant.has(PERMISSIONS.CLINICAL_EDIT), false);
});

test("manager priority elevates system priority while hold suppresses overdue work", () => {
  const now = new Date("2026-10-26T12:00:00.000Z");
  const item = buildApprovalIntelligenceItem({
    id: "claim-1",
    createdAt: now,
    patientName: "Synthetic",
    payerName: "Synthetic Payer",
    status: "DRAFT",
    eligibilityStatus: "VERIFIED",
    priorAuthStatus: "NOT_REQUIRED",
    claimSubmissionDate: null,
    workDueAt: new Date("2026-10-20T00:00:00.000Z"),
    nextFollowUpAt: new Date("2026-10-20T00:00:00.000Z"),
    holdUntil: new Date("2026-10-30T00:00:00.000Z"),
    holdReason: "Waiting for medical records",
    managerPriority: "URGENT",
    managerPriorityReason: "High dollar claim",
    documents: [],
    checks: [],
    codingSuggestions: [],
    serviceLines: []
  }, { now });

  assert.equal(item.priority, "CRITICAL");
  assert.equal(item.managerPriority, "URGENT");
  assert.equal(item.workManagement.onHold, true);
  assert.equal(item.workManagement.overdue, false);
  assert.equal(item.actionState, "ON_HOLD");
});

test("operations domain includes all eleven workflow capabilities", () => {
  const schema = read("backend/prisma/schema.prisma");
  const route = read("backend/src/routes/operations.js");
  const queue = read("frontend/src/modules/approval/ApprovalIntelligence.jsx");
  const collaboration = read("frontend/src/modules/operations/ClaimCollaboration.jsx");
  const operations = read("frontend/src/modules/operations/Operations.jsx");

  for (const model of [
    "Team","SavedQueue","ClaimComment","ClinicalRequest","Notification",
    "ApprovalRequest","ClaimOwnershipHistory","UserInvite"
  ]) {
    assert.match(schema, new RegExp(`model ${model} \\\{`));
  }

  assert.match(route, /users\/invite/);
  assert.match(route, /claims\/bulk-work/);
  assert.match(route, /managerPriority/);
  assert.match(route, /saved-queues/);
  assert.match(route, /clinical-requests/);
  assert.match(route, /notifications/);
  assert.match(route, /approvals/);
  assert.match(route, /ownership-history/);
  assert.match(queue, /Bulk Work Actions/);
  assert.match(queue, /Save View/);
  assert.match(collaboration, /Internal Comments/);
  assert.match(collaboration, /Clinical Requests/);
  assert.match(collaboration, /Request Manager Approval/);
  assert.match(operations, /Users & Teams/);
  assert.match(operations, /Team Workload/);
});
