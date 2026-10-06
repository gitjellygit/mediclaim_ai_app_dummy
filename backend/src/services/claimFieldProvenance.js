/**
 * Claim field provenance + automation summary.
 *
 * This is intentionally separate from documentDerivedFields:
 * - documentDerivedFields controls safe recomputation on document deletion.
 * - fieldProvenance explains where a displayed value came from.
 */

export const CLAIM_FIELD_LABELS = {
  patientName: "Patient Name",
  patientDob: "Patient DOB",
  memberId: "Member ID",
  medicalRecordNumber: "Medical Record Number (MRN)",
  payerName: "Payer",
  planAdministratorName: "Plan Administrator",
  policyNo: "Policy Number",
  groupNumber: "Group Number",
  subscriberId: "Subscriber ID",
  subscriberName: "Subscriber Name",
  payerEdiId: "Payer EDI ID",
  medicalRecordNumber: "Medical Record Number",
  patientMobile: "Patient Phone",
  insurerClaimNo: "Insurer Claim Number",
  hospitalName: "Hospital",
  doctorName: "Doctor",
  diagnosisText: "Diagnosis",
  icd10Codes: "ICD-10",
  inpatientProcedureCodes: "ICD-10-PCS",
  dateOfService: "Date of Service",
  admissionDate: "Admission Date",
  dischargeDate: "Discharge Date",
  admissionType: "Admission Type",
  roomCategory: "Room Category",
  icuDays: "ICU Days",
  procedureText: "Procedure",
  procedureDate: "Procedure Date",
  authorizationNo: "Authorization Number",
  amount: "Claimed Amount",
  totalBilledAmount: "Total Billed",
  coverageLimit: "Coverage Limit",
  remainingCoverageLimit: "Remaining Coverage Limit",
  payerReferenceNo: "Payer Reference Number",
  eligibilityStatus: "Eligibility Status",
  coverageStatus: "Coverage Status",
  deductibleRemaining: "Deductible Remaining",
  coinsurancePct: "Coinsurance",
  networkStatus: "Network Status",
  priorAuthRequired: "Prior Auth Required",
  priorAuthStatus: "Prior Auth Status",
  priorAuthExpiry: "Prior Auth Expiry",
  payerClaimStatus: "Payer Claim Status",
  allowedAmount: "Allowed Amount",
  paidAmount: "Paid Amount",
  patientResponsibility: "Patient Responsibility",
  paymentReference: "Payment Reference",
  approvedAmount: "Approved Amount"
};

export const TRACKED_FIELDS = Object.keys(CLAIM_FIELD_LABELS);

function hasValue(value) {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function nowIso() {
  return new Date().toISOString();
}

export function mergeProvenance(current, updates = {}) {
  return {
    ...(current && typeof current === "object" && !Array.isArray(current)
      ? current
      : {}),
    ...updates
  };
}

export function provenanceEntry({
  source,
  label,
  confidence = null,
  documentId = null,
  sourceDetail = null,
  verified = false
}) {
  return {
    source,
    label,
    confidence:
      confidence == null || !Number.isFinite(Number(confidence))
        ? null
        : Math.max(0, Math.min(100, Math.round(Number(confidence)))),
    documentId,
    sourceDetail,
    verified: Boolean(verified),
    updatedAt: nowIso()
  };
}

export function documentProvenance({
  fields,
  confidence,
  documentId = null,
  fileName = null,
  documentType = null
}) {
  const updates = {};

  for (const field of fields || []) {
    updates[field] = provenanceEntry({
      source: "DOCUMENT_AI",
      label: "AI Extracted",
      confidence,
      documentId,
      sourceDetail:
        documentType || fileName
          ? [documentType, fileName].filter(Boolean).join(" • ")
          : "Uploaded document"
    });
  }

  return updates;
}

export function manualProvenance(fields, label = "Entered by User") {
  const updates = {};
  for (const field of fields || []) {
    updates[field] = provenanceEntry({
      source: "USER",
      label,
      verified: true
    });
  }
  return updates;
}

export function systemProvenance(fields, {
  source,
  label,
  sourceDetail = null,
  verified = false
}) {
  const updates = {};
  for (const field of fields || []) {
    updates[field] = provenanceEntry({
      source,
      label,
      sourceDetail,
      verified
    });
  }
  return updates;
}

export function changedFields(existing = {}, payload = {}) {
  const changed = [];

  for (const [field, nextValue] of Object.entries(payload)) {
    if (!TRACKED_FIELDS.includes(field)) continue;

    const currentValue = existing[field];

    const normalize = (value) => {
      if (value instanceof Date) return value.toISOString();
      if (value && typeof value === "object" && typeof value.toFixed === "function") {
        // Decimal(14,2): compare stored and submitted money by canonical value.
        return value.toFixed(2);
      }
      if (Array.isArray(value)) return JSON.stringify(value);
      if (value == null) return null;

      // Date-like strings and Prisma DateTime values should compare by date.
      if (
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value)
      ) {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }

      return value;
    };

    if (normalize(currentValue) !== normalize(nextValue)) {
      changed.push(field);
    }
  }

  return changed;
}

const AUTOMATION_FIELDS = [
  "patientName",
  "patientDob",
  "memberId",
  "medicalRecordNumber",
  "payerName",
  "planAdministratorName",
  "policyNo",
  "hospitalName",
  "doctorName",
  "diagnosisText",
  "icd10Codes",
  "dateOfService",
  "authorizationNo",
  "amount",
  "totalBilledAmount",
  "coverageLimit",
  "remainingCoverageLimit",
  "payerReferenceNo",
  "eligibilityStatus",
  "coverageStatus",
  "priorAuthRequired",
  "priorAuthStatus",
  "payerClaimStatus",
  "allowedAmount",
  "paidAmount",
  "patientResponsibility",
  "paymentReference"
];

export function buildAutomationSummary(claim) {
  const provenance =
    claim?.fieldProvenance &&
    typeof claim.fieldProvenance === "object" &&
    !Array.isArray(claim.fieldProvenance)
      ? claim.fieldProvenance
      : {};

  const fields = AUTOMATION_FIELDS.map((field) => {
    const value = claim?.[field];
    const source = provenance[field] || null;
    const populated = hasValue(value);

    let bucket = "missing";
    if (populated) {
      if (!source) {
        bucket = "review";
      } else if (source.source === "USER") {
        bucket = "manual";
      } else if (
        source.source === "DOCUMENT_AI" &&
        source.confidence != null &&
        source.confidence < 80
      ) {
        bucket = "review";
      } else if (source.source === "CALCULATED_ESTIMATE") {
        bucket = "review";
      } else {
        bucket = "automated";
      }
    }

    return {
      field,
      label: CLAIM_FIELD_LABELS[field] || field,
      populated,
      bucket,
      source
    };
  });

  const count = (bucket) => fields.filter((item) => item.bucket === bucket).length;
  const populatedCount = fields.filter((item) => item.populated).length;
  const automated = count("automated");
  const manual = count("manual");
  const review = count("review");
  const missing = count("missing");

  return {
    totalFields: fields.length,
    populatedFields: populatedCount,
    automatedFields: automated,
    manualFields: manual,
    reviewFields: review,
    missingFields: missing,
    automationRate:
      populatedCount > 0
        ? Math.round((automated / populatedCount) * 100)
        : 0,
    fields
  };
}


export function removeProvenanceFields(current, fields = []) {
  const next = {
    ...(current && typeof current === "object" && !Array.isArray(current)
      ? current
      : {})
  };

  for (const field of fields) {
    delete next[field];
  }

  return next;
}
