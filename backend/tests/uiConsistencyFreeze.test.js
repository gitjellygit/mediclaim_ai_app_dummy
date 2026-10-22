import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("final UI freeze - Claims shows full sortable IDs and defaults to ten rows", () => {
  const ui = read("frontend/src/modules/ai-claims/ClaimsList.jsx");
  const route = read("backend/src/routes/claims.js");

  assert.match(ui, /useState\(10\)/);
  assert.match(ui, /handleSort\("id"\)/);
  assert.match(ui, /\{claim\.id\}/);
  assert.match(ui, /Copy Claim ID/);
  assert.doesNotMatch(ui, /slice\(-10\)/);
  assert.match(ui, /rowsPerPageOptions=\{\[10\]\}/);
  assert.match(ui, /statusSummary/);

  assert.match(route, /pageSize \|\| 10/);
  assert.match(route, /new Set\(\["id", "patientName"/);
  assert.match(route, /groupBy\(\{/);
  assert.match(route, /statusSummary/);
});

test("final UI freeze - operational tables use ten rows and visible sort affordances", () => {
  const workQueue = read("frontend/src/modules/approval/ApprovalIntelligence.jsx");
  const recovery = read("frontend/src/modules/recovery/RevenueRecovery.jsx");
  const audit = read("frontend/src/modules/audit/AuditTrail.jsx");
  const auditRoute = read("backend/src/routes/audit.js");
  const rules = read("frontend/src/modules/rules/Rules.jsx");

  assert.match(workQueue, /React\.useState\(10\)/);
  assert.match(workQueue, /rowsPerPageOptions=\{\[10\]\}/);
  assert.match(workQueue, /hideSortIcon=\{false\}/);

  assert.match(recovery, /const pageSize = 10/);
  assert.match(recovery, /hideSortIcon=\{false\}/);

  assert.match(audit, /pageSize: 10/);
  assert.match(audit, /rowsPerPage=\{10\}/);
  assert.match(audit, /sortableHeader\("When", "createdAt"\)/);
  assert.match(audit, /sortableHeader\("User", "actorEmail"\)/);
  assert.match(auditRoute, /pageSize \|\| 10/);
  assert.match(auditRoute, /const sortMap = \{/);

  assert.match(rules, /const pageSize = 10/);
  assert.match(rules, /pagedRules/);
  assert.match(rules, /TablePagination/);
  assert.match(rules, /hideSortIcon=\{false\}/);
});

test("final UI freeze - recovery visuals, journey empty state and claim cancel path remain", () => {
  const recovery = read("frontend/src/modules/recovery/RevenueRecovery.jsx");
  const journey = read("frontend/src/modules/journey/ClaimJourney.jsx");
  const newClaim = read("frontend/src/pages/NewClaim.jsx");

  assert.match(recovery, /Top Payer Leakage/);
  assert.match(recovery, /maxPayerLeakage/);
  assert.match(recovery, /Top Recovery Root Causes/);
  assert.match(recovery, /maxRootCauseLeakage/);
  assert.match(recovery, /Recovery Financial Mix/);

  assert.match(journey, /Start with a claim/);
  assert.match(journey, /Search by patient, claim number, member ID, policy, or payer/);
  assert.match(journey, /fontFamily="monospace"/);

  assert.match(newClaim, /cancelClaimCreation/);
  assert.match(newClaim, /Discard claim draft\?/);
  assert.match(newClaim, /Keep editing/);
  assert.match(newClaim, /Step \{activeStep \+ 1\} of \{steps\.length\}/);
});
