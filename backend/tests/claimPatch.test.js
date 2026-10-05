import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClaimPatch,
  changedPatchFields,
  serviceLinesDiffer
} from "../src/services/claimPatch.js";

test("P1 - omitted claim fields stay omitted from PATCH data", () => {
  const patch = buildClaimPatch({ memberId: "MEM-200" });
  assert.deepEqual(patch, { memberId: "MEM-200" });
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "patientName"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "payerName"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "amount"), false);
});

test("P1 - explicit clear remains distinguishable from omission", () => {
  const patch = buildClaimPatch({
    memberId: "",
    patientDob: "",
    icd10Codes: []
  });
  assert.equal(patch.memberId, null);
  assert.equal(patch.patientDob, null);
  assert.deepEqual(patch.icd10Codes, []);
});

test("P1 - no-op PATCH does not report unchanged fields as changes", () => {
  const existing = {
    memberId: "MEM-1",
    amount: { toFixed: () => "100.00" },
    icd10Codes: ["M54.50"]
  };
  const patch = buildClaimPatch({
    memberId: "MEM-1",
    amount: "100.00",
    icd10Codes: ["M54.50"]
  });
  assert.deepEqual(changedPatchFields(existing, patch), []);
});

test("P1 - actual changes are detected across non-provenance fields too", () => {
  const existing = {
    billingProviderNpi: "1234567890",
    claimFrequencyCode: "ORIGINAL"
  };
  const patch = buildClaimPatch({
    billingProviderNpi: "1098765432",
    claimFrequencyCode: "CORRECTED"
  });
  assert.deepEqual(
    changedPatchFields(existing, patch).sort(),
    ["billingProviderNpi", "claimFrequencyCode"].sort()
  );
});

test("P1 - identical service lines do not trigger a false change", () => {
  const existing = [{
    cptHcpcsCode: "99213",
    modifiers: [],
    units: 1,
    charge: { toFixed: () => "125.00" },
    diagnosisPointers: ["M54.50"],
    placeOfService: "11",
    serviceDateFrom: new Date("2026-10-01T00:00:00.000Z"),
    serviceDateTo: new Date("2026-10-01T00:00:00.000Z"),
    revenueCode: null,
    poaIndicator: null,
    verified: true,
    source: "USER",
    sourceDocumentId: null
  }];
  const next = [{
    cptHcpcsCode: "99213",
    modifiers: [],
    units: 1,
    charge: 125,
    diagnosisPointers: ["M54.50"],
    placeOfService: "11",
    serviceDateFrom: new Date("2026-10-01T00:00:00.000Z"),
    serviceDateTo: new Date("2026-10-01T00:00:00.000Z"),
    revenueCode: null,
    poaIndicator: null,
    verified: true,
    source: "USER",
    sourceDocumentId: null
  }];
  assert.equal(serviceLinesDiffer(existing, next), false);
  next[0].placeOfService = "22";
  assert.equal(serviceLinesDiffer(existing, next), true);
});
