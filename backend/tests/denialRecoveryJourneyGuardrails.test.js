import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("post-submission eligibility can be rechecked for denial recovery", () => {
  const route = read("backend/src/routes/claimPayerSimulation.js");

  assert.match(route, /const postSubmissionRecheck = isClaimSubmittedOrLater\(claim\)/);
  assert.doesNotMatch(route, /Eligibility is locked after claim submission/);
  assert.match(route, /recoveryRecheck: postSubmissionRecheck/);
  assert.match(route, /if \(!postSubmissionRecheck\) \{\s*await markReadinessChecksStale/);
});

test("active denial blocks unchanged claim retransmission", () => {
  const route = read("backend/src/routes/claimPayerSimulation.js");

  assert.match(route, /const activeDenial = await findActiveDenialCase\(prisma, claim\.id\)/);
  assert.match(route, /code: "DENIAL_RECOVERY_REQUIRED"/);
  assert.match(route, /same denied claim cannot be transmitted again unchanged/i);
});

test("recorded final payer status is not replaced by another simulated status", () => {
  const route = read("backend/src/routes/claimPayerSimulation.js");

  assert.match(route, /recordedFinalStatuses/);
  assert.match(route, /"APPROVED"/);
  assert.match(route, /"DENIED"/);
  assert.match(route, /message: "Payer status is already final"/);
});

test("Claim Journey routes denied claims to recovery and keeps routine success feedback quiet", () => {
  const ui = read("frontend/src/modules/journey/ClaimJourney.jsx");

  assert.match(ui, /denialRecoveryActive/);
  assert.match(ui, /Do not retransmit the same claim unchanged/);
  assert.match(ui, /Work Denial/);
  assert.match(ui, /showSuccess = false/);
  assert.doesNotMatch(ui, /showToast\("Claim sent to payer", "success"\)/);
});
