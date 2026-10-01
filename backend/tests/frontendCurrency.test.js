import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("U1 - shared currency formatter uses en-US USD and preserves cents", async () => {
  const currencyPath = path.join(
    repoRoot,
    "frontend/src/utils/currency.js"
  );
  const source = read("frontend/src/utils/currency.js");

  assert.ok(source.includes('new Intl.NumberFormat("en-US"'));
  assert.ok(source.includes('currency: "USD"'));

  const { formatUSD } = await import(pathToFileURL(currencyPath).href);
  assert.equal(formatUSD("1234.56"), "$1,234.56");
  assert.equal(formatUSD(0), "$0.00");
  assert.equal(formatUSD(null), "—");
});

test("U1 - frontend contains no rupee labels and money views use shared formatter", () => {
  const files = [
    "frontend/src/pages/NewClaim.jsx",
    "frontend/src/modules/ai-claims/ClaimsList.jsx",
    "frontend/src/modules/ai-claims/claim-detail/claimDetailUtils.js",
    "frontend/src/modules/approval/ApprovalIntelligence.jsx",
    "frontend/src/modules/denials/DenialIntelligence.jsx",
    "frontend/src/modules/journey/ClaimJourney.jsx"
  ];

  for (const file of files) {
    assert.equal(read(file).includes("₹"), false, file);
  }

  assert.ok(read("frontend/src/pages/NewClaim.jsx").includes("formatUSD"));
  assert.ok(read("frontend/src/modules/ai-claims/ClaimsList.jsx").includes("formatUSD"));
  assert.ok(read("frontend/src/modules/approval/ApprovalIntelligence.jsx").includes("formatUSD"));
  assert.ok(read("frontend/src/modules/denials/DenialIntelligence.jsx").includes("formatUSD"));
  assert.ok(read("frontend/src/modules/journey/ClaimJourney.jsx").includes("formatUSD"));
  assert.ok(read("frontend/src/modules/ai-claims/claim-detail/claimDetailUtils.js").includes("formatUSD"));

  for (const file of [
    "frontend/src/modules/approval/ApprovalIntelligence.jsx",
    "frontend/src/modules/denials/DenialIntelligence.jsx",
    "frontend/src/modules/journey/ClaimJourney.jsx"
  ]) {
    assert.equal(read(file).includes('new Intl.NumberFormat("en-US"'), false, file);
  }
});
