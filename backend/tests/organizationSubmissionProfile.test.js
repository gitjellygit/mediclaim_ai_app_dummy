import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");

test("organization 837 configuration replaces global submitter and billing environment values", () => {
  const connector = fs.readFileSync(
    path.join(backendRoot, "src/services/stediTestConnector.js"),
    "utf8"
  );
  assert.doesNotMatch(connector, /STEDI_BILLING_/);
  assert.doesNotMatch(connector, /STEDI_SUBMITTER_/);
  assert.match(connector, /organization\.stediProfessionalSignatureIndicator/);
  assert.match(connector, /organization\.stediBenefitsAssignmentIndicator/);
  assert.match(connector, /organization\.stediReleaseInformationCode/);
});

test("837 legal indicators are not hard-coded in request construction", () => {
  const connector = fs.readFileSync(
    path.join(backendRoot, "src/services/stediTestConnector.js"),
    "utf8"
  );
  assert.doesNotMatch(connector, /signatureIndicator:\s*"Y"/);
  assert.doesNotMatch(connector, /planParticipationCode:\s*"[AC]"/);
  assert.doesNotMatch(connector, /benefitsAssignmentCertificationIndicator:\s*"Y"/);
  assert.doesNotMatch(connector, /releaseInformationCode:\s*"Y"/);
});
