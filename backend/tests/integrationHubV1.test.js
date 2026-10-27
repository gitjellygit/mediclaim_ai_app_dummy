import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  integrationAdapterCatalog,
  normalizeIntegrationPayload
} from "../src/services/integrationAdapters.js";
import {
  canMaterializeCanonicalClaim,
  claimPatchFromCanonical
} from "../src/services/integrationClaimMaterializer.js";
import { PERMISSIONS, permissionsForRole } from "../src/security/permissions.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Integration Hub exposes vendor-neutral FHIR HL7 and canonical adapters", () => {
  const catalog = integrationAdapterCatalog();
  assert.deepEqual(
    catalog.map((item) => item.id),
    ["FHIR_R4", "HL7_V2", "CANONICAL_JSON"]
  );
  assert.ok(catalog.find((item) => item.id === "FHIR_R4").resourceTypes.includes("COVERAGE"));
  assert.ok(catalog.find((item) => item.id === "HL7_V2").transports.includes("SFTP"));
});

test("FHIR R4 bundle normalizes patient coverage appointment order and clinical evidence", () => {
  const records = normalizeIntegrationPayload("FHIR_R4", {
    resourceType: "Bundle",
    type: "collection",
    entry: [
      {
        resource: {
          resourceType: "Patient",
          id: "patient-1",
          name: [{ given: ["Jordan"], family: "Lee" }],
          birthDate: "1985-02-03",
          gender: "female",
          identifier: [{ system: "urn:mrn", value: "MRN-1" }]
        }
      },
      {
        resource: {
          resourceType: "Coverage",
          id: "coverage-1",
          status: "active",
          subscriberId: "MEM-1",
          beneficiary: { reference: "Patient/patient-1" },
          payor: [{ reference: "Organization/payer-1" }],
          period: { start: "2026-01-01", end: "2026-12-31" }
        }
      },
      {
        resource: {
          resourceType: "Appointment",
          id: "appt-1",
          status: "booked",
          start: "2026-11-03T14:00:00Z",
          participant: [{ actor: { reference: "Patient/patient-1" }, status: "accepted" }]
        }
      },
      {
        resource: {
          resourceType: "ServiceRequest",
          id: "order-1",
          status: "active",
          intent: "order",
          subject: { reference: "Patient/patient-1" },
          code: { coding: [{ system: "http://www.ama-assn.org/go/cpt", code: "72148" }] }
        }
      },
      {
        resource: {
          resourceType: "DocumentReference",
          id: "docref-1",
          status: "current",
          subject: { reference: "Patient/patient-1" },
          type: { coding: [{ system: "http://loinc.org", code: "34109-9", display: "Note" }] }
        }
      }
    ]
  });

  assert.deepEqual(
    records.map((item) => item.resourceType),
    ["PATIENT", "COVERAGE", "APPOINTMENT", "ORDER", "CLINICAL_EVIDENCE"]
  );
  assert.equal(records[0].data.name, "Jordan Lee");
  assert.equal(records[1].data.subscriberId, "MEM-1");
  assert.equal(records[3].data.code.code, "72148");
});

test("HL7 v2 normalizes PID PV1 OBR and FT1 into canonical records", () => {
  const message = [
    "MSH|^~\\&|EHR|HOSP|PRISM|RCM|202610271200||ADT^A01|MSG-100|P|2.5.1",
    "PID|1||MRN-100^^^HOSP^MR||Doe^Alex||19800115|M",
    "PV1|1|O|CLINIC^^^HOSP||||1234567890^Smith^Robin||||||||||||VISIT-100",
    "OBR|1|ORD-100|FILL-100|72148^MRI Lumbar Spine^CPT||20261101",
    "FT1|1|TX-100||20261101|||72148^MRI Lumbar Spine^CPT|||1|750.00"
  ].join("\r");

  const records = normalizeIntegrationPayload("HL7_V2", message);
  assert.ok(records.some((item) => item.resourceType === "PATIENT" && item.externalId === "MRN-100"));
  assert.ok(records.some((item) => item.resourceType === "ENCOUNTER"));
  assert.ok(records.some((item) => item.resourceType === "ORDER"));
  assert.ok(records.some((item) => item.resourceType === "CHARGE"));
});

test("canonical JSON supports source adapters without coupling business logic to vendors", () => {
  const [record] = normalizeIntegrationPayload("CANONICAL_JSON", {
    resourceType: "CLAIM",
    externalId: "ehr-claim-42",
    sourceType: "ATHENA_REST",
    data: {
      patientName: "Avery Morgan",
      payerName: "Blue Horizon Health",
      amount: 425.5,
      memberId: "M-42",
      billingProviderNpi: "1234567890"
    }
  });

  assert.equal(record.resourceType, "CLAIM");
  assert.equal(record.sourceType, "ATHENA_REST");
  assert.equal(record.data.amount, 425.5);
});

test("claim materialization requires real minimum billing data and never fabricates it", () => {
  assert.equal(canMaterializeCanonicalClaim({
    patientName: "Avery Morgan",
    payerName: "Blue Horizon Health",
    amount: 425
  }), true);

  assert.equal(canMaterializeCanonicalClaim({
    patientName: "Avery Morgan",
    payerName: "Blue Horizon Health"
  }), false);

  const patch = claimPatchFromCanonical({
    patientName: "Avery Morgan",
    payerName: "Blue Horizon Health",
    amount: 425,
    patientGender: "F",
    patientDob: "1980-01-01",
    icd10Codes: ["M54.16"]
  });
  assert.equal(patch.patientGender, "FEMALE");
  assert.equal(patch.amount, 425);
  assert.deepEqual(patch.icd10Codes, ["M54.16"]);
});

test("Integration Hub persistence is tenant scoped and idempotent by canonical identity", () => {
  const schema = read("backend/prisma/schema.prisma");
  const migration = read("backend/prisma/migrations/20261027123000_integration_hub_v1/migration.sql");
  const route = read("backend/src/routes/integrations.js");

  assert.match(schema, /model IntegrationRecord/);
  assert.match(schema, /@@unique\\(\\[connectionId, resourceType, externalId\\]\\)/);
  assert.match(migration, /IntegrationRecord_connectionId_resourceType_externalId_key/);
  assert.match(route, /connectionId_resourceType_externalId/);
  assert.match(route, /organizationId: orgId\\(req\\)/);
  assert.match(route, /externalEventId/);
  assert.match(route, /duplicate: true/);
});

test("Integration Hub audit metadata excludes canonical PHI payloads", () => {
  const route = read("backend/src/routes/integrations.js");
  const auditBlock = route.slice(
    route.indexOf('action: "INTEGRATION_BATCH_INGESTED"'),
    route.indexOf("return { event, records, materializedClaims };")
  );

  assert.match(auditBlock, /recordCount/);
  assert.match(auditBlock, /resourceTypes/);
  assert.match(auditBlock, /materializedClaimCount/);
  assert.doesNotMatch(auditBlock, /patientName/);
  assert.doesNotMatch(auditBlock, /memberId/);
  assert.doesNotMatch(auditBlock, /externalId:/);
});

test("Integration Hub permissions separate viewing, administration and ingestion", () => {
  const manager = permissionsForRole("CLAIMS_MANAGER");
  const specialist = permissionsForRole("CLAIMS_SPECIALIST");
  const cashier = permissionsForRole("CASHIER");

  assert.equal(manager.has(PERMISSIONS.INTEGRATION_VIEW), true);
  assert.equal(manager.has(PERMISSIONS.INTEGRATION_MANAGE), true);
  assert.equal(manager.has(PERMISSIONS.INTEGRATION_INGEST), true);
  assert.equal(specialist.has(PERMISSIONS.INTEGRATION_VIEW), true);
  assert.equal(specialist.has(PERMISSIONS.INTEGRATION_MANAGE), false);
  assert.equal(cashier.has(PERMISSIONS.INTEGRATION_VIEW), false);
});
