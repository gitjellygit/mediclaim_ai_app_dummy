import { hasPermission, PERMISSIONS } from "./permissions.js";

const CLINICAL_EDIT_FIELDS = new Set([
  "doctorName",
  "doctorRegNo",
  "billingProviderNpi",
  "renderingProviderNpi",
  "referringProviderNpi",
  "providerTin",
  "providerTaxonomyCode",
  "admissionDate",
  "dischargeDate",
  "admissionType",
  "diagnosisText",
  "icd10Codes",
  "inpatientProcedureCodes",
  "procedureText",
  "procedureDate",
  "dateOfService",
  "roomCategory",
  "icuDays",
  "typeOfBill",
  "drgCode",
  "claimFilingCode",
  "admissionTypeCode",
  "admissionSourceCode",
  "patientStatusCode",
  "claimFrequencyCode",
  "serviceLines"
]);

const FINANCIAL_EDIT_FIELDS = new Set([
  "totalBilledAmount",
  "timelyFilingDeadline"
]);

export function forbiddenClaimMutationFields(user, input = {}) {
  const fields = Object.keys(input || {});
  const forbidden = [];

  if (!hasPermission(user, PERMISSIONS.CLINICAL_EDIT)) {
    for (const field of fields) {
      if (CLINICAL_EDIT_FIELDS.has(field)) forbidden.push(field);
    }
  }

  if (!hasPermission(user, PERMISSIONS.FINANCIAL_EDIT)) {
    for (const field of fields) {
      if (FINANCIAL_EDIT_FIELDS.has(field)) forbidden.push(field);
    }
  }

  return [...new Set(forbidden)].sort();
}

export function claimMutationAllowed(user, input = {}) {
  return forbiddenClaimMutationFields(user, input).length === 0;
}
