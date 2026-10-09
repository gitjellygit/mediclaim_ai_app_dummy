import { parseClaimDate } from "../utils/claimDate.js";
import { validMoney } from "../utils/money.js";

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const nullableText = (value) => value == null || value === "" ? null : value;

function setIfPresent(target, input, key, transform = (value) => value) {
  if (hasOwn(input, key)) {
    target[key] = transform(input[key]);
  }
}

export function buildClaimPatch(input = {}) {
  const patch = {};

  for (const key of [
    "patientName",
    "payerName"
  ]) {
    setIfPresent(patch, input, key);
  }

  for (const key of [
    "policyNo",
    "memberId",
    "medicalRecordNumber",
    "planAdministratorName",
    "groupNumber",
    "subscriberId",
    "subscriberName",
    "subscriberAddress1",
    "subscriberAddress2",
    "subscriberCity",
    "subscriberState",
    "subscriberPostalCode",
    "payerEdiId",
    "payerReferenceNo",
    "patientAddress1",
    "patientAddress2",
    "patientCity",
    "patientState",
    "patientPostalCode",
    "hospitalName",
    "doctorName",
    "billingProviderNpi",
    "renderingProviderNpi",
    "referringProviderNpi",
    "providerTin",
    "providerTaxonomyCode",
    "diagnosisText",
    "admissionType",
    "roomCategory",
    "procedureText",
    "typeOfBill",
    "drgCode",
    "claimFilingCode",
    "admissionTypeCode",
    "admissionSourceCode",
    "patientStatusCode"
  ]) {
    setIfPresent(patch, input, key, nullableText);
  }

  for (const key of [
    "subscriberRelationship",
    "coordinationOfBenefits",
    "claimForm",
    "patientGender",
    "subscriberGender"
  ]) {
    setIfPresent(patch, input, key, (value) => value ?? null);
  }

  for (const key of ["claimType", "claimFrequencyCode"]) {
    setIfPresent(patch, input, key);
  }

  for (const key of [
    "patientDob",
    "subscriberDob",
    "dateOfService",
    "admissionDate",
    "dischargeDate",
    "procedureDate",
    "timelyFilingDeadline"
  ]) {
    setIfPresent(
      patch,
      input,
      key,
      (value) => value ? parseClaimDate(value) : null
    );
  }

  for (const key of [
    "coverageLimit",
    "remainingCoverageLimit",
    "amount",
    "totalBilledAmount"
  ]) {
    setIfPresent(
      patch,
      input,
      key,
      (value) => value != null && value !== "" ? validMoney(value) : null
    );
  }

  setIfPresent(
    patch,
    input,
    "icuDays",
    (value) => value != null && value !== "" ? Number(value) : null
  );

  for (const key of ["icd10Codes", "inpatientProcedureCodes"]) {
    setIfPresent(patch, input, key, (value) => Array.isArray(value) ? value : []);
  }

  return patch;
}

const MONEY_FIELDS = new Set([
  "coverageLimit",
  "remainingCoverageLimit",
  "amount",
  "totalBilledAmount",
  "charge"
]);

function normalizeComparable(value, key = null) {
  if (value instanceof Date) return value.toISOString();
  if (value == null) return null;

  if (MONEY_FIELDS.has(key)) {
    const raw =
      value && typeof value === "object" && typeof value.toFixed === "function"
        ? value.toFixed(2)
        : value;
    const normalized = validMoney(raw);
    return normalized ?? raw;
  }

  if (value && typeof value === "object" && typeof value.toFixed === "function") {
    return value.toFixed(2);
  }

  return value;
}

export function changedPatchFields(existing = {}, patch = {}) {
  const changed = [];
  for (const [key, value] of Object.entries(patch)) {
    if (normalizeComparable(existing[key], key) !== normalizeComparable(value, key)) {
      const left = existing[key];
      if (Array.isArray(left) || Array.isArray(value)) {
        if (JSON.stringify(left || []) !== JSON.stringify(value || [])) changed.push(key);
      } else {
        changed.push(key);
      }
    }
  }
  return changed;
}

export function serviceLinesDiffer(existing = [], next = []) {
  if (existing.length !== next.length) return true;

  const keys = [
    "cptHcpcsCode",
    "modifiers",
    "units",
    "charge",
    "diagnosisPointers",
    "placeOfService",
    "serviceDateFrom",
    "serviceDateTo",
    "revenueCode",
    "poaIndicator",
    "verified",
    "source",
    "sourceDocumentId"
  ];

  return existing.some((current, index) => {
    const proposed = next[index];
    return keys.some((key) => {
      const left = normalizeComparable(current?.[key], key);
      const right = normalizeComparable(proposed?.[key], key);
      return Array.isArray(left) || Array.isArray(right)
        ? JSON.stringify(left || []) !== JSON.stringify(right || [])
        : left !== right;
    });
  });
}

export function hasOwnField(input, key) {
  return hasOwn(input, key);
}
