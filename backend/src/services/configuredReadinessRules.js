/**
 * Map supported admin rules onto live readiness issues.
 * Mandatory submission blockers cannot be disabled or downgraded in the UI.
 * An unknown rule code has no effect on readiness.
 */
export function configuredReadinessIssue(rules, { code, severity, message, mandatory = false }) {
  const rule = (rules || []).find((entry) => entry.code === code);
  if (!mandatory && rule?.enabled === false) return null;
  const requested = ["INFO", "WARN", "BLOCK"].includes(rule?.severity)
    ? rule.severity
    : severity;
  return {
    rule: code,
    severity: mandatory ? "BLOCK" : requested,
    message
  };
}
