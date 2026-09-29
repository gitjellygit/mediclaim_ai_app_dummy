/**
 * Deterministic medical-consistency analysis.
 *
 * This engine checks internal consistency between claim fields and uploaded
 * document evidence. It is decision support, not a medical-necessity decision
 * and does not infer diagnoses, coding policy, or payer coverage.
 */

const CLINICAL_DOCUMENT_TYPES = new Set([
  "DISCHARGE_SUMMARY",
  "OPERATIVE_NOTE",
  "PROGRESS_NOTE",
  "LAB_REPORT",
  "RADIOLOGY",
  "PRESCRIPTION"
]);

function dateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  if (!start || !end) return null;
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function extractedValue(doc, key) {
  if (!doc?.extracted || typeof doc.extracted !== "object") return null;
  return doc.extracted[key] ?? null;
}

function normalizedText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function distinctDocumentValues(documents, keys, normalizer = normalizedText) {
  const values = new Map();

  for (const doc of documents || []) {
    for (const key of keys) {
      const raw = extractedValue(doc, key);
      if (raw == null || raw === "") continue;
      const normalized = normalizer(raw);
      if (!normalized) continue;

      if (!values.has(normalized)) {
        values.set(normalized, {
          value: raw,
          documents: []
        });
      }

      values.get(normalized).documents.push({
        id: doc.id,
        type: doc.type,
        fileName: doc.fileName
      });
    }
  }

  return [...values.values()];
}

function issue({
  severity,
  category,
  title,
  message,
  fields = [],
  fixTarget = "claim",
  evidence = []
}) {
  return {
    severity,
    category,
    title,
    message,
    fields,
    fixTarget,
    evidence
  };
}

function severityWeight(severity) {
  if (severity === "BLOCK") return 25;
  if (severity === "WARN") return 10;
  return 0;
}

export function analyzeMedicalConsistency(claim) {
  const documents = claim?.documents || [];
  const issues = [];
  const checks = [];

  const admission = claim?.admissionDate ? new Date(claim.admissionDate) : null;
  const discharge = claim?.dischargeDate ? new Date(claim.dischargeDate) : null;
  const serviceDate = claim?.dateOfService ? new Date(claim.dateOfService) : null;
  const procedureDate = claim?.procedureDate ? new Date(claim.procedureDate) : null;

  const inpatientLikely = Boolean(
    claim?.admissionDate ||
      claim?.dischargeDate ||
      claim?.admissionType ||
      claim?.roomCategory ||
      claim?.icuDays != null ||
      documents.some((doc) => doc.type === "DISCHARGE_SUMMARY")
  );

  // Diagnosis / coding presence. We do not claim semantic code validation
  // without a licensed coding reference source.
  if (claim?.diagnosisText && claim?.icd10Codes?.length) {
    checks.push({
      key: "diagnosis-coding",
      status: "PASS",
      label: "Diagnosis & ICD-10 both present"
    });
  } else if (claim?.diagnosisText || claim?.icd10Codes?.length) {
    issues.push(
      issue({
        severity: "WARN",
        category: "CODING",
        title: "Diagnosis / ICD-10 pair incomplete",
        message:
          "Diagnosis text and ICD-10 should be reviewed together because only one side is populated.",
        fields: ["diagnosisText", "icd10Codes"],
        fixTarget: "claim"
      })
    );
  }

  // Encounter date ordering.
  if (admission && discharge && admission > discharge) {
    issues.push(
      issue({
        severity: "BLOCK",
        category: "DATES",
        title: "Admission is after discharge",
        message:
          "Admission date occurs after discharge date. Review the encounter dates before submission.",
        fields: ["admissionDate", "dischargeDate"],
        fixTarget: "claim"
      })
    );
  } else if (admission && discharge) {
    checks.push({
      key: "encounter-order",
      status: "PASS",
      label: "Admission / discharge order is consistent"
    });
  }

  // Service date relative to inpatient stay.
  if (serviceDate && admission && discharge) {
    if (serviceDate < admission || serviceDate > discharge) {
      issues.push(
        issue({
          severity: "WARN",
          category: "DATES",
          title: "Service date outside encounter",
          message:
            "Date of service falls outside the recorded admission/discharge window.",
          fields: ["dateOfService", "admissionDate", "dischargeDate"],
          fixTarget: "claim"
        })
      );
    } else {
      checks.push({
        key: "service-window",
        status: "PASS",
        label: "Service date falls within encounter"
      });
    }
  }

  if (procedureDate && admission && discharge) {
    if (procedureDate < admission || procedureDate > discharge) {
      issues.push(
        issue({
          severity: "BLOCK",
          category: "PROCEDURE",
          title: "Procedure date outside encounter",
          message:
            "Procedure date falls outside the recorded inpatient encounter window.",
          fields: ["procedureDate", "admissionDate", "dischargeDate"],
          fixTarget: "claim"
        })
      );
    }
  }

  // ICU consistency.
  const stayDays =
    admission && discharge ? Math.max(1, daysBetween(admission, discharge) + 1) : null;
  const icuDays =
    claim?.icuDays == null || claim?.icuDays === ""
      ? null
      : Number(claim.icuDays);

  if (claim?.roomCategory === "ICU" && icuDays == null) {
    issues.push(
      issue({
        severity: "WARN",
        category: "UTILIZATION",
        title: "ICU days not confirmed",
        message:
          "Room category is ICU but ICU days are not recorded.",
        fields: ["roomCategory", "icuDays"],
        fixTarget: "claim"
      })
    );
  }

  if (icuDays != null && icuDays > 0 && claim?.roomCategory !== "ICU") {
    issues.push(
      issue({
        severity: "WARN",
        category: "UTILIZATION",
        title: "ICU utilization conflicts with room category",
        message:
          "ICU days are recorded but room category is not ICU.",
        fields: ["roomCategory", "icuDays"],
        fixTarget: "claim"
      })
    );
  }

  if (icuDays != null && stayDays != null && icuDays > stayDays) {
    issues.push(
      issue({
        severity: "BLOCK",
        category: "UTILIZATION",
        title: "ICU days exceed length of stay",
        message:
          `ICU days (${icuDays}) exceed the recorded stay length (${stayDays} day(s)).`,
        fields: ["icuDays", "admissionDate", "dischargeDate"],
        fixTarget: "claim"
      })
    );
  }

  // Inpatient documentation support.
  if (
    inpatientLikely &&
    !documents.some((doc) => doc.type === "DISCHARGE_SUMMARY")
  ) {
    issues.push(
      issue({
        severity: "WARN",
        category: "DOCUMENTATION",
        title: "Discharge summary not found",
        message:
          "The claim appears inpatient, but no discharge summary is attached.",
        fields: ["documents"],
        fixTarget: "documents"
      })
    );
  }

  // Procedure support.
  if (claim?.procedureText) {
    const clinicalDocs = documents.filter((doc) =>
      CLINICAL_DOCUMENT_TYPES.has(doc.type)
    );

    if (!clinicalDocs.length) {
      issues.push(
        issue({
          severity: "WARN",
          category: "DOCUMENTATION",
          title: "Procedure lacks supporting clinical document",
          message:
            "A procedure is recorded, but no clinical procedure/supporting document was found.",
          fields: ["procedureText", "documents"],
          fixTarget: "documents"
        })
      );
    } else {
      checks.push({
        key: "procedure-docs",
        status: "PASS",
        label: "Procedure has clinical documentation available"
      });
    }
  }

  // Cross-document date disagreement.
  const serviceDates = distinctDocumentValues(
    documents,
    ["dateOfService", "serviceDate", "dos"],
    dateOnly
  );
  if (serviceDates.length > 1) {
    issues.push(
      issue({
        severity: "WARN",
        category: "DOCUMENT_CONFLICT",
        title: "Documents disagree on date of service",
        message:
          "Uploaded documents contain more than one date of service. Review before submission.",
        fields: ["dateOfService"],
        fixTarget: "claim",
        evidence: serviceDates
      })
    );
  }

  const admissionDates = distinctDocumentValues(
    documents,
    ["admissionDate", "admitDate"],
    dateOnly
  );
  if (admissionDates.length > 1) {
    issues.push(
      issue({
        severity: "WARN",
        category: "DOCUMENT_CONFLICT",
        title: "Documents disagree on admission date",
        message:
          "Uploaded documents contain conflicting admission dates.",
        fields: ["admissionDate"],
        fixTarget: "claim",
        evidence: admissionDates
      })
    );
  }

  const dischargeDates = distinctDocumentValues(
    documents,
    ["dischargeDate"],
    dateOnly
  );
  if (dischargeDates.length > 1) {
    issues.push(
      issue({
        severity: "WARN",
        category: "DOCUMENT_CONFLICT",
        title: "Documents disagree on discharge date",
        message:
          "Uploaded documents contain conflicting discharge dates.",
        fields: ["dischargeDate"],
        fixTarget: "claim",
        evidence: dischargeDates
      })
    );
  }

  const diagnoses = distinctDocumentValues(
    documents,
    ["diagnosisText", "diagnosis", "finalDiagnosis"]
  );
  if (diagnoses.length > 1) {
    issues.push(
      issue({
        severity: "WARN",
        category: "DOCUMENT_CONFLICT",
        title: "Diagnosis text differs across documents",
        message:
          "Clinical documents contain differing diagnosis text. Confirm the final claim diagnosis.",
        fields: ["diagnosisText"],
        fixTarget: "claim",
        evidence: diagnoses
      })
    );
  }

  const score = Math.max(
    0,
    100 - issues.reduce((sum, item) => sum + severityWeight(item.severity), 0)
  );

  const blockingIssues = issues.filter((item) => item.severity === "BLOCK");
  const warnings = issues.filter((item) => item.severity === "WARN");

  const status =
    blockingIssues.length > 0
      ? "BLOCKED"
      : warnings.length > 0
      ? "NEEDS_REVIEW"
      : "CONSISTENT";

  return {
    claimId: claim.id,
    score,
    status,
    blockingIssues: blockingIssues.length,
    warnings: warnings.length,
    passedChecks: checks.length,
    analyzedAt: new Date().toISOString(),
    engine: {
      type: "RULES",
      label: "Consistency Rules",
      version: "1.0"
    },
    disclaimer:
      "Decision support only. This checks internal consistency and does not determine medical necessity, coding correctness, or payer coverage.",
    issues,
    checks
  };
}
