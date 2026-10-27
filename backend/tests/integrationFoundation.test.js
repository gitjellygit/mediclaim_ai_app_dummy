import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("integration foundation is organization scoped and idempotent by external event ID", () => {
  const schema = read("backend/prisma/schema.prisma");
  const route = read("backend/src/routes/integrations.js");

  assert.match(schema, /model IntegrationConnection/);
  assert.match(schema, /model ClaimExternalIdentity/);
  assert.match(schema, /model IntegrationEvent/);
  assert.match(schema, /@@unique\(\[connectionId, externalEventId\]\)/);
  assert.match(schema, /@@unique\(\[connectionId, externalClaimId\]\)/);

  assert.match(route, /organizationId: orgId\(req\)/);
  assert.match(route, /requirePermission\(PERMISSIONS\.INTEGRATION_VIEW\)/);
  assert.match(route, /requirePermission\(PERMISSIONS\.INTEGRATION_MANAGE\)/);
  assert.match(route, /requirePermission\(PERMISSIONS\.INTEGRATION_INGEST\)/);
  assert.match(route, /connectionId_externalEventId/);
  assert.match(route, /duplicate: true/);
  assert.match(route, /INTEGRATION_CLAIM_CORRELATION_CONFLICT/);
});

test("integration event boundary accepts correlation metadata but not raw claim payloads", () => {
  const route = read("backend/src/routes/integrations.js");

  assert.match(route, /const eventSchema = z\.object/);
  assert.match(route, /\.strict\(\)/);
  assert.doesNotMatch(route, /rawPayload/);
  assert.doesNotMatch(route, /clinicalPayload/);
  assert.match(route, /raw clinical or claim payloads are not accepted/);
  assert.match(route, /payloadHash: hashEvent\(normalized\)/);
});

test("integration connection changes and event correlation are audit-visible without external PHI identifiers in audit metadata", () => {
  const route = read("backend/src/routes/integrations.js");
  const audit = read("backend/src/services/auditLog.js");

  assert.match(route, /INTEGRATION_CONNECTION_CREATED/);
  assert.match(route, /INTEGRATION_HEALTH_UPDATED/);
  assert.match(route, /EXTERNAL_CLAIM_LINKED/);
  assert.match(route, /INTEGRATION_EVENT_RECORDED/);
  assert.match(audit, /integrationKind/);
  assert.match(audit, /correlatedToClaim/);
  assert.doesNotMatch(audit, /externalClaimId/);
});
