import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const journeyPath = path.resolve(
  __dirname,
  "../../frontend/src/modules/journey/ClaimJourney.jsx"
);

test("Journey requires payer connection only before submission", () => {
  const source = fs.readFileSync(journeyPath, "utf8");

  assert.match(
    source,
    /const workflowAdvanced =[\s\S]*claimSubmissionDate[\s\S]*SUBMITTED[\s\S]*DENIED[\s\S]*PAID/
  );
  assert.match(source, /const payerConnectionRequired = !payerConnected && !workflowAdvanced/);
  assert.match(source, /historicalConnectionUnavailable = workflowAdvanced && !payerConnected/);
  assert.match(source, /Payer connection required\./);
  assert.match(source, /No payer connection record is available for this historical claim/);
  assert.match(source, /No action is required because this claim has already advanced/);
});

test("Journey does not force terminal claims back to pending eligibility or prior auth", () => {
  const source = fs.readFileSync(journeyPath, "utf8");

  assert.match(
    source,
    /payerConnectionRequired && \["eligibility", "prior-auth"\]\.includes\(step\.key\)/
  );
  assert.match(source, /Historical claim — eligibility is read-only/);
  assert.match(source, /Historical claim — prior authorization is read-only/);
  assert.match(source, /workflowAdvanced \? \(/);
  assert.match(source, /Connection record unavailable/);
});
