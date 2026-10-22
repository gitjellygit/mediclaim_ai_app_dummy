import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Analytics dashboard is financial-permission gated and uses recorded claim data", () => {
  const route = read("backend/src/routes/analytics.js");

  assert.match(route, /requirePermission\(PERMISSIONS\.FINANCIAL_VIEW\)/);
  assert.match(route, /totalBilledAmount/);
  assert.match(route, /paidAmount/);
  assert.match(route, /remittanceReceivedAt/);
  assert.match(route, /denialCase\.findMany/);
  assert.match(route, /underpaymentCase\.findMany/);
  assert.match(route, /Denied claims divided by adjudicated claims/);
  assert.match(route, /not a first-pass acceptance rate/i);
});

test("Analytics v1 exposes operational dashboard sections without invented approval metrics", () => {
  const ui = read("frontend/src/modules/analytics/AnalyticsDashboard.jsx");

  assert.match(ui, /Analytics & Operations/);
  assert.match(ui, /Claim Funnel/);
  assert.match(ui, /A\/R Aging/);
  assert.match(ui, /Billed vs Paid Trend/);
  assert.match(ui, /Top Denial Causes/);
  assert.match(ui, /Payer Performance/);
  assert.match(ui, /Eligibility Issues/);
  assert.match(ui, /Prior Auth Issues/);
  assert.doesNotMatch(ui, /First.Pass Acceptance/i);
  assert.doesNotMatch(ui, /95%/);
});
