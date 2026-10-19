import { customRuleField } from "./ruleCatalog.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function hasValue(value) {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function normalizedScalar(value) {
  if (typeof value === "string") return value.trim().toUpperCase();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return value;
}

function dateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function numeric(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sum(values) {
  return values.reduce((total, value) => total + (numeric(value) || 0), 0);
}

function wholeDaysBetween(later, earlier) {
  const a = dateOnly(later);
  const b = dateOnly(earlier);
  if (a == null || b == null) return null;
  return Math.floor((a - b) / DAY_MS);
}

function derivedValue(claim, field, now = new Date()) {
  const lines = Array.isArray(claim?.serviceLines) ? claim.serviceLines : [];
  if (field === "diagnosisCount") {
    return Array.isArray(claim?.icd10Codes) ? claim.icd10Codes.filter(Boolean).length : 0;
  }
  if (field === "verifiedServiceLineCount") {
    return lines.filter((line) => line?.verified !== false && Boolean(line?.cptHcpcsCode)).length;
  }
  if (field === "documentCount") {
    return Array.isArray(claim?.documents) ? claim.documents.length : 0;
  }
  if (field === "serviceLineCount") return lines.length;
  if (field === "totalUnits") return sum(lines.map((line) => line?.units));
  if (field === "totalServiceLineCharges") return sum(lines.map((line) => line?.charge));
  if (field === "claimVsLineChargeDifference") {
    const claimAmount = numeric(claim?.totalBilledAmount ?? claim?.amount);
    if (claimAmount == null) return null;
    return Number((claimAmount - sum(lines.map((line) => line?.charge))).toFixed(2));
  }
  if (field === "claimAgeDays") return wholeDaysBetween(now, claim?.createdAt);
  if (field === "daysSinceService") return wholeDaysBetween(now, claim?.dateOfService);
  if (field === "daysUntilFilingDeadline") return wholeDaysBetween(claim?.timelyFilingDeadline, now);
  if (field === "eligibilityAgeHours") {
    if (!claim?.eligibilityCheckedAt) return null;
    const checked = new Date(claim.eligibilityCheckedAt);
    if (Number.isNaN(checked.getTime())) return null;
    return Math.floor((now.getTime() - checked.getTime()) / HOUR_MS);
  }
  if (field === "authorizationAgeDays") return wholeDaysBetween(now, claim?.priorAuthCheckedAt);
  return claim?.[field];
}

function listValue(value) {
  if (Array.isArray(value)) return value.map(normalizedScalar);
  if (typeof value === "string") {
    return value.split(",").map((item) => normalizedScalar(item)).filter(Boolean);
  }
  return [normalizedScalar(value)];
}

function lengthRange(expected) {
  if (Array.isArray(expected) && expected.length === 2) {
    return expected.map(Number);
  }
  if (typeof expected === "string") {
    const parts = expected.split(",").map((part) => Number(part.trim()));
    if (parts.length === 2) return parts;
  }
  return [NaN, NaN];
}

export function ruleExpectationPasses(actual, operator, expected) {
  if (operator === "REQUIRED") return hasValue(actual);

  const left = normalizedScalar(actual);
  const right = normalizedScalar(expected);

  if (operator === "EQUALS") return left === right;
  if (operator === "NOT_EQUALS") return left !== right;
  if (operator === "IN") return listValue(expected).includes(left);
  if (operator === "NOT_IN") return !listValue(expected).includes(left);

  if (["GREATER_THAN", "GREATER_OR_EQUAL", "LESS_THAN", "LESS_OR_EQUAL"].includes(operator)) {
    const leftNumber = Number(actual);
    const rightNumber = Number(expected);
    if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
    if (operator === "GREATER_THAN") return leftNumber > rightNumber;
    if (operator === "GREATER_OR_EQUAL") return leftNumber >= rightNumber;
    if (operator === "LESS_THAN") return leftNumber < rightNumber;
    return leftNumber <= rightNumber;
  }

  if (["STARTS_WITH", "ENDS_WITH", "CONTAINS"].includes(operator)) {
    if (!hasValue(actual) || !hasValue(expected)) return false;
    const a = String(actual).trim().toUpperCase();
    const e = String(expected).trim().toUpperCase();
    if (operator === "STARTS_WITH") return a.startsWith(e);
    if (operator === "ENDS_WITH") return a.endsWith(e);
    return a.includes(e);
  }

  if (operator === "LENGTH_EQUALS") {
    const target = Number(expected);
    return hasValue(actual) && Number.isInteger(target) && String(actual).length === target;
  }
  if (operator === "LENGTH_BETWEEN") {
    const [min, max] = lengthRange(expected);
    const length = hasValue(actual) ? String(actual).length : 0;
    return Number.isFinite(min) && Number.isFinite(max) && length >= min && length <= max;
  }

  if (["BEFORE", "ON_OR_BEFORE", "AFTER", "ON_OR_AFTER"].includes(operator)) {
    const leftDate = dateOnly(actual);
    const rightDate = dateOnly(expected);
    if (leftDate == null || rightDate == null) return false;
    if (operator === "BEFORE") return leftDate < rightDate;
    if (operator === "ON_OR_BEFORE") return leftDate <= rightDate;
    if (operator === "AFTER") return leftDate > rightDate;
    return leftDate >= rightDate;
  }

  // Backward compatibility only for any pre-hardening rule that already stored MATCHES.
  // New rules cannot select MATCHES through metadata/API validation.
  if (operator === "MATCHES") {
    if (!hasValue(actual) || !hasValue(expected) || String(expected).length > 100) return false;
    try {
      return new RegExp(String(expected), "i").test(String(actual));
    } catch {
      return false;
    }
  }

  return false;
}

export function ruleScopeMatches(rule, claim) {
  if (rule.scope !== "PAYER") return true;
  const payerName = String(claim?.payerName || claim?.connectedPayerName || "").trim().toLowerCase();
  const payerEdiId = String(claim?.payerEdiId || claim?.connectedPayerCode || "").trim().toLowerCase();
  const expectedName = String(rule.payerName || "").trim().toLowerCase();
  const expectedEdi = String(rule.payerEdiId || "").trim().toLowerCase();
  if (expectedEdi) return Boolean(payerEdiId && payerEdiId === expectedEdi);
  if (expectedName) return Boolean(payerName && payerName === expectedName);
  return false;
}

function withinEffectiveWindow(rule, now) {
  if (rule.effectiveFrom && new Date(rule.effectiveFrom).getTime() > now.getTime()) return false;
  if (rule.effectiveTo && new Date(rule.effectiveTo).getTime() < now.getTime()) return false;
  return true;
}

function predicatePasses(claim, predicate, now) {
  if (!predicate || typeof predicate !== "object") return true;
  if (!customRuleField(predicate.field)) return false;
  return ruleExpectationPasses(
    derivedValue(claim, predicate.field, now),
    predicate.operator,
    predicate.value
  );
}

function expectedMessage(rule, fieldMeta, definition) {
  if (rule.description) return rule.description;
  const operatorLabels = {
    REQUIRED: "is required",
    EQUALS: "must equal",
    NOT_EQUALS: "must not equal",
    IN: "must be one of",
    NOT_IN: "must not be one of",
    GREATER_THAN: "must be greater than",
    GREATER_OR_EQUAL: "must be at least",
    LESS_THAN: "must be less than",
    LESS_OR_EQUAL: "must be at most",
    STARTS_WITH: "must start with",
    ENDS_WITH: "must end with",
    CONTAINS: "must contain",
    LENGTH_EQUALS: "must have length",
    LENGTH_BETWEEN: "must have length between",
    BEFORE: "must be before",
    ON_OR_BEFORE: "must be on or before",
    AFTER: "must be after",
    ON_OR_AFTER: "must be on or after"
  };
  const suffix = definition.operator === "REQUIRED"
    ? ""
    : " " + (Array.isArray(definition.value) ? definition.value.join(", ") : (definition.value ?? ""));
  return (fieldMeta.label + " " + (operatorLabels[definition.operator] || "does not satisfy the configured rule") + suffix).trim();
}

export function evaluateConfiguredRules(claim, rules = [], { now = new Date() } = {}) {
  const issues = [];

  for (const rule of rules) {
    if (!rule || rule.enabled === false || rule.systemManaged === true) continue;
    if (!withinEffectiveWindow(rule, now) || !ruleScopeMatches(rule, claim)) continue;

    const definition = rule.definition;
    if (!definition || typeof definition !== "object") continue;

    const fieldMeta = customRuleField(definition.field);
    if (!fieldMeta) continue;

    if (definition.appliesWhen && !predicatePasses(claim, definition.appliesWhen, now)) continue;

    const actual = derivedValue(claim, definition.field, now);
    if (ruleExpectationPasses(actual, definition.operator, definition.value)) continue;

    issues.push({
      rule: rule.code,
      severity: ["INFO", "WARN", "BLOCK"].includes(rule.severity) ? rule.severity : "WARN",
      message: expectedMessage(rule, fieldMeta, definition),
      source: "ADMIN_RULE",
      category: rule.category || fieldMeta.category || "CLAIM",
      field: definition.field,
      fixTarget: fieldMeta.fixTarget || "claim",
      ruleVersion: rule.version || "1.0",
      ruleRevision: rule.revision || 1
    });
  }

  return issues;
}
