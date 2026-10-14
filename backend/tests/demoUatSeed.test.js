import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const seedPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../scripts/seed-demo-uat.js"
);
const source = fs.readFileSync(seedPath, "utf8");

test("Demo UAT seed is local-only and isolates its cleanup scope", () => {
  assert.match(source, /Refusing to seed demo UAT data into a non-local database/);
  assert.match(source, /medicalRecordNumber: `DEMO-UAT-/);
  assert.match(source, /medicalRecordNumber: \{ startsWith: "DEMO-UAT-" \}/);
  assert.match(source, /Existing non-DEMO-UAT claims were preserved/);
});

test("Demo UAT seed covers major claim and recovery lifecycle families", () => {
  for (const scenario of [
    "COMPLETE_READY",
    "INCOMPLETE",
    "ELIGIBILITY",
    "PRIOR_AUTH",
    "SUBMITTED",
    "REJECTED",
    "DENIAL_OPEN",
    "APPEAL_PREPARED",
    "APPEAL_SUBMITTED",
    "PAID_POSTED",
    "UNDERPAYMENT_OPEN",
    "RECOVERED"
  ]) {
    assert.match(source, new RegExp(`"${scenario}"`));
  }

  assert.match(source, /NAMES\.length/);
  assert.match(source, /Demo UAT seed complete:/);
  assert.match(source, /synthetic patients created/);
  assert.match(source, /denialCases/);
  assert.match(source, /underpaymentCase/);
  assert.match(source, /payerTransactions/);
  assert.match(source, /documents/);
  assert.match(source, /serviceLines/);
  assert.match(source, /checks/);
});
