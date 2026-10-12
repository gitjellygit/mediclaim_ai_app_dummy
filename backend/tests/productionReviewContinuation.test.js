import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPayerConnectors } from "../src/services/payerGateway.js";
import { createStediProductionConnector } from "../src/services/stediTestConnector.js";
import {
  writeAuditEvent,
  writeCriticalAuditEvent
} from "../src/services/auditLog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

test("production ERA is independently gated by tenant isolation", async () => {
  const baseEnv = {
    STEDI_PRODUCTION_API_KEY: "prod-key",
    STEDI_PRODUCTION_PHI_CONFIRMED: "true"
  };
  const disabled = listPayerConnectors(baseEnv).find(
    (item) => item.id === "STEDI_PRODUCTION"
  );
  assert.equal(disabled?.configured, true);
  assert.equal(disabled?.capabilities.includes("getRemittance"), false);

  const enabled = listPayerConnectors({
    ...baseEnv,
    STEDI_PRODUCTION_ERA_TENANT_ISOLATION_CONFIRMED: "true"
  }).find((item) => item.id === "STEDI_PRODUCTION");
  assert.equal(enabled?.capabilities.includes("getRemittance"), true);

  const connector = createStediProductionConnector({
    env: baseEnv,
    fetchImpl: async () => {
      throw new Error("network must not be reached");
    }
  });

  await assert.rejects(
    () => connector.getRemittance({ patientControlNumber: "PCN-1" }),
    (error) =>
      error?.code === "PAYER_CONNECTOR_UNAVAILABLE" &&
      /tenant isolation/i.test(error.message)
  );
});

test("ERA discovery and tenant lists are bounded", () => {
  const stedi = read("backend/src/services/stediTestConnector.js");
  const claims = read("backend/src/routes/claims.js");
  const documents = read("backend/src/routes/documents.js");

  assert.match(stedi, /ERA_DISCOVERY_DEADLINE_MS = 20000/);
  assert.match(stedi, /ERA_DISCOVERY_MAX_PAGES = 3/);
  assert.match(stedi, /ERA_DISCOVERY_MAX_CANDIDATES = 20/);
  assert.match(stedi, /pageToken/);
  assert.match(claims, /take: pageSize/);
  assert.match(claims, /X-Total-Count/);
  assert.match(documents, /take: pageSize/);
  assert.match(documents, /X-Total-Count/);
});

test("critical audit writes fail closed while normal telemetry remains best effort", async () => {
  const failingPrisma = {
    auditEvent: {
      async create() {
        throw new Error("audit database unavailable");
      }
    }
  };
  const event = {
    organizationId: "org-1",
    action: "TEST",
    entityType: "Test"
  };

  assert.equal(await writeAuditEvent(failingPrisma, event), null);
  await assert.rejects(
    () => writeCriticalAuditEvent(failingPrisma, event),
    /audit database unavailable/
  );

  const auditRoute = read("backend/src/routes/audit.js");
  assert.match(auditRoute, /writeCriticalRequestAudit/);
  assert.match(auditRoute, /AUDIT_TRAIL_EXPORTED/);
});

test("security supply-chain and migration rehearsal files are present", () => {
  const workflow = read(".github/workflows/claim-app-tests.yml");
  const codeql = read(".github/workflows/codeql.yml");
  const dependabot = read(".github/dependabot.yml");
  const runbook = read("docs/MIGRATION_REHEARSAL.md");

  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(codeql, /github\/codeql-action\/analyze@v4/);
  assert.match(dependabot, /package-ecosystem: "npm"/);
  assert.match(runbook, /representative existing data/);
});
