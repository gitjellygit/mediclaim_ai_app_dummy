import { systemRule } from "./ruleCatalog.js";
import { isSelfPayClaim } from "./claimPaymentMode.js";

export const US_READINESS_RULE_DEFAULTS = Object.freeze([
  {
    code: "US_NPI_VALID",
    name: "Provider NPI present and valid",
    severity: "BLOCK",
    enabled: true
  },
  {
    code: "US_CPT_PRESENT",
    name: "CPT/HCPCS service code present",
    severity: "BLOCK",
    enabled: true
  },
  {
    code: "US_DIAGNOSIS_CPT_LINK",
    name: "Diagnosis linked to service line",
    severity: "BLOCK",
    enabled: true
  },
  {
    code: "US_TIMELY_FILING",
    name: "Claim is within timely filing window",
    severity: "BLOCK",
    enabled: true
  },
  {
    code: "US_MEMBER_ID",
    name: "Member ID present",
    severity: "BLOCK",
    enabled: true
  },
  {
    code: "US_PAYER_SOURCE_MATCH",
    name: "Connected payer matches claim insurance identity",
    severity: "BLOCK",
    enabled: true
  },
  {
    code: "US_COVERAGE_DOS",
    name: "Coverage dates include date of service",
    severity: "BLOCK",
    enabled: true
  },
  {
    code: "US_SERVICE_DATE_CONSISTENCY",
    name: "Service-line dates align to claim date of service",
    severity: "BLOCK",
    enabled: true
  },
  {
    code: "US_PRIOR_AUTH",
    name: "Required prior authorization resolved",
    severity: "BLOCK",
    enabled: true
  },
  {
    code: "US_COB_PRIMARY_ONLY",
    name: "Secondary and tertiary billing disabled",
    severity: "BLOCK",
    enabled: true
  },
  {
    code: "US_837_SUBMISSION_FIELDS",
    name: "External 837 submission fields are complete",
    severity: "BLOCK",
    enabled: true
  }
]);

function ruleMap(rules = []) {
  return new Map(rules.map((rule) => [rule.code, rule]));
}

function normalizeSeverity(value, fallback = "WARN") {
  return ["INFO", "WARN", "BLOCK"].includes(value) ? value : fallback;
}

function addIssue(issues, rules, defaults, code, message, extra = {}) {
  const fallback = defaults.get(code);
  if (!fallback) return;

  const configured = rules.get(code);
  const catalog = systemRule(code);
  const mandatory = catalog?.mandatory === true;
  const enabled = mandatory ? true : (configured?.enabled ?? fallback.enabled);
  if (!enabled) return;

  issues.push({
    rule: code,
    severity: mandatory
      ? fallback.severity
      : normalizeSeverity(configured?.severity, fallback.severity),
    message,
    source: "CONFIGURED_RULE",
    ...extra
  });
}

function validNpiFormat(value) {
  return /^\d{10}$/.test(String(value || "").trim());
}

function isoDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return match?.[1] || null;
}

export function evaluateUsReadinessRules(claim, rules = [], { now = new Date() } = {}) {
  const issues = [];
  const selfPay = isSelfPayClaim(claim);
  const configured = ruleMap(rules);
  const defaults = ruleMap(US_READINESS_RULE_DEFAULTS);

  const providerNpis = [
    ["billing", claim.billingProviderNpi],
    ["rendering", claim.renderingProviderNpi],
    ["referring", claim.referringProviderNpi]
  ];

  if (!claim.billingProviderNpi) {
    addIssue(
      issues,
      configured,
      defaults,
      "US_NPI_VALID",
      "Billing provider NPI is required",
      { field: "billingProviderNpi", fixTarget: "claim" }
    );
  } else {
    for (const [label, value] of providerNpis) {
      if (value && !validNpiFormat(value)) {
        addIssue(
          issues,
          configured,
          defaults,
          "US_NPI_VALID",
          `${label[0].toUpperCase() + label.slice(1)} provider NPI must be exactly 10 digits`,
          { field: `${label}ProviderNpi`, fixTarget: "claim" }
        );
      }
    }
  }

  const serviceLines = Array.isArray(claim.serviceLines) ? claim.serviceLines : [];
  const verifiedServiceLines = serviceLines.filter((line) => line.verified !== false);
  if (
    !verifiedServiceLines.length ||
    verifiedServiceLines.some((line) => !line.cptHcpcsCode)
  ) {
    addIssue(
      issues,
      configured,
      defaults,
      "US_CPT_PRESENT",
      "At least one user-verified CPT/HCPCS service code is required",
      { field: "cptHcpcsCode", fixTarget: "serviceLines" }
    );
  }

  if (verifiedServiceLines.length) {
    const diagnosisCodes = new Set(
      (claim.icd10Codes || []).map((code) => String(code).trim().toUpperCase())
    );
    const unlinked = verifiedServiceLines.some((line) => {
      const pointers = Array.isArray(line.diagnosisPointers)
        ? line.diagnosisPointers.map((value) => String(value).trim().toUpperCase()).filter(Boolean)
        : [];
      if (!pointers.length) return true;
      if (!diagnosisCodes.size) return true;
      return pointers.some((pointer) => !diagnosisCodes.has(pointer));
    });

    if (unlinked) {
      addIssue(
        issues,
        configured,
        defaults,
        "US_DIAGNOSIS_CPT_LINK",
        "Each service line must link to a valid claim diagnosis",
        { field: "diagnosisPointers", fixTarget: "serviceLines" }
      );
    }
  }

  if (claim.timelyFilingDeadline) {
    const deadline = isoDateOnly(claim.timelyFilingDeadline);
    const today = isoDateOnly(now);
    if (deadline && today && deadline < today) {
      addIssue(
        issues,
        configured,
        defaults,
        "US_TIMELY_FILING",
        "Timely filing deadline has passed",
        { field: "timelyFilingDeadline", fixTarget: "claim" }
      );
    }
  }

  if (!selfPay && !claim.memberId) {
    addIssue(
      issues,
      configured,
      defaults,
      "US_MEMBER_ID",
      "Member ID is required",
      { field: "memberId", fixTarget: "claim" }
    );
  }

  const claimPayer = String(claim.payerName || "").trim();
  const connectedPayer = String(claim.connectedPayerName || "").trim();
  if (
    !selfPay &&
    claimPayer &&
    connectedPayer &&
    claimPayer.localeCompare(connectedPayer, undefined, { sensitivity: "accent" }) !== 0
  ) {
    addIssue(
      issues,
      configured,
      defaults,
      "US_PAYER_SOURCE_MATCH",
      `Connected payer "${connectedPayer}" does not match payer on the claim/source evidence "${claimPayer}". Reconcile payer identity before submission.`,
      { field: "payerName", fixTarget: "claim" }
    );
  }

  const dos = isoDateOnly(claim.dateOfService);
  const policyStart = isoDateOnly(claim.policyStartDate);
  const policyEnd = isoDateOnly(claim.policyEndDate);
  if (
    !selfPay &&
    dos &&
    ((policyStart && dos < policyStart) || (policyEnd && dos > policyEnd))
  ) {
    addIssue(
      issues,
      configured,
      defaults,
      "US_COVERAGE_DOS",
      "Date of service falls outside the recorded policy coverage period",
      { field: "dateOfService", fixTarget: "eligibility" }
    );
  }

  if (dos && verifiedServiceLines.some((line) => {
    const from = isoDateOnly(line.serviceDateFrom);
    const to = isoDateOnly(line.serviceDateTo);
    return (from && dos < from) || (to && dos > to);
  })) {
    addIssue(
      issues,
      configured,
      defaults,
      "US_SERVICE_DATE_CONSISTENCY",
      "Claim date of service falls outside a service-line date range",
      { field: "serviceDateFrom", fixTarget: "serviceLines" }
    );
  }

  if (["SECONDARY", "TERTIARY"].includes(String(claim.coordinationOfBenefits || "PRIMARY").toUpperCase())) {
    addIssue(
      issues,
      configured,
      defaults,
      "US_COB_PRIMARY_ONLY",
      "Secondary and tertiary claim submission is not enabled until other-payer adjudication/COB data is supported",
      { field: "coordinationOfBenefits", fixTarget: "claim" }
    );
  }

  const externalStedi =
    claim.payerConnectionMode === "LIVE" &&
    ["STEDI_TEST", "STEDI_PRODUCTION"].includes(
      String(claim.payerConnectorId || "").toUpperCase()
    );

  if (externalStedi) {
    const missing = [];
    if (!claim.claimForm) missing.push("claim form (837P/837I)");
    if (!claim.claimFilingCode) missing.push("claim filing code");
    if (!claim.patientDob) missing.push("patient DOB");
    if (!claim.patientGender) missing.push("patient gender");
    if (!claim.patientAddress1) missing.push("patient address");
    if (!claim.patientCity) missing.push("patient city");
    if (!claim.patientState) missing.push("patient state");
    if (!claim.patientPostalCode) missing.push("patient postal code");
    if (!claim.providerTin) missing.push("provider TIN");
    if (!claim.providerTaxonomyCode) missing.push("provider taxonomy");

    const dependent =
      claim.subscriberRelationship &&
      claim.subscriberRelationship !== "SELF";
    if (dependent) {
      if (!claim.subscriberId) missing.push("subscriber ID");
      if (!claim.subscriberName) missing.push("subscriber name");
      if (!claim.subscriberDob) missing.push("subscriber DOB");
      if (!claim.subscriberGender) missing.push("subscriber gender");
      if (!claim.subscriberAddress1) missing.push("subscriber address");
      if (!claim.subscriberCity) missing.push("subscriber city");
      if (!claim.subscriberState) missing.push("subscriber state");
      if (!claim.subscriberPostalCode) missing.push("subscriber postal code");
    }

    if (claim.claimForm === "PROFESSIONAL") {
      if (!claim.renderingProviderNpi) {
        missing.push("rendering provider NPI");
      } else if (
        String(claim.renderingProviderNpi) !== String(claim.billingProviderNpi || "") &&
        !String(claim.doctorName || "").trim()
      ) {
        missing.push("rendering provider name");
      }
      if ((claim.icd10Codes || []).filter(Boolean).length > 12) {
        missing.push("no more than 12 diagnosis codes");
      }
      if (verifiedServiceLines.length > 50) {
        missing.push("no more than 50 verified service lines");
      }
    }

    if (claim.claimForm === "INSTITUTIONAL") {
      if (!claim.admissionTypeCode) missing.push("admission type code");
      if (!claim.admissionSourceCode) missing.push("admission source code");
      if (!claim.patientStatusCode) missing.push("patient status code");
    }

    if (missing.length) {
      addIssue(
        issues,
        configured,
        defaults,
        "US_837_SUBMISSION_FIELDS",
        `External 837 submission requires: ${missing.join(", ")}`,
        { field: "claimFilingCode", fixTarget: "claim" }
      );
    }
  }

  if (
    !selfPay &&
    claim.priorAuthRequired === true &&
    (claim.priorAuthStatus !== "APPROVED" || !claim.authorizationNo)
  ) {
    addIssue(
      issues,
      configured,
      defaults,
      "US_PRIOR_AUTH",
      "Required prior authorization must be approved with an authorization number",
      { field: "authorizationNo", fixTarget: "journey" }
    );
  }

  if (
    !selfPay &&
    claim.priorAuthRequired === true &&
    claim.priorAuthStatus === "APPROVED" &&
    claim.priorAuthExpiry &&
    dos &&
    isoDateOnly(claim.priorAuthExpiry) < dos
  ) {
    addIssue(
      issues,
      configured,
      defaults,
      "US_PRIOR_AUTH",
      "Prior authorization expired before the date of service",
      { field: "priorAuthExpiry", fixTarget: "journey" }
    );
  }

  return issues;
}

export function usReadinessRuleCodes() {
  return US_READINESS_RULE_DEFAULTS.map((rule) => rule.code);
}
