/**
 * Context-aware claim completeness.
 *
 * A blank field is not automatically a defect. We first determine whether the
 * field applies to this encounter, then classify it as complete, missing,
 * needs-review, or not-applicable.
 */

const LABELS = {
  patientName: "Patient Name",
  patientDob: "Patient DOB",
  memberId: "Member ID",
  payerName: "Payer",
  policyNo: "Policy Number",
  hospitalName: "Hospital",
  doctorName: "Doctor",
  diagnosisText: "Diagnosis",
  icd10Codes: "ICD-10",
  serviceLines: "CPT / HCPCS Service Line",
  dateOfService: "Date of Service",
  admissionDate: "Admission Date",
  dischargeDate: "Discharge Date",
  admissionType: "Admission Type",
  roomCategory: "Room Category",
  icuDays: "ICU Days",
  amount: "Claimed Amount",
  totalBilledAmount: "Total Billed",
  authorizationNo: "Authorization Number",
  eligibilityStatus: "Eligibility",
  priorAuthStatus: "Prior Authorization"
};

function hasValue(value) {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function documentEvidenceText(documents = []) {
  return documents
    .map((doc) => {
      const extracted =
        doc?.extracted && typeof doc.extracted === "object"
          ? JSON.stringify(doc.extracted)
          : "";
      return [
        doc?.type,
        doc?.suggestedType,
        doc?.rawText,
        extracted
      ]
        .filter(Boolean)
        .join(" ");
    })
    .join(" ")
    .toLowerCase();
}

export function getClaimApplicability(claim) {
  const evidence = documentEvidenceText(claim?.documents || []);

  const inpatientLikely = Boolean(
    claim?.admissionDate ||
      claim?.dischargeDate ||
      claim?.admissionType ||
      claim?.roomCategory ||
      claim?.icuDays != null ||
      /\badmission\b|\badmitted\b|\bdischarge\b|\binpatient\b/.test(evidence)
  );

  const icuApplicable = Boolean(
    claim?.roomCategory === "ICU" ||
      Number(claim?.icuDays || 0) > 0 ||
      /\bicu\b|intensive care/.test(evidence)
  );

  return {
    inpatientLikely,
    icuApplicable
  };
}

export function buildClaimCompleteness(claim) {
  const applicability = getClaimApplicability(claim);

  const fields = [];

  const push = ({
    field,
    required = false,
    conditional = false,
    applicable = true,
    complete = hasValue(claim?.[field]),
    state = null,
    reason = null,
    fixTarget = "claim"
  }) => {
    if (!applicable) {
      fields.push({
        field,
        label: LABELS[field] || field,
        state: "not_applicable",
        required,
        conditional,
        reason: reason || "Not applicable to this encounter",
        fixTarget
      });
      return;
    }

    fields.push({
      field,
      label: LABELS[field] || field,
      state: state || (complete ? "complete" : required ? "missing" : "review"),
      required,
      conditional,
      reason,
      fixTarget
    });
  };

  // Core claim identity / coding / financial fields.
  push({ field: "patientName", required: true });
  push({ field: "payerName", required: true });
  push({ field: "policyNo", required: true });
  push({ field: "memberId", required: true });
  push({ field: "diagnosisText", required: true });
  const pendingCodingSuggestions = Array.isArray(claim?.codingSuggestions)
    ? claim.codingSuggestions.filter((item) => item?.status === "PENDING")
    : [];
  const pendingIcdSuggestion = pendingCodingSuggestions.some(
    (item) => item.system === "ICD10_CM"
  );
  const pendingServiceCodeSuggestion = pendingCodingSuggestions.some(
    (item) => ["CPT", "HCPCS"].includes(item.system)
  );
  const hasIcd10 = Array.isArray(claim?.icd10Codes) && claim.icd10Codes.length > 0;
  const hasVerifiedServiceCode = Array.isArray(claim?.serviceLines) &&
    claim.serviceLines.some(
      (line) => line?.verified !== false && Boolean(line?.cptHcpcsCode)
    );

  push({
    field: "icd10Codes",
    required: true,
    complete: hasIcd10,
    state: !hasIcd10 && pendingIcdSuggestion ? "review" : null,
    reason: !hasIcd10 && pendingIcdSuggestion
      ? "A document contains an ICD-10 suggestion that must be reviewed before it is added to the claim"
      : null,
    fixTarget: !hasIcd10 && pendingIcdSuggestion ? "coding-review" : "claim"
  });
  push({
    field: "serviceLines",
    required: true,
    complete: hasVerifiedServiceCode,
    state: !hasVerifiedServiceCode && pendingServiceCodeSuggestion ? "review" : null,
    reason: !hasVerifiedServiceCode && pendingServiceCodeSuggestion
      ? "A document contains a CPT/HCPCS suggestion that must be reviewed before it becomes a service line"
      : "At least one verified CPT/HCPCS service line is required",
    fixTarget: !hasVerifiedServiceCode && pendingServiceCodeSuggestion
      ? "coding-review"
      : "serviceLines"
  });
  push({ field: "dateOfService", required: true });
  push({ field: "amount", required: true });
  push({ field: "totalBilledAmount", required: true });

  // Useful context, but not universal hard submission gates.
  push({
    field: "hospitalName",
    required: false,
    reason: "Recommended for claim traceability"
  });
  push({
    field: "doctorName",
    required: false,
    reason: "Recommended when available"
  });

  // Journey prerequisites.
  push({
    field: "eligibilityStatus",
    required: true,
    complete: claim?.eligibilityStatus === "VERIFIED",
    reason: "Eligibility must be resolved before submission",
    fixTarget: "eligibility"
  });
  push({
    field: "priorAuthStatus",
    required: true,
    complete: ["APPROVED", "NOT_REQUIRED"].includes(claim?.priorAuthStatus),
    reason: "Prior authorization requirement must be resolved",
    fixTarget: "prior-auth"
  });
  push({
    field: "authorizationNo",
    required: Boolean(claim?.priorAuthRequired),
    conditional: true,
    applicable: Boolean(claim?.priorAuthRequired),
    reason: claim?.priorAuthRequired
      ? "Required because prior authorization is required"
      : "Prior authorization not required",
    fixTarget: "prior-auth"
  });

  // Encounter fields only become requirements when inpatient context exists.
  for (const field of ["admissionDate", "dischargeDate", "admissionType", "roomCategory"]) {
    push({
      field,
      required: false,
      conditional: true,
      applicable: applicability.inpatientLikely,
      reason: applicability.inpatientLikely
        ? "Inpatient encounter detected; review this field"
        : "No inpatient encounter detected"
    });
  }

  push({
    field: "icuDays",
    required: false,
    conditional: true,
    applicable: applicability.icuApplicable,
    complete:
      claim?.icuDays != null &&
      Number.isFinite(Number(claim.icuDays)) &&
      Number(claim.icuDays) >= 0,
    reason: applicability.icuApplicable
      ? "ICU utilization detected; confirm ICU days"
      : "No ICU utilization detected"
  });

  const applicableFields = fields.filter((item) => item.state !== "not_applicable");
  const completeFields = applicableFields.filter((item) => item.state === "complete");
  const missingFields = fields.filter((item) => item.state === "missing");
  const reviewFields = fields.filter((item) => item.state === "review");
  const notApplicableFields = fields.filter((item) => item.state === "not_applicable");

  return {
    score:
      applicableFields.length > 0
        ? Math.round((completeFields.length / applicableFields.length) * 100)
        : 100,
    applicableFields: applicableFields.length,
    completeFields: completeFields.length,
    missingFields: missingFields.length,
    reviewFields: reviewFields.length,
    notApplicableFields: notApplicableFields.length,
    inpatientLikely: applicability.inpatientLikely,
    icuApplicable: applicability.icuApplicable,
    fields
  };
}

export function completenessReadinessIssues(claim) {
  const summary = buildClaimCompleteness(claim);
  const issues = [];

  const addIfIncomplete = (field, severity, message) => {
    const item = summary.fields.find((entry) => entry.field === field);
    if (item && ["missing", "review"].includes(item.state)) {
      issues.push({
        severity,
        message,
        field,
        source: "COMPLETENESS"
      });
    }
  };

  // These are not already covered by the legacy readiness checks.
  addIfIncomplete(
    "dateOfService",
    "WARN",
    "Date of service is missing"
  );

  if (summary.inpatientLikely) {
    addIfIncomplete(
      "admissionDate",
      "WARN",
      "Inpatient encounter detected but admission date is missing"
    );
    addIfIncomplete(
      "dischargeDate",
      "WARN",
      "Inpatient encounter detected but discharge date is missing"
    );
    addIfIncomplete(
      "admissionType",
      "WARN",
      "Inpatient encounter detected but admission type needs review"
    );
    addIfIncomplete(
      "roomCategory",
      "WARN",
      "Inpatient encounter detected but room category needs review"
    );
  }

  if (summary.icuApplicable) {
    addIfIncomplete(
      "icuDays",
      "WARN",
      "ICU utilization detected but ICU days need review"
    );
  }

  return {
    summary,
    issues
  };
}
