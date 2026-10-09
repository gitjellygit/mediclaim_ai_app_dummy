import { hasPermission, PERMISSIONS } from "./permissions.js";

const PATIENT_IDENTITY_FIELDS = [
  "patientName",
  "patientAge",
  "patientGender",
  "patientDob",
  "patientAddress1",
  "patientAddress2",
  "patientCity",
  "patientState",
  "patientPostalCode",
  "medicalRecordNumber",
  "patientMobile"
];

const INSURANCE_FIELDS = [
  "payerName",
  "policyNo",
  "memberId",
  "planAdministratorName",
  "policyStartDate",
  "policyEndDate",
  "productType",
  "coverageLimit",
  "remainingCoverageLimit",
  "groupNumber",
  "subscriberId",
  "subscriberName",
  "subscriberDob",
  "subscriberGender",
  "subscriberAddress1",
  "subscriberAddress2",
  "subscriberCity",
  "subscriberState",
  "subscriberPostalCode",
  "subscriberRelationship",
  "coordinationOfBenefits",
  "payerEdiId",
  "connectedPayerCode",
  "connectedPayerName",
  "eligibilityStatus",
  "eligibilityCheckedAt",
  "coverageStatus",
  "networkStatus",
  "priorAuthRequired",
  "priorAuthStatus",
  "priorAuthCheckedAt",
  "priorAuthExpiry",
  "authorizationNo"
];

const CLINICAL_FIELDS = [
  "doctorName",
  "doctorRegNo",
  "renderingProviderNpi",
  "referringProviderNpi",
  "admissionDate",
  "dischargeDate",
  "admissionType",
  "diagnosisText",
  "icd10Codes",
  "procedureText",
  "procedureDate",
  "dateOfService",
  "inpatientProcedureCodes",
  "roomCategory",
  "icuDays",
  "typeOfBill",
  "drgCode",
  "admissionTypeCode",
  "admissionSourceCode",
  "patientStatusCode",
  "serviceLines",
  "codingSuggestions",
  "checks",
  "aiSummary",
  "riskFactors",
  "automationSummary",
  "completenessSummary"
];

const FINANCIAL_FIELDS = [
  "amount",
  "totalBilledAmount",
  "approvedAmount",
  "deductionAmount",
  "copayAmount",
  "deductibleRemaining",
  "coinsurancePct",
  "allowedAmount",
  "patientResponsibility",
  "paidAmount",
  "paymentReference",
  "remittanceStatus",
  "remittanceReceivedAt",
  "underpaymentCase"
];

function removeFields(target, fields) {
  for (const field of fields) delete target[field];
}

export function minimumNecessaryDocument(document, user) {
  if (!document || typeof document !== "object") return document;
  if (!hasPermission(user, PERMISSIONS.DOCUMENT_VIEW)) return null;

  const safe = { ...document };
  delete safe.path;
  delete safe.rawText;
  delete safe.fileHash;

  if (!hasPermission(user, PERMISSIONS.CLINICAL_VIEW)) {
    delete safe.extracted;
    delete safe.codingSuggestions;
  }

  return safe;
}

export function minimumNecessaryClaim(claim, user) {
  if (!claim || typeof claim !== "object") return claim;

  const safe = { ...claim };

  if (!hasPermission(user, PERMISSIONS.PATIENT_IDENTITY_VIEW)) {
    removeFields(safe, PATIENT_IDENTITY_FIELDS);
  }
  if (!hasPermission(user, PERMISSIONS.INSURANCE_VIEW)) {
    removeFields(safe, INSURANCE_FIELDS);
    delete safe.payerTransactions;
  }
  if (!hasPermission(user, PERMISSIONS.CLINICAL_VIEW)) {
    removeFields(safe, CLINICAL_FIELDS);
  }
  if (!hasPermission(user, PERMISSIONS.FINANCIAL_VIEW)) {
    removeFields(safe, FINANCIAL_FIELDS);
    if (Array.isArray(safe.serviceLines)) {
      safe.serviceLines = safe.serviceLines.map(({ charge: _charge, ...line }) => line);
    }
  }

  if (Array.isArray(safe.documents)) {
    safe.documents = hasPermission(user, PERMISSIONS.DOCUMENT_VIEW)
      ? safe.documents
          .map((document) => minimumNecessaryDocument(document, user))
          .filter(Boolean)
      : [];
  }

  return safe;
}
