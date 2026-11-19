import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("#043/#044 ledger architecture remains append-only and provider adjustments remain claim-free", () => {
  const schema = read("backend/prisma/schema.prisma");
  const journey = read("backend/src/routes/claimJourney.js");
  const connector = read("backend/src/services/stediTestConnector.js");
  const ledger = read("backend/src/services/financialLedger.js");

  assert.match(schema, /model PaymentBatch/);
  assert.match(schema, /model FinancialEvent/);
  assert.match(schema, /sourceEventKey String/);
  assert.match(schema, /@@unique\(\[organizationId, sourceEventKey\]\)/);
  assert.match(schema, /claimId String\?/);
  assert.match(journey, /postEraFinancialEvents/);
  assert.match(journey, /cumulativeClaimPaidAmount/);
  assert.match(connector, /providerAdjustments: normalizeProviderAdjustments/);
  assert.match(ledger, /eventType: "PROVIDER_ADJUSTMENT"/);
  assert.match(ledger, /claimId: null/);
  assert.doesNotMatch(ledger, /financialEvent\.update/);
  assert.doesNotMatch(ledger, /financialEvent\.delete/);
});
