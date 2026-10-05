import test from "node:test";
import assert from "node:assert/strict";
import {
  cptHcpcsSchema,
  drgSchema,
  icd10CmSchema,
  icd10PcsSchema,
  modifierSchema,
  npiSchema,
  placeOfServiceSchema,
  poaIndicatorSchema,
  revenueCodeSchema,
  taxonomySchema,
  tinSchema,
  typeOfBillSchema
} from "../src/validation/usClaimValidation.js";
import { serviceLineInputSchema } from "../src/validation/claimMutations.js";

test("US validation - provider identifiers enforce claim formats", () => {
  assert.equal(npiSchema.parse("1234567890"), "1234567890");
  assert.equal(tinSchema.parse("12-3456789"), "123456789");
  assert.equal(taxonomySchema.parse("207q00000x"), "207Q00000X");

  assert.equal(npiSchema.safeParse("12345").success, false);
  assert.equal(tinSchema.safeParse("12345678").success, false);
  assert.equal(taxonomySchema.safeParse("207Q").success, false);
});

test("US validation - ICD-10-CM accepts dotted and undotted and normalizes uppercase", () => {
  assert.equal(icd10CmSchema.parse("e11.9"), "E11.9");
  assert.equal(icd10CmSchema.parse("e119"), "E11.9");
  assert.equal(icd10CmSchema.parse("s72001a"), "S72.001A");
  assert.equal(icd10CmSchema.safeParse("11.9").success, false);
});

test("US validation - ICD-10-PCS is exactly seven valid PCS characters", () => {
  assert.equal(icd10PcsSchema.parse("0jht3vz"), "0JHT3VZ");
  assert.equal(icd10PcsSchema.safeParse("0JHT3V").success, false);
  assert.equal(icd10PcsSchema.safeParse("0JHT3VO").success, false);
});

test("US validation - service-line code formats are enforced", () => {
  assert.equal(cptHcpcsSchema.parse("99213"), "99213");
  assert.equal(cptHcpcsSchema.parse("j1234"), "J1234");
  assert.equal(modifierSchema.parse("25"), "25");
  assert.equal(placeOfServiceSchema.parse("11"), "11");
  assert.equal(revenueCodeSchema.parse("0450"), "0450");
  assert.equal(poaIndicatorSchema.parse("y"), "Y");

  assert.equal(cptHcpcsSchema.safeParse("9921").success, false);
  assert.equal(modifierSchema.safeParse("XYZ").success, false);
  assert.equal(placeOfServiceSchema.safeParse("1").success, false);
  assert.equal(revenueCodeSchema.safeParse("450").success, false);
});

test("US validation - institutional identifiers enforce UB-04 formats", () => {
  assert.equal(typeOfBillSchema.parse("131"), "0131");
  assert.equal(typeOfBillSchema.parse("0131"), "0131");
  assert.equal(drgSchema.parse("470"), "470");

  assert.equal(typeOfBillSchema.safeParse("13").success, false);
  assert.equal(drgSchema.safeParse("47").success, false);
});

test("US validation - serviceLineInputSchema normalizes coding fields", () => {
  const line = serviceLineInputSchema.parse({
    cptHcpcsCode: "j1234",
    modifiers: ["25"],
    units: 1,
    diagnosisPointers: ["e119"],
    placeOfService: "11"
  });

  assert.equal(line.cptHcpcsCode, "J1234");
  assert.deepEqual(line.diagnosisPointers, ["E11.9"]);
  assert.equal(line.placeOfService, "11");
});
