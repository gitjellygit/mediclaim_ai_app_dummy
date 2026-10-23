import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("claim schema supports audited operational ownership without changing claim lifecycle", () => {
  const schema = read("backend/prisma/schema.prisma");
  const migration = read("backend/prisma/migrations/20261023161000_claim_work_management/migration.sql");

  assert.match(schema, /assignedToUserId String\?/);
  assert.match(schema, /workTeam\s+String\?/);
  assert.match(schema, /workDueAt\s+DateTime\?/);
  assert.match(schema, /nextFollowUpAt\s+DateTime\?/);
  assert.match(schema, /lastWorkedAt\s+DateTime\?/);
  assert.match(schema, /escalatedAt\s+DateTime\?/);
  assert.match(schema, /assignedClaims Claim\[\]/);
  assert.match(migration, /Claim_assignedToUserId_fkey/);
});

test("work-management API enforces organization-scoped assignees and audits changes", () => {
  const route = read("backend/src/routes/claims.js");

  assert.match(route, /"\/work-management\/users"/);
  assert.match(route, /"\/:id\/work-management"/);
  assert.match(route, /organizationId: orgId\(req\)/);
  assert.match(route, /INVALID_WORK_ASSIGNEE/);
  assert.match(route, /CLAIM_WORK_MANAGEMENT_UPDATED/);
  assert.match(route, /lastWorkedAt: new Date\(\)/);
});

test("work queue supports manager ownership and follow-up filters", () => {
  const route = read("backend/src/routes/claims.js");
  const service = read("backend/src/services/approvalIntelligence.js");
  const ui = read("frontend/src/modules/approval/ApprovalIntelligence.jsx");

  assert.match(route, /requestedOwner/);
  assert.match(route, /requestedFollowUp/);
  assert.match(route, /owner === "ME"/);
  assert.match(route, /owner === "UNASSIGNED"/);
  assert.match(route, /followUp === "OVERDUE"/);
  assert.match(route, /dueTodayCount/);
  assert.match(service, /workManagement:/);
  assert.match(service, /workOverdue/);
  assert.match(ui, /Assigned to me/);
  assert.match(ui, /Unassigned/);
  assert.match(ui, /Due today/);
  assert.match(ui, /Assign \/ Follow-up/);
});
