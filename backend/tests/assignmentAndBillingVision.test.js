import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const claimsList = read("frontend/src/modules/ai-claims/ClaimsList.jsx");
const recovery = read("frontend/src/modules/recovery/RevenueRecovery.jsx");
const detail = read("frontend/src/modules/ai-claims/ClaimDetail.jsx");
const assignment = read("frontend/src/components/ClaimAssignmentDialog.jsx");
const newClaim = read("frontend/src/pages/NewClaim.jsx");
const leftNav = read("frontend/src/layout/LeftNav.jsx");
const claimsRoute = read("backend/src/routes/claims.js");
const recoveryRoute = read("backend/src/routes/revenueRecovery.js");
const recoveryApi = read("frontend/src/api/revenueRecovery.js");

test("claims list exposes assignee and bulk assignment independently of delete permission", () => {
  assert.match(claimsList, /canManageAssignments/);
  assert.match(claimsList, /canSelectClaims = canDeleteClaims \|\| canManageAssignments/);
  assert.match(claimsList, /Assign Selected/);
  assert.match(claimsList, /<strong>Assignee<\/strong>/);
});

test("claims list row assignment uses shared assignment dialog", () => {
  assert.match(claimsList, /ClaimAssignmentDialog/);
  assert.match(claimsList, /claim\.assignedToUser/);
  assert.match(claimsList, /Reassign/);
});

test("revenue recovery exposes recovery owner assignment", () => {
  assert.match(recovery, /Recovery Owner/);
  assert.match(recovery, /Assign recovery work/);
  assert.match(recovery, /ClaimAssignmentDialog/);
});

test("recovery users can assign with RECOVERY_EDIT without broad claim edit", () => {
  assert.match(recovery, /PERMISSIONS\.RECOVERY_EDIT/);
  assert.match(recoveryApi, /assignClaim/);
  assert.match(recoveryRoute, /requirePermission\(PERMISSIONS\.RECOVERY_EDIT\)/);
});

test("recovery assignment is limited to claims that actually have recovery cases", () => {
  assert.match(recoveryRoute, /denialCase\.count/);
  assert.match(recoveryRoute, /underpaymentCase\.count/);
  assert.match(recoveryRoute, /Claim is not part of Revenue Recovery/);
});

test("recovery assignment writes ownership history and notification", () => {
  assert.match(recoveryRoute, /claimOwnershipHistory\.create/);
  assert.match(recoveryRoute, /RECOVERY_ASSIGNED/);
  assert.match(recoveryRoute, /RECOVERY_ASSIGNMENT_UPDATED/);
});

test("claim detail exposes current owner and change assignment action", () => {
  assert.match(detail, /Current Owner/);
  assert.match(detail, /Change assignment/);
  assert.match(detail, /ClaimAssignmentDialog/);
});

test("standard claim assignment surfaces use operations bulk-work API", () => {
  assert.match(assignment, /OperationsApi\.bulkWork/);
  assert.match(assignment, /claimIds/);
  assert.match(assignment, /assignedToUserId/);
});

test("assignment dialog loads work-management users", () => {
  assert.match(assignment, /ClaimsApi\.workManagementUsers/);
});

test("claim list API returns owner and team", () => {
  assert.match(claimsRoute, /assignedToUser:/);
  assert.match(claimsRoute, /workTeam: true/);
});

test("claim detail API includes assigned user", () => {
  assert.match(claimsRoute, /assignedToUser: \{ select: \{ id: true, email: true, displayName: true, role: true \} \}/);
});

test("revenue recovery API carries claim owner and team for denials and underpayments", () => {
  const ownerFields = recoveryRoute.match(/assignedToUser: item\.claim\?\.assignedToUser/g) || [];
  assert.equal(ownerFields.length, 2);
  assert.match(recoveryRoute, /workTeam: item\.claim\?\.workTeam/);
});

test("manual claim form renders only one Cancel action", () => {
  const matches = newClaim.match(/onClick=\{cancelClaimCreation\}/g) || [];
  assert.equal(matches.length, 1);
});

for (const label of [
  "Patients",
  "Scheduling",
  "Check-In / Check-Out",
  "Encounters",
  "Charge Capture & Coding",
  "Patient Billing",
  "Payments & Collections",
  "Patient Portal"
]) {
  test(`future billing suite placeholder exists: ${label}`, () => {
    assert.ok(leftNav.includes(`label="${label}"`));
  });
}

test("future billing suite placeholders are visibly marked planned", () => {
  assert.match(leftNav, /Future Billing Suite/);
  assert.match(leftNav, /secondary=\{planned \? "Planned"/);
  assert.match(leftNav, /disabled=\{planned\}/);
});
