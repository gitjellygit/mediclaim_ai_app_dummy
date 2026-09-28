/**
 * Claim field provenance helpers.
 *
 * documentDerivedFields records which Claim fields currently depend on uploaded
 * documents. When a supporting document is deleted we recompute only those
 * fields from the remaining documents. Manual claim fields are never wiped
 * merely because a document was removed.
 */

export const DOCUMENT_DERIVED_FIELDS = [
  "patientName",
  "payerName",
  "policyNo",
  "amount",
  "totalBilledAmount",
  "patientDob",
  "memberId",
  "hospitalName",
  "doctorName",
  "diagnosisText",
  "icd10Codes",
  "dateOfService",
  "admissionDate",
  "dischargeDate",
  "authorizationNo"
];

function clean(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function parsePositiveMoney(value) {
  if (value == null || value === "") return null;
  const number = Number(String(value).replace(/,/g, "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function safeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractedValue(extracted = {}, field) {
  switch (field) {
    case "patientName":
      return clean(extracted.patientName || extracted.patient_name || extracted.name);
    case "payerName":
      return clean(extracted.payerName || extracted.payer_name);
    case "policyNo":
      return clean(extracted.policyNo || extracted.policyNumber || extracted.policy_number);
    case "memberId":
      return clean(extracted.memberId || extracted.member_id);
    case "hospitalName":
      return clean(extracted.hospitalName || extracted.hospital_name);
    case "doctorName":
      return clean(extracted.doctorName || extracted.doctor_name);
    case "diagnosisText":
      return clean(extracted.diagnosisText || extracted.diagnosis);
    case "authorizationNo":
      return clean(extracted.authorizationNo || extracted.authorization_number);
    case "patientDob":
      return safeDate(extracted.dateOfBirth || extracted.patientDob || extracted.dob);
    case "dateOfService":
      return safeDate(extracted.dateOfService || extracted.serviceDate);
    case "admissionDate":
      return safeDate(extracted.admissionDate);
    case "dischargeDate":
      return safeDate(extracted.dischargeDate);
    case "icd10Codes":
      return Array.isArray(extracted.icd10Codes)
        ? extracted.icd10Codes.filter(Boolean)
        : [];
    case "amount":
    case "totalBilledAmount":
      return parsePositiveMoney(
        extracted.amount ||
        extracted.claimAmount ||
        extracted.claim_amount ||
        extracted.totalAmount ||
        extracted.total_amount
      );
    default:
      return null;
  }
}

export function getDerivedFieldsFromDocument(extracted = {}, type = "OTHER") {
  const fields = [];

  for (const field of DOCUMENT_DERIVED_FIELDS) {
    const value = extractedValue(extracted, field);

    if (field === "icd10Codes") {
      if (value.length > 0) fields.push(field);
      continue;
    }

    if (field === "totalBilledAmount" && type !== "FINAL_BILL") {
      continue;
    }

    if (value != null) fields.push(field);
  }

  return fields;
}

export function mergeDerivedFields(current = [], additions = []) {
  return [...new Set([...(current || []), ...(additions || [])])].filter((field) =>
    DOCUMENT_DERIVED_FIELDS.includes(field)
  );
}

export function removeManuallyEditedFields(current = [], payload = {}) {
  const manuallyEdited = new Set(
    Object.keys(payload).filter((field) => DOCUMENT_DERIVED_FIELDS.includes(field))
  );

  return (current || []).filter((field) => !manuallyEdited.has(field));
}

/**
 * Recompute only fields marked as document-derived.
 * Documents should be ordered newest-first. For amount/billed amount, FINAL_BILL
 * is preferred. ICD-10 codes are unioned across remaining documents.
 */
export function recomputeDerivedClaimPatch(documents = [], derivedFields = []) {
  const fields = new Set(
    (derivedFields || []).filter((field) => DOCUMENT_DERIVED_FIELDS.includes(field))
  );
  const patch = {};

  for (const field of fields) {
    if (field === "icd10Codes") {
      const codes = new Set();
      for (const doc of documents) {
        for (const code of extractedValue(doc.extracted || {}, "icd10Codes")) {
          codes.add(code);
        }
      }
      patch.icd10Codes = [...codes];
      continue;
    }

    if (field === "amount" || field === "totalBilledAmount") {
      let value = null;

      const preferredDocs =
        field === "totalBilledAmount"
          ? documents.filter((doc) => doc.type === "FINAL_BILL")
          : [
              ...documents.filter((doc) => doc.type === "FINAL_BILL"),
              ...documents.filter((doc) => doc.type !== "FINAL_BILL")
            ];

      for (const doc of preferredDocs) {
        value = extractedValue(doc.extracted || {}, field);
        if (value != null) break;
      }

      patch[field] = value;
      continue;
    }

    let value = null;
    for (const doc of documents) {
      value = extractedValue(doc.extracted || {}, field);
      if (value != null) break;
    }

    patch[field] = value;
  }

  return patch;
}
