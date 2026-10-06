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
    code: "US_PRIOR_AUTH",
    name: "Required prior authorization resolved",
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
  const enabled = configured?.enabled ?? fallback.enabled;
  if (!enabled) return;

  issues.push({
    rule: code,
    severity: normalizeSeverity(configured?.severity, fallback.severity),
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

  if (!claim.memberId) {
    addIssue(
      issues,
      configured,
      defaults,
      "US_MEMBER_ID",
      "Member ID is required",
      { field: "memberId", fixTarget: "claim" }
    );
  }

  if (
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

  return issues;
}

export function usReadinessRuleCodes() {
  return US_READINESS_RULE_DEFAULTS.map((rule) => rule.code);
}
