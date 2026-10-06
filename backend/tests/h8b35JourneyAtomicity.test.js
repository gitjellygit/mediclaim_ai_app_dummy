import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVE_DENIAL_CASE_STATUSES,
  findActiveDenialCase
} from "../src/services/denialCaseLifecycle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

test("H8B-3.5C - active denial statuses include appeal and resubmission states", async () => {
  assert.deepEqual(ACTIVE_DENIAL_CASE_STATUSES, [
    "OPEN",
    "ANALYZED",
    "CORRECTION_REQUIRED",
    "APPEAL_PREPARED",
    "APPEAL_SUBMITTED",
    "RESUBMITTED"
  ]);

  let query = null;
  const prisma = {
    denialCase: {
      findFirst(args) {
        query = args;
        return Promise.resolve(null);
      }
    }
  };

  await findActiveDenialCase(prisma, "claim-1");
  assert.equal(query.where.claimId, "claim-1");
  assert.deepEqual(query.where.status.in, ACTIVE_DENIAL_CASE_STATUSES);
});

test("H8B-3.5C - journey payer status uses shared denial helper inside transaction", () => {
  const source = fs.readFileSync(
    path.join(root, "backend/src/routes/claimJourney.js"),
    "utf8"
  );
  const start = source.indexOf('router.patch("/:id/journey/claim-status"');
  const end = source.indexOf('router.patch("/:id/journey/remittance"', start);
  const block = source.slice(start, end);

  assert.match(block, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(block, /findActiveDenialCase\(tx, claim\.id\)/);
  assert.match(block, /tx\.claim\.update/);
  assert.match(block, /tx\.denialCase\.create/);
  assert.match(block, /tx\.auditEvent\.create/);
});

test("H8B-3.5C - payer status keeps claim denial and transaction atomic", () => {
  const source = fs.readFileSync(
    path.join(root, "backend/src/routes/claimPayerSimulation.js"),
    "utf8"
  );
  const start = source.indexOf('router.post("/:id/payer-simulation/status"');
  const end = source.indexOf('router.post("/:id/payer-simulation/remittance"', start);
  const block = source.slice(start, end);

  assert.match(block, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(block, /findActiveDenialCase\(tx, claim\.id\)/);
  assert.match(block, /tx\.claim\.update/);
  assert.match(block, /tx\.denialCase\.create/);
  assert.match(block, /createPayerTransaction\([\s\S]*tx\n\s*\)/);
});

test("H8B-3.5C - eligibility prior auth and remittance persist atomically", () => {
  const payer = fs.readFileSync(
    path.join(root, "backend/src/routes/claimPayerSimulation.js"),
    "utf8"
  );
  const journey = fs.readFileSync(
    path.join(root, "backend/src/routes/claimJourney.js"),
    "utf8"
  );

  for (const marker of [
    'router.post("/:id/payer-simulation/eligibility"',
    'router.post("/:id/payer-simulation/prior-auth"',
    'router.post("/:id/payer-simulation/remittance"'
  ]) {
    const start = payer.indexOf(marker);
    const next = payer.indexOf("\nrouter.", start + marker.length);
    const block = payer.slice(start, next > start ? next : undefined);
    assert.match(block, /prisma\.\$transaction\(async \(tx\)/, marker);
  }

  for (const marker of [
    'router.post("/:id/journey/eligibility/precheck"',
    'router.post("/:id/journey/prior-auth/evaluate"'
  ]) {
    const start = journey.indexOf(marker);
    const next = journey.indexOf("\nrouter.", start + marker.length);
    const block = journey.slice(start, next > start ? next : undefined);
    assert.match(block, /prisma\.\$transaction\(async \(tx\)/, marker);
  }
});
