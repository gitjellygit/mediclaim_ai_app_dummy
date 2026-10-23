import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("recommendations are separate from active rules and require explicit review", () => {
  const schema = read("backend/prisma/schema.prisma");
  const routes = read("backend/src/routes/rules.js");

  assert.match(schema, /model RuleRecommendation/);
  assert.match(schema, /status\s+String @default\("PENDING"\)/);
  assert.match(routes, /recommendations\/:id\/approve/);
  assert.match(routes, /recommendations\/:id\/reject/);
  assert.match(routes, /Only pending recommendations can be approved/);
  assert.match(routes, /RECOMMENDATION_REVIEW_ONLY/);
});

test("approved denial recommendation creates a disabled draft rule and requires separate activation", () => {
  const routes = read("backend/src/routes/rules.js");

  assert.match(routes, /source: "DENIAL_PATTERN"/);
  assert.match(routes, /enabled: false/);
  assert.match(routes, /activationRequired: true/);
  assert.doesNotMatch(
    routes,
    /DENIAL_PREVENTION_RECOMMENDATION_APPROVED[\s\S]{0,800}bumpRulesetAndInvalidate/
  );
});

test("Rules UI exposes evidence and never claims automatic activation", () => {
  const ui = read("frontend/src/modules/rules/Rules.jsx");

  assert.match(ui, /Denial Prevention Recommendations/);
  assert.match(ui, /Recommendations never activate automatically/);
  assert.match(ui, /Approve Draft/);
  assert.match(ui, /Draft rule created disabled/);
  assert.match(ui, /Review only/);
});


test("payer-name scoped rule invalidation never queries required payerName as null", () => {
  const lifecycle = read("backend/src/services/ruleLifecycle.js");
  assert.doesNotMatch(lifecycle, /payerName: null/);
  assert.match(lifecycle, /payerName: ""/);
});
