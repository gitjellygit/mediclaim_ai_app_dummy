import test from "node:test";
import assert from "node:assert/strict";
import { buildIntegrationClaimDraft } from "../src/services/integrationClaimDraft.js";

function record(id, resourceType, externalId, data) {
  return { id, resourceType, externalId, data };
}

test("EHR claim draft is ready when patient, coverage, encounter and billable charge exist", () => {
  const records = [
    record("p1", "PATIENT", "12724067", {
      name: "JOE SMART",
      birthDate: "1976-04-29",
      gender: "male",
      identifiers: { MR: "MRN-1" }
    }),
    record("c1", "COVERAGE", "cov-1", {
      status: "active",
      beneficiaryRef: "Patient/12724067",
      subscriberRef: "Patient/12724067",
      subscriberId: "MEM-123",
      payors: [{ reference: "Organization/1", display: "MEDICARE" }]
    }),
    record("e1", "ENCOUNTER", "enc-1", {
      subjectRef: "Patient/12724067",
      period: { start: "2026-10-01T10:00:00Z", end: "2026-10-01T11:00:00Z" }
    }),
    record("dx1", "CLINICAL_EVIDENCE", "cond-1", {
      evidenceType: "Condition",
      subjectRef: "Patient/12724067",
      encounterRef: "Encounter/enc-1",
      code: { system: "http://hl7.org/fhir/sid/icd-10-cm", code: "I10" }
    }),
    record("ch1", "CHARGE", "charge-1", {
      subjectRef: "Patient/12724067",
      contextRef: "Encounter/enc-1",
      procedureCodes: [{ code: "99213" }],
      quantity: 1,
      unitPrice: 125,
      netPrice: 125,
      occurrenceDateTime: "2026-10-01T10:30:00Z"
    })
  ];

  const draft = buildIntegrationClaimDraft(records, { patientId: "12724067" });
  assert.equal(draft.ready, true);
  assert.equal(draft.summary.patientName, "JOE SMART");
  assert.equal(draft.summary.payerName, "MEDICARE");
  assert.equal(draft.summary.encounterId, "enc-1");
  assert.equal(draft.summary.chargeCount, 1);
  assert.equal(draft.summary.totalBilledAmount, 125);
  assert.equal(draft.claimData.claimType, "PROVIDER_BILLED");
  assert.deepEqual(draft.claimData.icd10Codes, ["I10"]);
  assert.equal(draft.serviceLines[0].cptHcpcsCode, "99213");
});

test("EHR claim draft explains missing claim-critical data", () => {
  const records = [
    record("p1", "PATIENT", "12724067", { name: "JOE SMART" }),
    record("e1", "ENCOUNTER", "enc-1", {
      subjectRef: "Patient/12724067",
      period: { start: "2026-10-01T10:00:00Z" }
    })
  ];
  const draft = buildIntegrationClaimDraft(records, { patientId: "12724067" });
  assert.equal(draft.ready, false);
  assert.ok(!draft.missing.includes("payer / coverage"));
  assert.ok(draft.missing.includes("billable charges"));
  assert.ok(draft.missing.includes("positive billed amount"));
  assert.ok(draft.warnings.includes("payer / coverage"));
});


test("EHR claim draft can be created from real billing data even when payer is missing", () => {
  const records = [
    record("p1", "PATIENT", "12742419", { name: "BILLING DEMO PATIENT" }),
    record("e1", "ENCOUNTER", "97953601", {
      subjectRef: "Patient/12742419",
      period: { start: "2020-03-06T18:22:00Z" }
    }),
    record("ch1", "CHARGE", "292870306", {
      subjectRef: "Patient/12742419",
      contextRef: "Encounter/97953601",
      service: { code: "64897" },
      quantity: 1,
      unitPrice: 100,
      occurrenceDateTime: "2020-03-06T18:22:00Z"
    })
  ];

  const draft = buildIntegrationClaimDraft(records, {
    patientId: "12742419",
    encounterId: "97953601"
  });

  assert.equal(draft.ready, true);
  assert.equal(draft.summary.chargeCount, 1);
  assert.equal(draft.summary.totalBilledAmount, 100);
  assert.deepEqual(draft.warnings, ["payer / coverage"]);
});


test("EHR claim draft prefers coverage linked to the selected encounter", () => {
  const records = [
    record("p1", "PATIENT", "p-1", { name: "PATIENT ONE" }),
    record("generic", "COVERAGE", "cov-generic", {
      status: "active",
      beneficiaryRef: "Patient/p-1",
      payors: [{ display: "Generic Plan" }]
    }),
    record("specific", "COVERAGE", "cov-specific", {
      status: "active",
      beneficiaryRef: "Patient/p-1",
      encounterRef: "Encounter/e-1",
      payors: [{ display: "Encounter Plan" }]
    }),
    record("e1", "ENCOUNTER", "e-1", {
      subjectRef: "Patient/p-1",
      period: { start: "2026-01-01T10:00:00Z" }
    }),
    record("ch1", "CHARGE", "ch-1", {
      subjectRef: "Patient/p-1",
      contextRef: "Encounter/e-1",
      service: { code: "99213" },
      unitPrice: 100,
      quantity: 1
    })
  ];
  const draft = buildIntegrationClaimDraft(records, { patientId: "p-1", encounterId: "e-1" });
  assert.equal(draft.ready, true);
  assert.equal(draft.summary.payerName, "Encounter Plan");
});
