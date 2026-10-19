import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Rules v1 stores governed metadata and soft deletion", () => {
  const schema = read("backend/prisma/schema.prisma");
  const migration = read("backend/prisma/migrations/20261016211500_rules_policy_engine/migration.sql");

  assert.match(schema, /model Rule[\s\S]*category\s+String/);
  assert.match(schema, /systemManaged\s+Boolean/);
  assert.match(schema, /mandatory\s+Boolean/);
  assert.match(schema, /scope\s+String/);
  assert.match(schema, /payerEdiId\s+String\?/);
  assert.match(schema, /definition\s+Json\?/);
  assert.match(schema, /effectiveFrom\s+DateTime\?/);
  assert.match(schema, /deletedAt\s+DateTime\?/);
  assert.match(migration, /UPDATE "Rule"[\s\S]*"systemManaged" = true/);
});

test("Rules v1 route exposes catalog, validates definitions and audits changes", () => {
  const route = read("backend/src/routes/rules.js");

  assert.match(route, /router\.get\("\/meta"/);
  assert.match(route, /CUSTOM_RULE_FIELDS/);
  assert.match(route, /Payer-scoped rules require payer name or payer EDI ID/);
  assert.match(route, /Mandatory system rules cannot be changed/);
  assert.match(route, /System-managed rules cannot be deleted/);
  assert.match(route, /writeCriticalRequestAudit/);
  assert.match(route, /deletedAt: new Date\(\)/);
});

test("Custom rules are evaluated during live claim readiness", () => {
  const claims = read("backend/src/routes/claims.js");
  assert.match(claims, /evaluateConfiguredRules/);
  assert.match(claims, /deletedAt: null/);
  assert.match(claims, /issues\.push\(\.\.\.evaluateConfiguredRules\(claim, rules\)\)/);
});

test("Rules admin UI uses the governed rule builder and external-source catalog", () => {
  const api = read("frontend/src/api/claims.js");
  const rules = read("frontend/src/modules/rules/Rules.jsx");
  const form = read("frontend/src/modules/rules/RuleForm.jsx");

  assert.match(api, /getRulesMeta\(\)/);
  assert.match(api, /createRule\(data\)/);
  assert.match(rules, /Rule Coverage/);
  assert.match(rules, /External Rule Sources/);
  assert.match(rules, /Mandatory system safeguards cannot be disabled/);
  assert.match(form, /Apply this rule only when another claim condition is true/);
  assert.match(form, /Payer EDI ID/);
  assert.match(form, /Effective From/);
});


test("Rules v1 hardening stores immutable history and ruleset fingerprints", () => {
  const schema = read("backend/prisma/schema.prisma");
  const migration = read("backend/prisma/migrations/20261019190000_rules_v1_hardening/migration.sql");
  const lifecycle = read("backend/src/services/ruleLifecycle.js");

  assert.match(schema, /rulesetRevision\s+Int/);
  assert.match(schema, /rulesetFingerprint\s+String\?/);
  assert.match(schema, /model RuleVersion/);
  assert.match(schema, /revision\s+Int/);
  assert.match(migration, /CREATE TABLE "RuleVersion"/);
  assert.match(lifecycle, /rulesetFingerprint/);
  assert.match(lifecycle, /createHash\("sha256"\)/);
  assert.match(lifecycle, /READY/);
  assert.match(lifecycle, /NEEDS_REVIEW/);
});

test("Rules v1 hardening provides typed validation simulation and history APIs", () => {
  const route = read("backend/src/routes/rules.js");
  const catalog = read("backend/src/services/ruleCatalog.js");

  assert.match(route, /router\.post\("\/simulate"/);
  assert.match(route, /router\.get\("\/:id\/versions"/);
  assert.match(route, /operatorsForField/);
  assert.match(route, /writeRuleVersion/);
  assert.match(route, /bumpRulesetAndInvalidate/);
  assert.match(route, /immutable identities/i);
  assert.match(catalog, /OPERATORS_BY_FIELD_TYPE/);
  assert.doesNotMatch(catalog, /\{ id: "MATCHES", label:/);
  assert.match(catalog, /ON_OR_AFTER/);
  assert.match(catalog, /daysUntilFilingDeadline/);
});

test("Rules v1 hardening blocks stale rulesets at submission", () => {
  const claims = read("backend/src/routes/claims.js");

  assert.match(claims, /rulesetFingerprint\(rules, claim/);
  assert.match(claims, /rulesetFingerprint: evaluatedRulesetFingerprint/);
  assert.match(claims, /rulesetFreshness/);
  assert.match(claims, /READINESS_RULESET_STALE/);
});

test("Rules admin UI exposes impact preview and immutable revision history", () => {
  const api = read("frontend/src/api/claims.js");
  const form = read("frontend/src/modules/rules/RuleForm.jsx");

  assert.match(api, /simulateRule\(data\)/);
  assert.match(api, /getRuleVersions\(id\)/);
  assert.match(form, /Test Against Claims/);
  assert.match(form, /Impact preview/);
  assert.match(form, /Version History/);
  assert.match(form, /Length range \(min,max\)/);
});
