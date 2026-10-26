import { evaluateUsReadinessRules } from "./usReadinessRules.js";

export function liveMandatorySubmissionBlockers(claim, rules = []) {
  return evaluateUsReadinessRules(claim, rules).filter(
    (issue) => issue?.severity === "BLOCK"
  );
}
