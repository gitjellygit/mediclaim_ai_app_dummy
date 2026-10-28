import test from "node:test";
import assert from "node:assert/strict";
import {
  ORACLE_HEALTH_OPEN_SANDBOX,
  fetchOracleHealthPatientSnapshot,
  oracleHealthPatientSyncPlan,
  testOracleHealthConnection
} from "../src/services/oracleHealthFhirConnector.js";

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

test("Oracle Health open sandbox uses documented Millennium R4 endpoint", () => {
  assert.equal(
    ORACLE_HEALTH_OPEN_SANDBOX.fhirBaseUrl,
    "https://fhir-open.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d"
  );
});

test("Oracle Health connection test uses CapabilityStatement without auth", async () => {
  let seen;
  const result = await testOracleHealthConnection(
    { fhirBaseUrl: ORACLE_HEALTH_OPEN_SANDBOX.fhirBaseUrl },
    async (url, options) => {
      seen = { url, options };
      return response(200, { resourceType: "CapabilityStatement", fhirVersion: "4.0.1" });
    }
  );
  assert.match(seen.url, /\/metadata$/);
  assert.equal(seen.options.headers.Authorization, undefined);
  assert.equal(result.ok, true);
});

test("Oracle Health patient sync requires Patient and skips unsupported optional APIs", async () => {
  const snapshot = await fetchOracleHealthPatientSnapshot(
    { fhirBaseUrl: ORACLE_HEALTH_OPEN_SANDBOX.fhirBaseUrl },
    "12724067",
    async (url) => {
      if (url.includes("/Patient/12724067")) {
        return response(200, { resourceType: "Patient", id: "12724067" });
      }
      if (url.includes("/Encounter?patient=")) {
        return response(200, { resourceType: "Bundle", type: "searchset", entry: [] });
      }
      return response(403, { resourceType: "OperationOutcome" });
    }
  );
  assert.equal(snapshot.calls.find((x) => x.resource === "Patient").status, "SUCCESS");
  assert.equal(snapshot.calls.find((x) => x.resource === "Coverage").status, "SKIPPED");
});

test("Oracle Health sync plan is patient-scoped", () => {
  const plan = oracleHealthPatientSyncPlan("12724067");
  assert.equal(plan[0].path, "Patient/12724067");
  assert.ok(plan.every((item) => item.name === "Patient" || item.path.includes("12724067")));
});
