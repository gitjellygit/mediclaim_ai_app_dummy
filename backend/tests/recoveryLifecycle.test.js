import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(backendRoot, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("recovery lifecycle retains payer transaction evidence for denial cases", () => {
  const schema = read("backend/prisma/schema.prisma");
  const journey = read("backend/src/routes/claimJourney.js");

  assert.match(schema, /sourceTransactionId\s+String\?/);
  assert.match(schema, /payerEvidence\s+Json\?/);
  assert.match(journey, /claimStatus277/);
  assert.match(journey, /era835/);
  assert.match(journey, /adjustments: Array\.isArray\(result\.adjustments\)/);
});

test("journey exposes active denial and underpayment recovery cases", () => {
  const journey = read("backend/src/routes/claimJourney.js");
  const ui = read("frontend/src/modules/journey/ClaimJourney.jsx");

  assert.match(journey, /denialCases:\s*\{/);
  assert.match(journey, /underpaymentCase: true/);
  assert.match(ui, /Recovery Work/);
  assert.match(ui, /Open Denial Case/);
  assert.match(ui, /Open Recovery Case/);
  assert.match(ui, /\/denials\?caseId=/);
  assert.match(ui, /\/payments\?caseId=/);
});

test("later ERA payment can resolve and reopen payment variance recovery", () => {
  const journey = read("backend/src/routes/claimJourney.js");

  assert.match(journey, /status: "RECOVERED"/);
  assert.match(
    journey,
    /Auto-resolved after later 835 payment satisfied expected payer amount/
  );
  assert.match(
    journey,
    /\["RECOVERED", "WRITTEN_OFF", "CLOSED"\]\.includes/
  );
  assert.match(journey, /\? "OPEN"/);
  assert.match(journey, /resolvedAt: null/);
});

test("recovery intelligence screens accept case deep links", () => {
  const denials = read("frontend/src/modules/denials/DenialIntelligence.jsx");
  const payments = read(
    "frontend/src/modules/payments/UnderpaymentIntelligence.jsx"
  );

  assert.match(denials, /new URLSearchParams\(location\.search\)\.get\("caseId"\)/);
  assert.match(payments, /new URLSearchParams\(location\.search\)\.get\("caseId"\)/);
  assert.match(denials, /Payer Evidence/);
});
