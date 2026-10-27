import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import {
  EPIC_SANDBOX,
  createEpicClientAssertion,
  epicConfigurationStatus,
  epicPatientSyncPlan,
  epicPublicJwks,
  fetchEpicPatientSnapshot,
  requestEpicAccessToken
} from "../src/services/epicFhirConnector.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

function rsaConfig() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048
  });
  return {
    config: {
      environment: "SANDBOX",
      fhirBaseUrl: EPIC_SANDBOX.fhirBaseUrl,
      tokenUrl: EPIC_SANDBOX.tokenUrl,
      clientId: "synthetic-client-id",
      jkuUrl: "https://example.test/.well-known/jwks.json",
      keyId: "test-key-1",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" })
    },
    publicKey: publicKey.export({ type: "spki", format: "pem" })
  };
}

test("Epic sandbox defaults match current Epic R4 and OAuth endpoints", () => {
  assert.equal(
    EPIC_SANDBOX.fhirBaseUrl,
    "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/"
  );
  assert.equal(
    EPIC_SANDBOX.tokenUrl,
    "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token"
  );
});

test("Epic backend client assertion uses RS384, JKU, kid and client identity", () => {
  const { config, publicKey } = rsaConfig();
  const assertion = createEpicClientAssertion(config, 1_800_000_000_000);
  const decoded = jwt.decode(assertion, { complete: true });

  assert.equal(decoded.header.alg, "RS384");
  assert.equal(decoded.header.kid, "test-key-1");
  assert.equal(decoded.header.jku, config.jkuUrl);
  assert.equal(decoded.payload.iss, config.clientId);
  assert.equal(decoded.payload.sub, config.clientId);
  assert.equal(decoded.payload.aud, config.tokenUrl);
  assert.ok(decoded.payload.jti);

  const verified = jwt.verify(assertion, publicKey, {
    algorithms: ["RS384"],
    audience: config.tokenUrl,
    issuer: config.clientId,
    subject: config.clientId,
    clockTimestamp: 1_800_000_000
  });
  assert.equal(verified.iss, config.clientId);
});

test("Epic OAuth exchange sends client_credentials JWT bearer request", async () => {
  const { config } = rsaConfig();
  let seen = null;

  const token = await requestEpicAccessToken(config, async (url, options) => {
    seen = { url, options };
    return response(200, {
      access_token: "synthetic-access-token",
      token_type: "bearer",
      expires_in: 3600,
      scope: "Patient.read Patient.search"
    });
  });

  assert.equal(seen.url, config.tokenUrl);
  assert.equal(seen.options.method, "POST");
  assert.match(String(seen.options.body), /grant_type=client_credentials/);
  assert.match(String(seen.options.body), /client_assertion_type=/);
  assert.equal(token.accessToken, "synthetic-access-token");
  assert.equal(token.expiresIn, 3600);
});

test("Epic patient sync requires Patient and treats unsupported optional APIs as skipped", async () => {
  const { config } = rsaConfig();
  const calls = [];

  const snapshot = await fetchEpicPatientSnapshot(
    config,
    "synthetic-patient-1",
    async (url, options) => {
      calls.push({ url, options });

      if (url === config.tokenUrl) {
        return response(200, {
          access_token: "token",
          token_type: "bearer",
          expires_in: 3600,
          scope: "Patient.read Appointment.search Encounter.search"
        });
      }

      if (url.includes("/Patient/synthetic-patient-1")) {
        return response(200, {
          resourceType: "Patient",
          id: "synthetic-patient-1",
          name: [{ given: ["Synthetic"], family: "Patient" }],
          birthDate: "1980-01-01"
        });
      }

      if (url.includes("/Appointment?patient=")) {
        return response(200, {
          resourceType: "Bundle",
          type: "searchset",
          entry: [
            {
              resource: {
                resourceType: "Appointment",
                id: "appt-1",
                status: "booked",
                start: "2026-11-01T10:00:00Z"
              }
            }
          ]
        });
      }

      if (url.includes("/Encounter?patient=")) {
        return response(200, {
          resourceType: "Bundle",
          type: "searchset",
          entry: []
        });
      }

      return response(403, {
        resourceType: "OperationOutcome",
        issue: [{ severity: "error", code: "forbidden" }]
      });
    }
  );

  assert.equal(snapshot.calls.find((item) => item.resource === "Patient").status, "SUCCESS");
  assert.equal(snapshot.calls.find((item) => item.resource === "Appointment").count, 1);
  assert.equal(snapshot.calls.find((item) => item.resource === "Coverage").status, "SKIPPED");
  assert.ok(snapshot.resources.some((item) => item.resourceType === "Patient"));
  assert.ok(snapshot.resources.some((item) => item.resourceType === "Bundle"));
  assert.ok(calls.some((item) => item.options?.headers?.Authorization === "Bearer token"));
});

test("Epic sync plan is patient-scoped and avoids broad population pulls", () => {
  const plan = epicPatientSyncPlan("synthetic-patient-1");
  assert.equal(plan[0].path, "Patient/synthetic-patient-1");
  assert.ok(plan.every((item) =>
    item.name === "Patient" || item.path.includes("synthetic-patient-1")
  ));
});

test("Epic configuration status never exposes private-key material", () => {
  const status = epicConfigurationStatus("SANDBOX");
  assert.equal("privateKey" in status, false);
  assert.equal("clientId" in status, false);
  assert.equal(typeof status.privateKeyConfigured, "boolean");
});

test("Integration Hub exposes Epic test/sync routes and UI controls", () => {
  const route = read("backend/src/routes/integrations.js");
  const api = read("frontend/src/api/integrations.js");
  const ui = read("frontend/src/modules/integrations/IntegrationHub.jsx");
  const env = read("backend/.env.example");

  assert.match(route, /\/:id\/epic\/status/);
  assert.match(route, /\/:id\/epic\/test/);
  assert.match(route, /\/:id\/epic\/sync/);
  assert.match(route, /EPIC_SYNTHETIC_PATIENT_SYNCED/);
  assert.match(api, /epicStatus/);
  assert.match(api, /testEpic/);
  assert.match(api, /syncEpic/);
  assert.match(ui, /Test Epic Connection/);
  assert.match(ui, /Sync Synthetic Patient/);
  assert.match(env, /EPIC_SANDBOX_CLIENT_ID=/);
  assert.match(env, /EPIC_PRODUCTION_CLIENT_ID=/);
});


test("Epic public JWKS publishes only public signing material", () => {
  const original = {
    privateKey: process.env.EPIC_SANDBOX_PRIVATE_KEY,
    kid: process.env.EPIC_SANDBOX_JWK_KID
  };
  const { config } = rsaConfig();

  process.env.EPIC_SANDBOX_PRIVATE_KEY = String(config.privateKey);
  process.env.EPIC_SANDBOX_JWK_KID = "sandbox-public-kid";
  try {
    const jwks = epicPublicJwks();
    const key = jwks.keys.find((item) => item.kid === "sandbox-public-kid");
    assert.ok(key);
    assert.equal(key.kty, "RSA");
    assert.equal(key.alg, "RS384");
    assert.equal(key.use, "sig");
    assert.equal("d" in key, false);
    assert.equal("p" in key, false);
    assert.equal("q" in key, false);
  } finally {
    if (original.privateKey == null) delete process.env.EPIC_SANDBOX_PRIVATE_KEY;
    else process.env.EPIC_SANDBOX_PRIVATE_KEY = original.privateKey;
    if (original.kid == null) delete process.env.EPIC_SANDBOX_JWK_KID;
    else process.env.EPIC_SANDBOX_JWK_KID = original.kid;
  }
});

test("PRISM exposes the Epic JWKS endpoint before authenticated API routes", () => {
  const index = read("backend/src/index.js");
  assert.match(index, /\.well-known\/jwks\.json/);
  assert.match(index, /epicPublicJwks\(\)/);
  assert.match(index, /Cache-Control/);
  assert.ok(
    index.indexOf('/.well-known/jwks.json') <
      index.indexOf('app.use("/api/auth"')
  );
});
