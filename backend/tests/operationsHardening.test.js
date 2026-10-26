import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { permissionsForRole, PERMISSIONS } from "../src/security/permissions.js";
import {
  canRespondToClinicalRequest,
  isAssignableUser,
  isManagerRole,
  mentionsAreValid,
  savedQueueVisibilityWhere,
  shouldNotifyUser,
  validatePriorityOverride,
  validateUserAdministrationMutation,
  wouldRemoveActiveAdmin
} from "../src/services/operationsPolicy.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const roleCases = [
  ["ADMIN", true, true],
  ["CLAIMS_MANAGER", true, false],
  ["CLAIMS_SPECIALIST", true, false],
  ["DENIAL_SPECIALIST", true, false],
  ["PRIOR_AUTH_SPECIALIST", true, false],
  ["ACCOUNTANT", true, false],
  ["CLINICAL_REVIEWER", true, false],
  ["PROVIDER", true, false],
  ["RECEPTIONIST", true, false],
  ["AUDITOR", true, false],
  ["CASHIER", true, false]
];

for (const [role, operationsView, userAdmin] of roleCases) {
  test(`role matrix - ${role} has expected operations/admin permissions`, () => {
    const permissions = permissionsForRole(role);
    assert.equal(permissions.has(PERMISSIONS.OPERATIONS_VIEW), operationsView);
    assert.equal(permissions.has(PERMISSIONS.USER_ADMIN), userAdmin);
  });
}

for (const [role, expected] of [
  ["ADMIN", true],
  ["CLAIMS_MANAGER", true],
  ["CLAIMS_SPECIALIST", false],
  ["PROVIDER", false],
  ["AUDITOR", false]
]) {
  test(`manager gate - ${role} => ${expected}`, () => {
    assert.equal(isManagerRole(role), expected);
  });
}

for (const item of [
  { name: "no priority is allowed for specialist", role: "CLAIMS_SPECIALIST", priority: null, reason: null, status: null },
  { name: "normal priority needs no reason", role: "ADMIN", priority: "NORMAL", reason: null, status: null },
  { name: "high priority without reason is rejected", role: "ADMIN", priority: "HIGH", reason: "", status: 400 },
  { name: "urgent priority without reason is rejected", role: "CLAIMS_MANAGER", priority: "URGENT", reason: "  ", status: 400 },
  { name: "urgent priority with reason is accepted", role: "CLAIMS_MANAGER", priority: "URGENT", reason: "High dollar", status: null },
  { name: "specialist cannot override manager priority", role: "CLAIMS_SPECIALIST", priority: "HIGH", reason: "test", status: 403 }
]) {
  test(`priority policy - ${item.name}`, () => {
    assert.equal(
      validatePriorityOverride({
        role: item.role,
        managerPriority: item.priority,
        managerPriorityReason: item.reason
      })?.status ?? null,
      item.status
    );
  });
}

const activeAdmin = { id: "admin-1", role: "ADMIN", status: "ACTIVE" };
for (const item of [
  { name: "self suspension blocked", actor: "admin-1", target: activeAdmin, patch: { status: "SUSPENDED" }, count: 2, status: 409 },
  { name: "self activation allowed", actor: "admin-1", target: activeAdmin, patch: { status: "ACTIVE" }, count: 1, status: null },
  { name: "last admin suspension blocked", actor: "admin-2", target: activeAdmin, patch: { status: "SUSPENDED" }, count: 1, status: 409 },
  { name: "last admin demotion blocked", actor: "admin-2", target: activeAdmin, patch: { role: "CLAIMS_MANAGER" }, count: 1, status: 409 },
  { name: "admin suspension allowed when another active admin exists", actor: "admin-2", target: activeAdmin, patch: { status: "SUSPENDED" }, count: 2, status: null },
  { name: "admin demotion allowed when another active admin exists", actor: "admin-2", target: activeAdmin, patch: { role: "AUDITOR" }, count: 2, status: null },
  { name: "non-admin suspension allowed", actor: "admin-1", target: { id: "u1", role: "CLAIMS_SPECIALIST", status: "ACTIVE" }, patch: { status: "SUSPENDED" }, count: 1, status: null },
  { name: "already suspended admin can be edited without last-admin rule", actor: "admin-1", target: { id: "u2", role: "ADMIN", status: "SUSPENDED" }, patch: { role: "AUDITOR" }, count: 1, status: null },
  { name: "admin team change does not remove admin", actor: "admin-2", target: activeAdmin, patch: { teamId: "team-1" }, count: 1, status: null },
  { name: "admin display-name change does not remove admin", actor: "admin-2", target: activeAdmin, patch: { displayName: "A" }, count: 1, status: null }
]) {
  test(`admin safety - ${item.name}`, () => {
    assert.equal(
      validateUserAdministrationMutation({
        actorId: item.actor,
        target: item.target,
        patch: item.patch,
        activeAdminCount: item.count
      })?.status ?? null,
      item.status
    );
  });
}

for (const item of [
  ["active admin removal is detected", activeAdmin, { status: "SUSPENDED" }, true],
  ["active admin demotion is detected", activeAdmin, { role: "AUDITOR" }, true],
  ["active admin normal edit is not removal", activeAdmin, { displayName: "Admin" }, false],
  ["non-admin suspension is not admin removal", { id: "u", role: "AUDITOR", status: "ACTIVE" }, { status: "SUSPENDED" }, false]
]) {
  test(`active admin detection - ${item[0]}`, () => {
    assert.equal(wouldRemoveActiveAdmin(item[1], item[2]), item[3]);
  });
}

for (const item of [
  ["active user assignable", { status: "ACTIVE" }, true],
  ["suspended user not assignable", { status: "SUSPENDED" }, false],
  ["invited user not assignable", { status: "INVITED" }, false],
  ["missing user not assignable", null, false]
]) {
  test(`assignment - ${item[0]}`, () => {
    assert.equal(isAssignableUser(item[1]), item[2]);
  });
}

for (const item of [
  ["all active mentions accepted", ["u1", "u2"], ["u1", "u2"], true],
  ["inactive/missing mention rejected", ["u1", "u2"], ["u1"], false],
  ["duplicate mention IDs rejected", ["u1", "u1"], ["u1"], false],
  ["empty mention list accepted", [], [], true]
]) {
  test(`mentions - ${item[0]}`, () => {
    assert.equal(mentionsAreValid(item[1], item[2]), item[3]);
  });
}

for (const item of [
  ["assignee can respond", { actorId: "u1", actorRole: "PROVIDER", assignedToUserId: "u1" }, true],
  ["claims manager can override assigned request", { actorId: "m1", actorRole: "CLAIMS_MANAGER", assignedToUserId: "u1" }, true],
  ["admin can override assigned request", { actorId: "a1", actorRole: "ADMIN", assignedToUserId: "u1" }, true],
  ["other provider cannot respond", { actorId: "u2", actorRole: "PROVIDER", assignedToUserId: "u1" }, false],
  ["unassigned request can be responded to by clinical user", { actorId: "u2", actorRole: "PROVIDER", assignedToUserId: null }, true]
]) {
  test(`clinical response - ${item[0]}`, () => {
    assert.equal(canRespondToClinicalRequest(item[1]), item[2]);
  });
}

for (const item of [
  ["self notification suppressed", "u1", "u1", false],
  ["other-user notification created", "u1", "u2", true],
  ["missing target notification suppressed", "u1", null, false]
]) {
  test(`notifications - ${item[0]}`, () => {
    assert.equal(shouldNotifyUser(item[1], item[2]), item[3]);
  });
}

test("saved queues - owner is always visible", () => {
  const where = savedQueueVisibilityWhere({ organizationId: "org", userId: "u1", teamId: null });
  assert.deepEqual(where.OR, [{ ownerUserId: "u1" }]);
});
test("saved queues - same-team shared queue is included", () => {
  const where = savedQueueVisibilityWhere({ organizationId: "org", userId: "u1", teamId: "t1" });
  assert.equal(where.OR.length, 2);
  assert.equal(where.OR[1].AND[0].sharedWithTeam, true);
  assert.equal(where.OR[1].AND[1].ownerUser.is.teamId, "t1");
});
test("saved queues - tenant scope is always present", () => {
  const where = savedQueueVisibilityWhere({ organizationId: "org-9", userId: "u1", teamId: "t1" });
  assert.equal(where.organizationId, "org-9");
});

const operationsRoute = read("backend/src/routes/operations.js");
const operationsUi = read("frontend/src/modules/operations/Operations.jsx");
const acceptInviteUi = read("frontend/src/pages/AcceptInvite.jsx");
const recoveryScript = read("backend/scripts/reactivate-admin.js");

for (const item of [
  ["route blocks self/last-admin mutation through policy", operationsRoute, /validateUserAdministrationMutation/],
  ["route counts active admins before removing one", operationsRoute, /role: "ADMIN", status: "ACTIVE"/],
  ["suspension still revokes active refresh sessions", operationsRoute, /refreshToken\.updateMany/],
  ["raw setup token is not printed in Operations UI", operationsUi, /one-time token is not displayed on screen/],
  ["Operations UI copies an activation link", operationsUi, /Copy activation link/],
  ["current user status selector is disabled", operationsUi, /item\.id === user\?\.id/],
  ["accept-invite recognizes token-bearing secure link", acceptInviteUi, /Secure invitation link detected/],
  ["accept-invite hides token field when link supplied", acceptInviteUi, /invitationToken \?/],
  ["local admin recovery refuses non-local databases", recoveryScript, /Refusing to reactivate an admin against a non-local database/],
  ["local admin recovery only reactivates ADMIN users", recoveryScript, /only reactivates existing ADMIN users/],
  ["saved queue deletion remains owner scoped", operationsRoute, /ownerUserId: req\.user\.id/],
  ["notification read remains user scoped", operationsRoute, /userId: req\.user\.id/],
  ["approval decisions remain pending-only", operationsRoute, /status: "PENDING"/]
]) {
  test(`security contract - ${item[0]}`, () => {
    assert.match(item[1], item[2]);
  });
}
