import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("prior authorization case has evidence, deadline, payer reference and additional-info lifecycle", () => {
  const schema = read("backend/prisma/schema.prisma");
  const route = read("backend/src/routes/priorAuthCases.js");

  assert.match(schema, /model PriorAuthCase/);
  assert.match(schema, /requiredDocuments\s+Json\?/);
  assert.match(schema, /missingDocuments\s+Json\?/);
  assert.match(schema, /additionalInfoRequests\s+Json\?/);
  assert.match(schema, /responseDueAt\s+DateTime\?/);
  assert.match(schema, /payerReference\s+String\?/);

  assert.match(route, /READY_TO_SUBMIT/);
  assert.match(route, /ADDITIONAL_INFO_REQUESTED/);
  assert.match(route, /PRIOR_AUTH_EVIDENCE_MISSING/);
  assert.match(route, /PRIOR_AUTH_SUBMISSION_RECORDED/);
  assert.match(route, /PRIOR_AUTH_ADDITIONAL_INFO_REQUESTED/);
  assert.match(route, /PRIOR_AUTH_APPROVED/);
  assert.match(route, /PRIOR_AUTH_DENIED/);
});

test("prior authorization submission is explicitly record-only until a real connector exists", () => {
  const route = read("backend/src/routes/priorAuthCases.js");
  const ui = read("frontend/src/modules/journey/ClaimJourney.jsx");

  assert.match(route, /externalTransmissionPerformed: false/);
  assert.match(route, /No external payer transmission was performed/);
  assert.match(ui, /Record PA Submission/);
  assert.match(ui, /PRISM does not transmit externally unless a connector explicitly supports prior authorization/);
});

test("claim submission remains gated by approved or not-required prior authorization", () => {
  const journey = read("backend/src/routes/claimJourney.js");
  const ui = read("frontend/src/modules/journey/ClaimJourney.jsx");

  assert.match(journey, /claim\.priorAuthStatus === "APPROVED"/);
  assert.match(journey, /claim\.priorAuthStatus === "NOT_REQUIRED"/);
  assert.match(ui, /Build Authorization Case/);
  assert.match(ui, /Refresh Evidence Checklist/);
  assert.match(ui, /Record Additional Info Request/);
});
