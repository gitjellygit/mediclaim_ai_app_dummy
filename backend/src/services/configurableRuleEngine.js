import { customRuleField } from "./ruleCatalog.js";

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

function derivedValue(claim, field) {
  if (field === "diagnosisCount") {
    return Array.isArray(claim?.icd10Codes) ? claim.icd10Codes.filter(Boolean).length : 0;
  }
  if (field === "verifiedServiceLineCount") {
    return Array.isArray(claim?.serviceLines)
      ? claim.serviceLines.filter((line) => line?.verified !== false && Boolean(line?.cptHcpcsCode)).length
      : 0;
  }
  if (field === "documentCount") {
    return Array.isArray(claim?.documents) ? claim.documents.length : 0;
  }
  return claim?.[field];
}

function listValue(value) {
  if (Array.isArray(value)) return value.map(normalizedScalar);
  if (typeof value === "string") {
    return value.split(",").map((item) => normalizedScalar(item)).filter(Boolean);
  }
  return [normalizedScalar(value)];
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

  if (operator === "MATCHES") {
    if (!hasValue(actual) || !hasValue(expected)) return false;
    try {
      return new RegExp(String(expected), "i").test(String(actual));
    } catch {
      return false;
    }
  }

  return false;
}

function scopeMatches(rule, claim) {
  if (rule.scope !== "PAYER") return true;
  const payerName = String(claim?.payerName || claim?.connectedPayerName || "").trim().toLowerCase();
  const payerEdiId = String(claim?.payerEdiId || claim?.connectedPayerCode || "").trim().toLowerCase();
  const expectedName = String(rule.payerName || "").trim().toLowerCase();
  const expectedEdi = String(rule.payerEdiId || "").trim().toLowerCase();
  if (!expectedName && !expectedEdi) return false;
  return Boolean(
    (expectedName && payerName === expectedName) ||
    (expectedEdi && payerEdiId === expectedEdi)
  );
}

function withinEffectiveWindow(rule, now) {
  if (rule.effectiveFrom && new Date(rule.effectiveFrom).getTime() > now.getTime()) return false;
  if (rule.effectiveTo && new Date(rule.effectiveTo).getTime() < now.getTime()) return false;
  return true;
}

function predicatePasses(claim, predicate) {
  if (!predicate || typeof predicate !== "object") return true;
  if (!customRuleField(predicate.field)) return false;
  return ruleExpectationPasses(
    derivedValue(claim, predicate.field),
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
    MATCHES: "must match the configured pattern"
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
    if (!withinEffectiveWindow(rule, now) || !scopeMatches(rule, claim)) continue;

    const definition = rule.definition;
    if (!definition || typeof definition !== "object") continue;

    const fieldMeta = customRuleField(definition.field);
    if (!fieldMeta) continue;

    if (definition.appliesWhen && !predicatePasses(claim, definition.appliesWhen)) {
      continue;
    }

    const actual = derivedValue(claim, definition.field);
    if (ruleExpectationPasses(actual, definition.operator, definition.value)) {
      continue;
    }

    issues.push({
      rule: rule.code,
      severity: ["INFO", "WARN", "BLOCK"].includes(rule.severity) ? rule.severity : "WARN",
      message: expectedMessage(rule, fieldMeta, definition),
      source: "ADMIN_RULE",
      category: rule.category || fieldMeta.category || "CLAIM",
      field: definition.field,
      fixTarget: fieldMeta.fixTarget || "claim",
      ruleVersion: rule.version || "1.0"
    });
  }

  return issues;
}
