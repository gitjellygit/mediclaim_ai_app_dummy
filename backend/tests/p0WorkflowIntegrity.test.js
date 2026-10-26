import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncDenialRecoveryFromPayment } from "../src/services/recoverySettlement.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("posted payment syncs recovered dollars to latest active denial", async () => {
  const updates = [];
  const tx = {
    denialCase: {
      findFirst: async () => ({
        id: "d1",
        status: "APPEAL_SUBMITTED",
        revenueAtRisk: 1275
      }),
      update: async ({ where, data }) => {
        updates.push({ where, data });
        return { id: where.id, ...data };
      }
    }
  };
  await syncDenialRecoveryFromPayment(tx, { claimId: "c1", paidAmount: 485.52 });
  assert.equal(updates[0].data.recoveredAmount, 485.52);
  assert.equal(updates[0].data.status, "APPEAL_SUBMITTED");
});

test("full recovery overturns active denial", async () => {
  const tx = {
    denialCase: {
      findFirst: async () => ({ id: "d1", status: "APPEAL_SUBMITTED", revenueAtRisk: 500 }),
      update: async ({ data }) => data
    }
  };
  const result = await syncDenialRecoveryFromPayment(tx, { claimId: "c1", paidAmount: 700 });
  assert.equal(result.recoveredAmount, 500);
  assert.equal(result.status, "OVERTURNED");
});

test("zero payment does not change denial recovery", async () => {
  let called = false;
  const tx = { denialCase: { findFirst: async () => { called = true; } } };
  const result = await syncDenialRecoveryFromPayment(tx, { claimId: "c1", paidAmount: 0 });
  assert.equal(result, null);
  assert.equal(called, false);
});

const journey = read("frontend/src/modules/journey/ClaimJourney.jsx");
const appeal = read("frontend/src/modules/recovery/AppealWorkspace.jsx");
const priorAuth = read("backend/src/routes/priorAuthCases.js");
const operations = read("backend/src/routes/operations.js");
const recovery = read("backend/src/routes/revenueRecovery.js");
const dialog = read("frontend/src/components/ClaimAssignmentDialog.jsx");

test("journey hides authorization case workflow when PA is not required", () => {
  assert.match(journey, /claim\.priorAuthRequired === false/);
  assert.match(journey, /No prior authorization is required for this claim/);
  assert.match(journey, /claim\.priorAuthRequired === true && !workflowAdvanced/);
});

test("backend refuses to create a prior authorization case when not required", () => {
  assert.match(priorAuth, /PRIOR_AUTH_NOT_REQUIRED/);
});

test("payer submission is gated by current readiness", () => {
  assert.match(journey, /journeyReadinessClear/);
  assert.match(journey, /journeySubmissionActionable/);
  assert.match(journey, /Run or refresh Submission Readiness/);
});

test("appeal workspace reconciles recovered and remaining amounts", () => {
  assert.match(appeal, /displayedRecoveredAmount/);
  assert.match(appeal, /remainingRecoveryAmount/);
  assert.match(appeal, />Remaining</);
});

test("terminal paid and posted outcome removes payer refresh controls", () => {
  assert.match(appeal, /payerOutcomeFinal/);
  assert.match(appeal, /!payerOutcomeFinal && \(/);
});

test("appeal workspace replaces stale payer outcome with server state", () => {
  assert.doesNotMatch(appeal, /setPayerOutcome\(\(current\) => current \|\|/);
});

test("paid claims with active recovery remain in workload", () => {
  assert.match(operations, /denialCases:/);
  assert.match(operations, /underpaymentCase:/);
});

test("recovery assignment users are scoped to recovery-capable roles", () => {
  assert.match(recovery, /\/assignment-users/);
  assert.match(recovery, /DENIAL_SPECIALIST/);
  assert.match(recovery, /CLAIMS_SPECIALIST/);
});

test("assignment dialog supports a scoped user loader", () => {
  assert.match(dialog, /loadUsers/);
  assert.match(dialog, /loadUsers \|\| ClaimsApi\.workManagementUsers/);
});


const simulatedPayer = read("backend/src/routes/claimPayerSimulation.js");
const claimJourney = read("backend/src/routes/claimJourney.js");

test("underpayment does not mark the claim fully paid", () => {
  assert.match(simulatedPayer, /!expectation\?\.hasUnderpayment/);
  assert.match(simulatedPayer, /"PARTIALLY_APPROVED"/);
});

test("manual remittance distinguishes partial from fully settled payment", () => {
  assert.match(claimJourney, /const financiallySettled/);
  assert.match(claimJourney, /"PARTIALLY_APPROVED"/);
});

test("posted partial payer outcome is terminal for refresh but retains remaining recovery", () => {
  assert.match(appeal, /\["PAID", "PARTIALLY_APPROVED"\]\.includes\(effectivePayerStatus\)/);
  assert.match(appeal, /Continue recovery work for the remaining balance/);
});
