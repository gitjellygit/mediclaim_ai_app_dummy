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
    "payerEdiId",
    "payerReferenceNo",
    "hospitalName",
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
    "drgCode"
  ]) {
    setIfPresent(patch, input, key, nullableText);
  }

  for (const key of [
    "subscriberRelationship",
    "coordinationOfBenefits",
    "claimForm"
  ]) {
    setIfPresent(patch, input, key, (value) => value ?? null);
  }

  for (const key of ["claimType", "claimFrequencyCode"]) {
    setIfPresent(patch, input, key);
  }

  for (const key of [
    "patientDob",
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

function normalizeComparable(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && typeof value.toFixed === "function") {
    return value.toFixed(2);
  }
  if (value == null) return null;
  return value;
}

export function changedPatchFields(existing = {}, patch = {}) {
  const changed = [];
  for (const [key, value] of Object.entries(patch)) {
    if (normalizeComparable(existing[key]) !== normalizeComparable(value)) {
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
    "poaIndicator"
  ];

  return existing.some((current, index) => {
    const proposed = next[index];
    return keys.some((key) => {
      const left = normalizeComparable(current?.[key]);
      const right = normalizeComparable(proposed?.[key]);
      return Array.isArray(left) || Array.isArray(right)
        ? JSON.stringify(left || []) !== JSON.stringify(right || [])
        : left !== right;
    });
  });
}

export function hasOwnField(input, key) {
  return hasOwn(input, key);
}
