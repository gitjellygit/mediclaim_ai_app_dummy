import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ORACLE_HEALTH_BILLING_DEMO_PATIENT_IDS,
  ORACLE_HEALTH_OPEN_SANDBOX,
  discoverOracleHealthBillableEncounters,
  discoverOracleHealthBillingDemos,
  fetchOracleHealthPatientSnapshot,
  oracleHealthPatientSearchPath,
  oracleHealthPatientSyncPlan,
  searchOracleHealthPatients,
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


test("Oracle patient search supports production identity filters", () => {
  const path = oracleHealthPatientSearchPath({
    family: "Smith",
    given: "Jane",
    birthdateFrom: "1980-01-01",
    birthdateTo: "1980-12-31",
    phone: "5551234567",
    email: "jane@example.com",
    postalCode: "12345",
    gender: "female",
    exactName: true,
    count: 50
  });
  const query = new URL("https://example.test/" + path).searchParams;
  assert.equal(query.get("family:exact"), "Smith");
  assert.equal(query.get("given:exact"), "Jane");
  assert.deepEqual(query.getAll("birthdate"), ["ge1980-01-01", "le1980-12-31"]);
  assert.equal(query.get("phone"), "5551234567");
  assert.equal(query.get("email"), "jane@example.com");
  assert.equal(query.get("address-postalcode"), "12345");
  assert.equal(query.get("gender"), "female");
  assert.equal(query.get("_count"), "50");
});

test("Oracle patient search supports FHIR id and system-qualified identifier", () => {
  const path = oracleHealthPatientSearchPath({
    patientId: "12742419",
    identifier: "MRN-100",
    identifierSystem: "urn:oid:1.2.3"
  });
  const query = new URL("https://example.test/" + path).searchParams;
  assert.equal(query.get("_id"), "12742419");
  assert.equal(query.get("identifier"), "urn:oid:1.2.3|MRN-100");
});

test("Oracle patient search rejects unsupported ambiguous combinations", () => {
  assert.throws(
    () => oracleHealthPatientSearchPath({ given: "Jane" }),
    /requires family name/
  );
  assert.throws(
    () => oracleHealthPatientSearchPath({ name: "Jane Smith", family: "Smith" }),
    /either full name or first\/last name/
  );
  assert.throws(
    () => oracleHealthPatientSearchPath({ identifier: "MRN-100" }),
    /identifier system/
  );
  assert.throws(
    () => oracleHealthPatientSearchPath({
      birthdate: "1980-01-01",
      birthdateFrom: "1979-01-01"
    }),
    /either exact birth date or a birth date range/
  );
});

test("Oracle patient search returns compact selectable patient results", async () => {
  const result = await searchOracleHealthPatients(
    { fhirBaseUrl: ORACLE_HEALTH_OPEN_SANDBOX.fhirBaseUrl },
    { name: "Jane", count: 20 },
    async () => response(200, {
      resourceType: "Bundle",
      type: "searchset",
      total: 1,
      entry: [{
        resource: {
          resourceType: "Patient",
          id: "p-1",
          active: true,
          name: [{ use: "official", given: ["Jane"], family: "Smith" }],
          birthDate: "1980-01-01",
          gender: "female",
          identifier: [{
            system: "urn:oid:1.2.3",
            value: "MRN-100",
            type: { text: "MRN" }
          }],
          telecom: [
            { system: "phone", value: "5551234567" },
            { system: "email", value: "jane@example.com" }
          ],
          address: [{
            use: "home",
            line: ["1 Main St"],
            city: "Denver",
            state: "CO",
            postalCode: "80202"
          }]
        }
      }]
    })
  );
  assert.equal(result.count, 1);
  assert.equal(result.items[0].name, "Jane Smith");
  assert.equal(result.items[0].identifiers[0].value, "MRN-100");
  assert.equal(result.items[0].phones[0], "5551234567");
  assert.equal(result.items[0].address.city, "Denver");
});


test("Oracle billable encounter discovery returns only positive-charge visits as billable", async () => {
  const seen = [];
  const result = await discoverOracleHealthBillableEncounters(
    { fhirBaseUrl: ORACLE_HEALTH_OPEN_SANDBOX.fhirBaseUrl },
    "p-1",
    {
      count: 10,
      fetchImpl: async (url) => {
        seen.push(url);
        if (url.includes("/Encounter?patient=p-1")) {
          return response(200, {
            resourceType: "Bundle",
            type: "searchset",
            entry: [
              { resource: { resourceType: "Encounter", id: "e-1", status: "finished", period: { start: "2026-01-01T10:00:00Z" } } },
              { resource: { resourceType: "Encounter", id: "e-2", status: "finished", period: { start: "2026-01-02T10:00:00Z" } } }
            ]
          });
        }
        if (url.includes("ChargeItem?context=e-1")) {
          return response(200, {
            resourceType: "Bundle",
            type: "searchset",
            entry: [{
              resource: {
                resourceType: "ChargeItem",
                id: "c-1",
                quantity: { value: 1 },
                extension: [{
                  url: "https://fhir-ehr.cerner.com/r4/StructureDefinition/unit-price",
                  valueMoney: { value: 125, currency: "USD" }
                }]
              }
            }]
          });
        }
        return response(200, { resourceType: "Bundle", type: "searchset", entry: [] });
      }
    }
  );

  assert.ok(seen.some((url) => url.includes("status=finished")));
  assert.equal(result.encounterCount, 2);
  assert.equal(result.billableCount, 1);
  assert.equal(result.items.find((item) => item.id === "e-1").totalBilledAmount, 125);
  assert.equal(result.items.find((item) => item.id === "e-1").billable, true);
  assert.equal(result.items.find((item) => item.id === "e-2").billable, false);
});


test("Oracle billing demo discovery returns only currently billable visits with patient context", async () => {
  const result = await discoverOracleHealthBillingDemos(
    {
      fhirBaseUrl: ORACLE_HEALTH_OPEN_SANDBOX.fhirBaseUrl,
      billingDemoPatientIds: ["p-1", "p-2"]
    },
    {
      fetchImpl: async (url) => {
        if (url.includes("/Patient/p-1")) {
          return response(200, {
            resourceType: "Patient",
            id: "p-1",
            name: [{ given: ["Demo"], family: "One" }]
          });
        }
        if (url.includes("/Patient/p-2")) {
          return response(200, {
            resourceType: "Patient",
            id: "p-2",
            name: [{ given: ["Demo"], family: "Two" }]
          });
        }
        if (url.includes("/Encounter?patient=p-1")) {
          return response(200, {
            resourceType: "Bundle",
            entry: [{
              resource: {
                resourceType: "Encounter",
                id: "enc-1",
                status: "finished",
                period: { start: "2026-10-01T10:00:00Z" }
              }
            }]
          });
        }
        if (url.includes("/Encounter?patient=p-2")) {
          return response(200, {
            resourceType: "Bundle",
            entry: [{
              resource: {
                resourceType: "Encounter",
                id: "enc-2",
                status: "finished",
                period: { start: "2026-10-02T10:00:00Z" }
              }
            }]
          });
        }
        if (url.includes("ChargeItem?context=enc-1")) {
          return response(200, {
            resourceType: "Bundle",
            entry: [{
              resource: {
                resourceType: "ChargeItem",
                id: "charge-1",
                quantity: { value: 2 },
                extension: [{
                  url: "https://fhir-ehr.cerner.com/r4/StructureDefinition/unit-price",
                  valueMoney: { value: 75, currency: "USD" }
                }]
              }
            }]
          });
        }
        return response(200, { resourceType: "Bundle", entry: [] });
      }
    }
  );

  assert.equal(result.seedPatientCount, 2);
  assert.equal(result.count, 1);
  assert.equal(result.items[0].patient.name, "Demo One");
  assert.equal(result.items[0].patientId, "p-1");
  assert.equal(result.items[0].encounterId, "enc-1");
  assert.equal(result.items[0].chargeCount, 1);
  assert.equal(result.items[0].totalBilledAmount, 150);
});

test("Oracle billing demo browser hides seed IDs from the user-facing button catalog", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const ui = fs.readFileSync(
    path.join(root, "frontend/src/modules/ai-claims/ClaimsList.jsx"),
    "utf8"
  );
  const route = fs.readFileSync(
    path.join(root, "backend/src/routes/integrations.js"),
    "utf8"
  );
  const env = fs.readFileSync(path.join(root, "backend/.env.example"), "utf8");

  assert.match(ui, /Oracle Billing Demos/);
  assert.match(ui, /Live billable visits discovered from the Oracle Health public sandbox/);
  assert.match(ui, /Billing lines/);
  assert.match(ui, /Use Visit/);
  assert.doesNotMatch(ui, /Chip Johnson/);
  assert.doesNotMatch(ui, /ChargeItem 321088041/);
  assert.doesNotMatch(ui, /12742419/);
  assert.doesNotMatch(ui, /12768550/);
  assert.match(route, /oracle-health\/billing-demos/);
  assert.match(env, /ORACLE_HEALTH_SANDBOX_BILLING_DEMO_PATIENT_IDS=/);
  assert.deepEqual(ORACLE_HEALTH_BILLING_DEMO_PATIENT_IDS, ["12742419", "12768550"]);
});
