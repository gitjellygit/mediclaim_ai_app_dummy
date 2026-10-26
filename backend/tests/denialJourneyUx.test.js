import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const journey = read("frontend/src/modules/journey/ClaimJourney.jsx");
const recovery = read("frontend/src/modules/recovery/RevenueRecovery.jsx");

test("denied claim remittance is not presented as successful completion", () => {
  assert.match(journey, /Denial ERA Received/);
  assert.match(journey, /deniedRemittanceEvidence/);
  assert.match(journey, /return "attention"/);
  assert.match(
    journey,
    /835 ERA received for a denied claim\. This is denial evidence, not a successful payment outcome/
  );
});

test("Work Denial deep-links to exact appeal case when available", () => {
  assert.match(
    journey,
    /revenue-recovery\/appeals\/\$\{activeDenialCase\.id\}/
  );
});

test("Work Denial falls back to claim-focused recovery list", () => {
  assert.match(
    journey,
    /revenue-recovery\?claimId=\$\{encodeURIComponent\(claim\.id\)\}/
  );
});

test("Revenue Recovery reads claimId deep link and focuses matching row", () => {
  assert.match(recovery, /useSearchParams/);
  assert.match(recovery, /focusedClaimId = searchParams\.get\("claimId"\)/);
  assert.match(recovery, /focused-recovery-row/);
  assert.match(recovery, /item\.claimId === focusedClaimId/);
});
