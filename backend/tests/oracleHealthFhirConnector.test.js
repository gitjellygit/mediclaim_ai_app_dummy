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

test("Oracle Health sync plan is patient-scoped and uses Oracle Coverage patient search", () => {
  const plan = oracleHealthPatientSyncPlan("12724067");
  assert.equal(plan[0].path, "Patient/12724067");
  assert.equal(
    plan.find((item) => item.name === "Coverage").path,
    "Coverage?patient=12724067"
  );
  assert.ok(plan.every((item) => item.name === "Patient" || item.path.includes("12724067")));
});

test("Oracle Health sync fetches billable ChargeItems for returned encounters", async () => {
  const seen = [];
  const snapshot = await fetchOracleHealthPatientSnapshot(
    { fhirBaseUrl: ORACLE_HEALTH_OPEN_SANDBOX.fhirBaseUrl },
    "12724067",
    async (url) => {
      seen.push(url);
      if (url.includes("/Patient/12724067")) {
        return response(200, { resourceType: "Patient", id: "12724067" });
      }
      if (url.includes("/Encounter?patient=")) {
        return response(200, {
          resourceType: "Bundle",
          type: "searchset",
          entry: [{ resource: { resourceType: "Encounter", id: "enc-1" } }]
        });
      }
      if (url.includes("/ChargeItem?context=enc-1&-status=billable")) {
        return response(200, {
          resourceType: "Bundle",
          type: "searchset",
          entry: [{ resource: { resourceType: "ChargeItem", id: "charge-1" } }]
        });
      }
      return response(200, { resourceType: "Bundle", type: "searchset", entry: [] });
    }
  );
  assert.ok(seen.some((url) => url.includes("/ChargeItem?context=enc-1&-status=billable")));
  assert.equal(snapshot.calls.find((item) => item.resource === "ChargeItem").status, "SUCCESS");
});


test("Oracle Health targeted billing demo fetches exact encounter and billable charges", async () => {
  const seen = [];
  const snapshot = await fetchOracleHealthPatientSnapshot(
    { fhirBaseUrl: ORACLE_HEALTH_OPEN_SANDBOX.fhirBaseUrl },
    "12742419",
    {
      encounterId: "97953601",
      fetchImpl: async (url) => {
        seen.push(url);
        if (url.includes("/Patient/12742419")) {
          return response(200, { resourceType: "Patient", id: "12742419" });
        }
        if (url.includes("/Encounter/97953601")) {
          return response(200, {
            resourceType: "Encounter",
            id: "97953601",
            subject: { reference: "Patient/12742419" }
          });
        }
        if (url.includes("/ChargeItem?context=97953601&-status=billable")) {
          return response(200, {
            resourceType: "Bundle",
            type: "searchset",
            entry: [{
              resource: {
                resourceType: "ChargeItem",
                id: "292870306",
                subject: { reference: "Patient/12742419" },
                context: { reference: "Encounter/97953601" }
              }
            }]
          });
        }
        return response(200, { resourceType: "Bundle", type: "searchset", entry: [] });
      }
    }
  );

  assert.ok(seen.some((url) => url.includes("/Encounter/97953601")));
  assert.ok(seen.some((url) => url.includes("/ChargeItem?context=97953601&-status=billable")));
  assert.ok(snapshot.resources.some((resource) =>
    resource?.resourceType === "Encounter" && resource.id === "97953601"
  ));
});
