export const RULE_CATEGORIES = Object.freeze([
  { id: "PATIENT_COVERAGE", label: "Patient & Coverage", description: "Member identity, coverage, subscriber and eligibility expectations." },
  { id: "PROVIDER", label: "Provider", description: "Billing, rendering, referring provider identifiers and enrollment data." },
  { id: "CLAIM", label: "Claim & 837", description: "Claim-form, submission, frequency, filing and transaction prerequisites." },
  { id: "CODING", label: "Coding", description: "Diagnosis, CPT/HCPCS, diagnosis linkage and code-level claim checks." },
  { id: "NCCI_MUE", label: "NCCI / MUE", description: "Versioned CMS correct-coding and units-of-service edit sources." },
  { id: "AUTHORIZATION", label: "Authorization", description: "Prior authorization requirement, approval and authorization-number checks." },
  { id: "DOCUMENTATION", label: "Documentation", description: "Required supporting evidence and document review expectations." },
  { id: "FINANCIAL", label: "Financial", description: "Billed amount, charge, payment and financial consistency controls." },
  { id: "PAYER", label: "Payer Policy", description: "Payer-specific administrative and contract rules." },
  { id: "WORKFLOW", label: "Workflow", description: "Operational state, review and submission guardrails." }
]);

export const CUSTOM_RULE_OPERATORS = Object.freeze([
  { id: "REQUIRED", label: "is required" },
  { id: "EQUALS", label: "equals" },
  { id: "NOT_EQUALS", label: "does not equal" },
  { id: "IN", label: "is one of" },
  { id: "NOT_IN", label: "is not one of" },
  { id: "GREATER_THAN", label: "is greater than" },
  { id: "GREATER_OR_EQUAL", label: "is at least" },
  { id: "LESS_THAN", label: "is less than" },
  { id: "LESS_OR_EQUAL", label: "is at most" },
  { id: "STARTS_WITH", label: "starts with" },
  { id: "ENDS_WITH", label: "ends with" },
  { id: "CONTAINS", label: "contains" },
  { id: "LENGTH_EQUALS", label: "length equals" },
  { id: "LENGTH_BETWEEN", label: "length is between" },
  { id: "BEFORE", label: "is before" },
  { id: "ON_OR_BEFORE", label: "is on or before" },
  { id: "AFTER", label: "is after" },
  { id: "ON_OR_AFTER", label: "is on or after" }
]);

export const CUSTOM_RULE_FIELDS = Object.freeze([
  { id: "patientName", label: "Patient name", type: "string", category: "PATIENT_COVERAGE", fixTarget: "claim" },
  { id: "patientDob", label: "Patient DOB", type: "date", category: "PATIENT_COVERAGE", fixTarget: "claim" },
  { id: "memberId", label: "Member ID", type: "string", category: "PATIENT_COVERAGE", fixTarget: "claim" },
  { id: "policyNo", label: "Policy number", type: "string", category: "PATIENT_COVERAGE", fixTarget: "claim" },
  { id: "groupNumber", label: "Group number", type: "string", category: "PATIENT_COVERAGE", fixTarget: "claim" },
  { id: "subscriberId", label: "Subscriber ID", type: "string", category: "PATIENT_COVERAGE", fixTarget: "claim" },
  { id: "subscriberRelationship", label: "Subscriber relationship", type: "string", category: "PATIENT_COVERAGE", fixTarget: "claim" },
  { id: "coordinationOfBenefits", label: "Payment responsibility", type: "string", category: "PATIENT_COVERAGE", fixTarget: "claim" },
  { id: "eligibilityStatus", label: "Eligibility status", type: "string", category: "PATIENT_COVERAGE", fixTarget: "eligibility" },
  { id: "billingProviderNpi", label: "Billing provider NPI", type: "string", category: "PROVIDER", fixTarget: "claim" },
  { id: "renderingProviderNpi", label: "Rendering provider NPI", type: "string", category: "PROVIDER", fixTarget: "claim" },
  { id: "referringProviderNpi", label: "Referring provider NPI", type: "string", category: "PROVIDER", fixTarget: "claim" },
  { id: "providerTin", label: "Provider TIN", type: "string", category: "PROVIDER", fixTarget: "claim" },
  { id: "providerTaxonomyCode", label: "Provider taxonomy", type: "string", category: "PROVIDER", fixTarget: "claim" },
  { id: "claimForm", label: "Claim form", type: "string", category: "CLAIM", fixTarget: "claim" },
  { id: "claimFilingCode", label: "Claim filing code", type: "string", category: "CLAIM", fixTarget: "claim" },
  { id: "claimFrequencyCode", label: "Claim frequency", type: "string", category: "CLAIM", fixTarget: "claim" },
  { id: "payerName", label: "Payer name", type: "string", category: "PAYER", fixTarget: "claim" },
  { id: "payerEdiId", label: "Payer EDI ID", type: "string", category: "PAYER", fixTarget: "claim" },
  { id: "dateOfService", label: "Date of service", type: "date", category: "CLAIM", fixTarget: "claim" },
  { id: "timelyFilingDeadline", label: "Timely filing deadline", type: "date", category: "CLAIM", fixTarget: "claim" },
  { id: "typeOfBill", label: "Type of bill", type: "string", category: "CLAIM", fixTarget: "claim" },
  { id: "diagnosisCount", label: "Diagnosis count", type: "number", category: "CODING", fixTarget: "claim" },
  { id: "verifiedServiceLineCount", label: "Verified service-line count", type: "number", category: "CODING", fixTarget: "serviceLines" },
  { id: "documentCount", label: "Supporting document count", type: "number", category: "DOCUMENTATION", fixTarget: "documents" },
  { id: "serviceLineCount", label: "Service-line count", type: "number", category: "CODING", fixTarget: "serviceLines" },
  { id: "totalUnits", label: "Total service units", type: "number", category: "CODING", fixTarget: "serviceLines" },
  { id: "totalServiceLineCharges", label: "Total service-line charges", type: "number", category: "FINANCIAL", fixTarget: "serviceLines" },
  { id: "claimVsLineChargeDifference", label: "Claim vs service-line charge difference", type: "number", category: "FINANCIAL", fixTarget: "serviceLines" },
  { id: "claimAgeDays", label: "Claim age in days", type: "number", category: "WORKFLOW", fixTarget: "claim" },
  { id: "daysSinceService", label: "Days since service", type: "number", category: "CLAIM", fixTarget: "claim" },
  { id: "daysUntilFilingDeadline", label: "Days until filing deadline", type: "number", category: "CLAIM", fixTarget: "claim" },
  { id: "eligibilityAgeHours", label: "Eligibility verification age in hours", type: "number", category: "PATIENT_COVERAGE", fixTarget: "eligibility" },
  { id: "authorizationAgeDays", label: "Prior authorization age in days", type: "number", category: "AUTHORIZATION", fixTarget: "prior-auth" },
  { id: "amount", label: "Claimed amount", type: "number", category: "FINANCIAL", fixTarget: "claim" },
  { id: "totalBilledAmount", label: "Total billed amount", type: "number", category: "FINANCIAL", fixTarget: "claim" },
  { id: "priorAuthRequired", label: "Prior authorization required", type: "boolean", category: "AUTHORIZATION", fixTarget: "prior-auth" },
  { id: "priorAuthStatus", label: "Prior authorization status", type: "string", category: "AUTHORIZATION", fixTarget: "prior-auth" },
  { id: "authorizationNo", label: "Authorization number", type: "string", category: "AUTHORIZATION", fixTarget: "prior-auth" }
]);

export const SYSTEM_RULE_CATALOG = Object.freeze([
  { code: "REQ_POLICY_NO", name: "Policy or member identifier present", description: "Requires at least one usable policy/member/subscriber identifier before submission.", category: "PATIENT_COVERAGE", severity: "BLOCK", mandatory: true, source: "SYSTEM" },
  { code: "RECOMMENDED_ICD", name: "ICD-10 diagnosis code present", description: "Warns when the claim does not contain a structured ICD-10 diagnosis code.", category: "CODING", severity: "WARN", mandatory: false, source: "SYSTEM" },
  { code: "US_NPI_VALID", name: "Provider NPI present and valid", description: "Checks the billing NPI and validates the 10-digit format of populated provider NPIs.", category: "PROVIDER", severity: "BLOCK", mandatory: true, source: "SYSTEM" },
  { code: "US_CPT_PRESENT", name: "Verified CPT/HCPCS service code present", description: "Requires at least one user-verified service line with a CPT/HCPCS code.", category: "CODING", severity: "BLOCK", mandatory: true, source: "SYSTEM" },
  { code: "US_DIAGNOSIS_CPT_LINK", name: "Diagnosis linked to each service line", description: "Requires verified service lines to point to a diagnosis present on the claim.", category: "CODING", severity: "BLOCK", mandatory: true, source: "SYSTEM" },
  { code: "US_TIMELY_FILING", name: "Claim is within recorded timely-filing deadline", description: "Blocks submission after the claim's recorded payer/contract filing deadline.", category: "CLAIM", severity: "BLOCK", mandatory: true, source: "SYSTEM" },
  { code: "US_MEMBER_ID", name: "Member ID present", description: "Requires a member identifier for the configured U.S. payer workflow.", category: "PATIENT_COVERAGE", severity: "BLOCK", mandatory: true, source: "SYSTEM" },
  { code: "US_COVERAGE_DOS", name: "Coverage period includes date of service", description: "When policy coverage dates are recorded, blocks a claim whose date of service falls outside that period.", category: "PATIENT_COVERAGE", severity: "BLOCK", mandatory: true, source: "SYSTEM" },
  { code: "US_SERVICE_DATE_CONSISTENCY", name: "Claim and service dates are consistent", description: "Blocks claims whose claim date of service falls outside a verified service-line date range.", category: "CODING", severity: "BLOCK", mandatory: true, source: "SYSTEM" },
  { code: "US_PRIOR_AUTH", name: "Required prior authorization resolved", description: "When prior authorization is required, requires approval and an authorization number.", category: "AUTHORIZATION", severity: "BLOCK", mandatory: true, source: "SYSTEM" },
  { code: "US_COB_PRIMARY_ONLY", name: "Secondary and tertiary billing disabled", description: "Blocks secondary and tertiary claim submission until other-payer adjudication/COB loops are implemented.", category: "CLAIM", severity: "BLOCK", mandatory: true, source: "SYSTEM" },
  { code: "US_837_SUBMISSION_FIELDS", name: "External 837 submission fields complete", description: "Checks additional patient, subscriber, provider and form data required by the configured external 837 connector.", category: "CLAIM", severity: "BLOCK", mandatory: true, source: "SYSTEM" }
]);

export const EXTERNAL_RULE_SOURCE_CATALOG = Object.freeze([
  { id: "CMS_NCCI_PTP", name: "CMS NCCI Procedure-to-Procedure edits", category: "NCCI_MUE", status: "CONNECTOR_READY", description: "Quarterly versioned import point for published CMS NCCI PTP edit files. No proprietary CPT descriptors are bundled." },
  { id: "CMS_MUE", name: "CMS Medically Unlikely Edits", category: "NCCI_MUE", status: "CONNECTOR_READY", description: "Quarterly versioned import point for publicly available CMS MUE values; confidential MUE values are not represented." },
  { id: "PAYER_POLICY", name: "Payer-specific policy rules", category: "PAYER", status: "CONFIGURABLE", description: "Organization-admin rules scoped to a payer name and/or payer EDI identifier." }
]);

export function systemRule(code) {
  return SYSTEM_RULE_CATALOG.find((item) => item.code === code) || null;
}

export function customRuleField(field) {
  return CUSTOM_RULE_FIELDS.find((item) => item.id === field) || null;
}


export const OPERATORS_BY_FIELD_TYPE = Object.freeze({
  string: Object.freeze(["REQUIRED", "EQUALS", "NOT_EQUALS", "IN", "NOT_IN", "STARTS_WITH", "ENDS_WITH", "CONTAINS", "LENGTH_EQUALS", "LENGTH_BETWEEN"]),
  number: Object.freeze(["REQUIRED", "EQUALS", "NOT_EQUALS", "IN", "NOT_IN", "GREATER_THAN", "GREATER_OR_EQUAL", "LESS_THAN", "LESS_OR_EQUAL"]),
  boolean: Object.freeze(["REQUIRED", "EQUALS", "NOT_EQUALS"]),
  date: Object.freeze(["REQUIRED", "EQUALS", "NOT_EQUALS", "BEFORE", "ON_OR_BEFORE", "AFTER", "ON_OR_AFTER"])
});

export function operatorsForField(field) {
  const meta = customRuleField(field);
  return meta ? (OPERATORS_BY_FIELD_TYPE[meta.type] || []) : [];
}
