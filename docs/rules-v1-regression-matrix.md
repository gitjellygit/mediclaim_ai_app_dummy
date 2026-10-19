# Rules v1 Hardening Regression Matrix

Rules v1 is complete only when all automated checks and the manual scenarios below pass.

## Required lifecycle behavior

| Scenario | Expected result |
| --- | --- |
| Organization rule created while claim is DRAFT | Existing current check becomes stale; claim remains DRAFT; next check evaluates new rule. |
| Organization rule created while claim is NEEDS_REVIEW | Existing current check becomes stale; claim remains NEEDS_REVIEW. |
| Organization rule created while claim is READY | Existing current check becomes stale; claim moves to NEEDS_REVIEW; submission requires a new check. |
| Rule created after claim is SUBMITTED / DENIED / PAID | Historical check and lifecycle status remain unchanged. New policy is not applied retroactively. |
| Rule definition modified | Immutable RuleVersion snapshot is added; affected current checks become stale; next check uses new revision. |
| Rule severity modified | New revision is recorded; affected current checks become stale. |
| Rule enabled | Affected current checks become stale and READY claims reopen to NEEDS_REVIEW. |
| Rule disabled | Affected current checks become stale; next check no longer produces that rule issue. |
| Rule archived | Archive revision is retained; affected current checks become stale; rule disappears from active evaluation. |
| Archived code reused | Request is rejected. Rule code is an immutable identity. |
| Payer rule created | Only in-process claims matching its authoritative payer identity are invalidated. |
| Payer scope A -> B | Claims covered by both the old and new scope are invalidated. |
| Both payer name + EDI configured | EDI is authoritative. Name match cannot override EDI mismatch. |
| Payer name only | Normalized exact payer-name match is used. |
| Future rule is created | It is excluded before effectiveFrom. Fingerprint changes when it becomes active. |
| Rule expires | It is included through effectiveTo and excluded after the boundary; fingerprint changes. |
| Readiness check predates fingerprint support | Submission is blocked until readiness is refreshed. |
| Applicable fingerprint differs at submit | Submission fails with READINESS_RULESET_STALE. |
| Unrelated payer rule changes | Claim-specific fingerprint for another payer remains unchanged. |
| Simulation | Evaluates up to 1,000 current in-process claims and never mutates claim/check/rule state. |

## Validation and security

- ADMIN can list, simulate, create, edit, version and archive rules.
- CASHIER and RECEPTIONIST receive 403 for Rules APIs.
- Mandatory system rules cannot be disabled, downgraded or deleted.
- System rule codes cannot be shadowed by custom rules.
- Unknown fields are rejected.
- Operators are validated against the server-side field type, not just the UI.
- Removed free-form MATCHES cannot be created through the API.
- String operators: REQUIRED, EQUALS, NOT_EQUALS, IN, NOT_IN, STARTS_WITH, ENDS_WITH, CONTAINS, LENGTH_EQUALS, LENGTH_BETWEEN.
- Numeric operators: REQUIRED, EQUALS, NOT_EQUALS, IN, NOT_IN, >, >=, <, <=.
- Boolean operators: REQUIRED, EQUALS, NOT_EQUALS.
- Date operators: REQUIRED, EQUALS, NOT_EQUALS, BEFORE, ON_OR_BEFORE, AFTER, ON_OR_AFTER.
- Legacy stored MATCHES remains bounded only for backward compatibility; new configuration does not expose it.

## Derived fields

Regression coverage must include:
- diagnosisCount
- verifiedServiceLineCount
- documentCount
- serviceLineCount
- totalUnits
- totalServiceLineCharges
- claimVsLineChargeDifference
- claimAgeDays
- daysSinceService
- daysUntilFilingDeadline
- eligibilityAgeHours
- authorizationAgeDays

## Historical evidence

Every rule must have an immutable history row containing:
- monotonic revision
- display version label
- change type
- actor ID when available
- complete non-PHI rule snapshot
- creation timestamp

The current Rule record is operational state. RuleVersion is historical evidence and must never be updated by normal rule editing.

## Admin activation workflow

Recommended operating sequence:
1. Draft the controlled field/operator rule.
2. Run **Test Against Claims**.
3. Review affected/BLOCK/WARN counts.
4. Save/activate the rule.
5. Affected in-process claims are automatically marked stale.
6. READY claims return to NEEDS_REVIEW.
7. Users re-run readiness before submission.

## Manual sign-off checks

In addition to CI:
1. Create a BLOCK rule from the browser and confirm preview does not persist it.
2. Save it and confirm a READY matching claim moves to NEEDS_REVIEW.
3. Re-run readiness and confirm the new issue appears with the correct fix target.
4. Edit the rule and verify revision history shows both snapshots.
5. Disable it, re-run readiness, and confirm the issue disappears.
6. Archive it and verify active Rules list no longer shows it.
7. Verify history endpoint still shows the archived revision.
8. Repeat with a payer-scoped rule and confirm a different payer remains unaffected.
9. Verify a submitted claim remains historically unchanged.
10. Verify non-admin users cannot access Rules.
