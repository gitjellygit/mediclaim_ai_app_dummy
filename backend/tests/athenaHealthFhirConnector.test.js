import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ATHENAHEALTH_PREVIEW,
  athenaHealthConfigurationStatus,
  athenaHealthPatientSearchPath,
  fetchAthenaHealthPatientSnapshot,
  requestAthenaHealthAccessToken,
  searchAthenaHealthPatients
} from "../src/services/athenaHealthFhirConnector.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

function config() {
  return {
    environment: "SANDBOX",
    fhirBaseUrl: ATHENAHEALTH_PREVIEW.fhirBaseUrl,
    tokenUrl: ATHENAHEALTH_PREVIEW.tokenUrl,
    clientId: "synthetic-athena-client",
    clientSecret: "synthetic-athena-secret",
    scope: ATHENAHEALTH_PREVIEW.scope
  };
}

test("athenahealth preview defaults use documented preview API surfaces", () => {
  assert.equal(ATHENAHEALTH_PREVIEW.fhirBaseUrl, "https://preview.api.fhir.athena.io/fhir/r4");
  assert.equal(ATHENAHEALTH_PREVIEW.tokenUrl, "https://api.preview.platform.athenahealth.com/oauth2/v1/token");
  assert.equal(ATHENAHEALTH_PREVIEW.scope, "athena/service/Athenanet.MDP.*");
});

test("athenahealth client credentials request uses Basic auth and configured scope", async () => {
  let seen;
  const token = await requestAthenaHealthAccessToken(config(), async (url, options) => {
    seen = { url, options };
    return response(200, {
      access_token: "athena-token",
      token_type: "Bearer",
      expires_in: 3600,
      scope: ATHENAHEALTH_PREVIEW.scope
    });
  });

  assert.equal(seen.url, ATHENAHEALTH_PREVIEW.tokenUrl);
  assert.equal(seen.options.method, "POST");
  assert.match(seen.options.headers.Authorization, /^Basic /);
  assert.match(String(seen.options.body), /grant_type=client_credentials/);
  assert.match(String(seen.options.body), /scope=athena%2Fservice%2FAthenanet.MDP/);
  assert.equal(token.accessToken, "athena-token");
});

test("athenahealth patient search returns compact selectable FHIR patients", async () => {
  const calls = [];
  const result = await searchAthenaHealthPatients(
    config(),
    { family: "Smith", given: "Jane", count: 10 },
    async (url, options) => {
      calls.push({ url, options });
      if (url === ATHENAHEALTH_PREVIEW.tokenUrl) {
        return response(200, { access_token: "token", expires_in: 3600 });
      }
      return response(200, {
        resourceType: "Bundle",
        total: 1,
        entry: [{
          resource: {
            resourceType: "Patient",
            id: "a-432.E-17",
            name: [{ given: ["Jane"], family: "Smith" }],
            birthDate: "1980-01-01",
            identifier: [{ system: "urn:athena:mrn", value: "MRN-17", type: { text: "MRN" } }]
          }
        }]
      });
    }
  );

  assert.equal(result.count, 1);
  assert.equal(result.items[0].id, "a-432.E-17");
  assert.equal(result.items[0].name, "Jane Smith");
  assert.ok(calls.some((item) => item.url.includes("Patient?")));
  assert.ok(calls.some((item) => item.options?.headers?.Authorization === "Bearer token"));
});

test("athenahealth FHIR sync requires Patient and skips optional unsupported resources", async () => {
  const snapshot = await fetchAthenaHealthPatientSnapshot(
    config(),
    "a-432.E-17",
    async (url) => {
      if (url === ATHENAHEALTH_PREVIEW.tokenUrl) {
        return response(200, { access_token: "token", expires_in: 3600 });
      }
      if (url.includes("/Patient/a-432.E-17")) {
        return response(200, { resourceType: "Patient", id: "a-432.E-17" });
      }
      return response(403, { resourceType: "OperationOutcome" });
    }
  );

  assert.equal(snapshot.calls.find((item) => item.resource === "Patient").status, "SUCCESS");
  assert.equal(snapshot.calls.find((item) => item.resource === "Coverage").status, "SKIPPED");
  assert.ok(snapshot.resources.some((item) => item.resourceType === "Patient"));
});

test("athenahealth foundation is wired through Integration Hub without pretending billing is enabled", () => {
  const route = read("backend/src/routes/integrations.js");
  const api = read("frontend/src/api/integrations.js");
  const hub = read("frontend/src/modules/integrations/IntegrationHub.jsx");
  const claims = read("frontend/src/modules/ai-claims/ClaimsList.jsx");
  const env = read("backend/.env.example");

  assert.match(route, /\/:id\/athenahealth\/status/);
  assert.match(route, /\/:id\/athenahealth\/test/);
  assert.match(route, /\/:id\/athenahealth\/sync/);
  assert.match(route, /ATHENAHEALTH_PATIENT_SYNCED/);
  assert.match(api, /athenaHealthStatus/);
  assert.match(api, /syncAthenaHealth/);
  assert.match(hub, /athenahealth FHIR Connection/);
  assert.match(hub, /Billing, statements, payment plans/);
  assert.match(claims, /Sync Patient Data/);
  assert.match(claims, /billing import is intentionally not enabled yet/i);
  assert.match(env, /ATHENAHEALTH_SANDBOX_CLIENT_ID=/);
  assert.equal(athenaHealthConfigurationStatus("SANDBOX").billingApiEnabled, false);
});

test("athenahealth search supports standard FHIR identity filters", () => {
  const pathValue = athenaHealthPatientSearchPath({
    patientId: "a-432.E-17",
    identifier: "MRN-17",
    identifierSystem: "urn:athena:mrn",
    family: "Smith",
    given: "Jane",
    birthdate: "1980-01-01"
  });
  const query = new URL("https://example.test/" + pathValue).searchParams;
  assert.equal(query.get("_id"), "a-432.E-17");
  assert.equal(query.get("identifier"), "urn:athena:mrn|MRN-17");
  assert.equal(query.get("family"), "Smith");
  assert.equal(query.get("given"), "Jane");
  assert.equal(query.get("birthdate"), "1980-01-01");
});
