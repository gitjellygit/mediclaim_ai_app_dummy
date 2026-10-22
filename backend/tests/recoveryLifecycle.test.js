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
  assert.match(ui, /\/revenue-recovery\/appeals\//);
  assert.match(ui, /\/revenue-recovery\/underpayments\//);
  assert.doesNotMatch(ui, /\/denials\?caseId=/);
  assert.doesNotMatch(ui, /\/payments\?caseId=/);
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

test("recovery intelligence uses dedicated case workspace routes", () => {
  const app = read("frontend/src/App.jsx");
  const journey = read("frontend/src/modules/journey/ClaimJourney.jsx");
  const underpayment = read("frontend/src/modules/recovery/UnderpaymentWorkspace.jsx");

  assert.match(app, /\/revenue-recovery\/appeals\/:id/);
  assert.match(app, /\/revenue-recovery\/underpayments\/:id/);
  assert.match(journey, /\/revenue-recovery\/appeals\//);
  assert.match(journey, /\/revenue-recovery\/underpayments\//);
  assert.match(underpayment, /Underpayment Recovery Workspace/);
  assert.doesNotMatch(journey, /\/payments\?caseId=/);
  assert.doesNotMatch(journey, /\/denials\?caseId=/);
});
