# Denial & Appeal Intelligence — Test Plan

Feature scope: payer denial/partial approval → denial case → AI analysis → correction/appeal workflow → recovery tracking.

## 1. Case creation

### DEN-001 Payer status = DENIED
Expected: one active denial case is auto-created.

### DEN-002 Payer status = PARTIALLY_APPROVED
Expected: one active denial case is auto-created.

### DEN-003 Re-record same denied status
Expected: no duplicate active denial case.

### DEN-004 Manual case from valid claim
Expected: case created with source MANUAL.

### DEN-005 Manual case from unknown claim
Expected: 404.

### DEN-006 Active denial already exists
Expected: 409 with existing case reference.

### DEN-007 Revenue at risk with paid amount
Expected: claimed - paid, never below zero.

### DEN-008 Revenue at risk with allowed but no paid amount
Expected: claimed - allowed.

### DEN-009 No allowed/paid amount
Expected: claimed amount used as revenue at risk.

## 2. Payer/remittance fields

### CODE-001 Save Group Code
Expected: normalized uppercase.

### CODE-002 Save CARC
Expected: normalized uppercase.

### CODE-003 Save RARC
Expected: normalized uppercase.

### CODE-004 Reason text > 2000 chars
Expected: safely truncated.

### CODE-005 Invalid appeal deadline
Expected: 400 with readable message.

### CODE-006 Negative recovered amount
Expected: 400.

### CODE-007 Zero recovered amount
Expected: accepted.

## 3. AI/rule analysis

### AI-001 Authorization unresolved
Expected: category AUTHORIZATION and authorization-focused action.

### AI-002 Eligibility unresolved
Expected: category ELIGIBILITY.

### AI-003 No ICD-10 codes
Expected: category CODING.

### AI-004 No supporting documents
Expected: category DOCUMENTATION.

### AI-005 Final bill missing
Expected: FINAL_BILL suggested in required documents.

### AI-006 Reimbursement claim without discharge summary
Expected: DISCHARGE_SUMMARY suggested.

### AI-007 AI analysis stores provider/model
Expected: aiProvider, aiModel, aiAnalyzedAt and confidence saved.

### AI-008 LLM disabled
Expected: deterministic rule engine used; UI must explicitly say rules were used.

### AI-009 BAA flag false even with API key
Expected: external LLM is not called.

### AI-010 BAA flag true but API key missing
Expected: external LLM is not called.

### AI-011 BAA flag true + key + model configured
Expected: LLM path attempted.

### AI-012 LLM 500
Expected: retry once, then deterministic rules fallback.

### AI-013 LLM 429
Expected: retry once with delay.

### AI-014 LLM timeout
Expected: request aborted; rule fallback used.

### AI-015 LLM invalid JSON
Expected: rule fallback used.

### AI-016 LLM output contradicts grounded data
Expected: deterministic category/revenue-at-risk remains source of truth; LLM only supplies explanation/action/doc suggestions.

### AI-017 Direct identifiers
Expected: patient name, DOB, member ID, policy number, phone, address and authorization number are not included in LLM payload.

### AI-018 Payer free-text reason
Expected: excluded from LLM context by default.

### AI-019 Same facts, rule-only
Expected: deterministic result.

## 4. Appeal workflow

### APPEAL-001 OPEN → ANALYZED
Expected: valid.

### APPEAL-002 ANALYZED → CORRECTION_REQUIRED
Expected: valid.

### APPEAL-003 ANALYZED → APPEAL_PREPARED
Expected: valid.

### APPEAL-004 APPEAL_PREPARED → APPEAL_SUBMITTED
Expected: valid.

### APPEAL-005 CORRECTION_REQUIRED → RESUBMITTED
Expected: valid.

### APPEAL-006 APPEAL_SUBMITTED → OVERTURNED
Expected: valid.

### APPEAL-007 APPEAL_SUBMITTED → UPHELD
Expected: valid.

### APPEAL-008 Invalid status string
Expected: 400.

### APPEAL-009 Recovered amount after overturn
Expected: saved and dashboard recovery metric updates.

### APPEAL-010 Close case
Expected: removed from active denial metrics.

## 5. Dashboard / search

### UI-001 Empty state
Expected: clear guidance to create a denial by setting payer status DENIED/PARTIALLY_APPROVED.

### UI-002 Active denial count
Expected: active cases only.

### UI-003 Revenue at risk metric
Expected: sum of active denial cases.

### UI-004 Appeal eligible metric
Expected: count of active cases explicitly marked appeal-eligible.

### UI-005 Recovered metric
Expected: recovered amounts summed.

### UI-006 Top category
Expected: highest-frequency active category.

### UI-007 Search patient
Expected: matching denial cases.

### UI-008 Search payer
Expected: matching cases.

### UI-009 Search policy
Expected: matching cases.

### UI-010 Search insurer claim number
Expected: matching case.

### UI-011 Search CARC/RARC
Expected: matching case.

### UI-012 Filter by case status
Expected: only selected status shown.

### UI-013 Open detail drawer
Expected: correct claim/case data.

### UI-014 AI badge rule engine
Expected: "Rules AI" / deterministic rules.

### UI-015 AI badge LLM
Expected: "LLM + Rules" and configured model.

### UI-016 Loading failure
Expected: persistent modal with actual reason and retry path.

## 6. Error handling / concurrency

### ERR-001 Two users auto-create same denial concurrently
Expected: no unintended duplicate active workflow; add DB constraint/transaction if race is observed in load testing.

### ERR-002 Update deleted denial
Expected: 404.

### ERR-003 Analyze deleted denial
Expected: 404.

### ERR-004 Backend 500 on safe GET
Expected: read retry applies.

### ERR-005 Mutation failure
Expected: no blind auto-retry.

### ERR-006 User double-clicks AI analysis
Expected: UI disables action while request is running.

## 7. Authorization

### SEC-001 Unauthenticated list
Expected: 401.

### SEC-002 RECEPTIONIST views denial dashboard
Expected: read access allowed if current product policy permits.

### SEC-003 RECEPTIONIST modifies denial
Expected: 403.

### SEC-004 RECEPTIONIST runs AI analysis
Expected: 403.

### SEC-005 ADMIN/CASHIER update denial
Expected: allowed.

## 8. Audit / PHI

### HIPAA-001 Create denial
Expected: AuditEvent written with actor user ID, claim ID, action and outcome.

### HIPAA-002 Update denial
Expected: AuditEvent written.

### HIPAA-003 Run AI analysis
Expected: AuditEvent stores provider/model/LLM-used flag, not PHI.

### HIPAA-004 Application logs
Expected: no patient name, member ID, policy number, authorization number or payer reason text in denial/AI logs.

### HIPAA-005 Public document endpoint
Expected: no unauthenticated public document route exists.

### HIPAA-006 Debug endpoint
Expected: ADMIN + authenticated; returns counts only, no sample claim/document payloads.

### HIPAA-007 LLM guard
Expected: real external LLM disabled until explicit BAA configuration flag is true.

### HIPAA-008 Minimum necessary prompt
Expected: no direct identifiers in model input.

## 9. Investor demo regression

1. Create a clean claim.
2. Verify eligibility.
3. Resolve prior authorization.
4. Run AI readiness.
5. Submit.
6. In Claim Journey set payer status DENIED.
7. Open Denial Intelligence.
8. Confirm denial case auto-created and revenue at risk shown.
9. Open case.
10. Add CARC/RARC/category if available.
11. Run AI Analysis.
12. Show deterministic/LLM provider badge and confidence.
13. Show explanation, recommended action and supporting-document checklist.
14. Change status to APPEAL_PREPARED.
15. Set appeal deadline.
16. Change to APPEAL_SUBMITTED.
17. Record OVERTURNED + recovered amount.
18. Show recovered revenue metric update.

## 10. Important product language

Do not claim:
- payer denial reason was "predicted" when it was entered/received from payer data
- live payer verification when no connector exists
- HIPAA certification
- LLM use when aiProvider is RULE_ENGINE

Safe wording:
- "AI-assisted denial analysis"
- "Grounded denial explanation"
- "Rules + LLM decision support" only when aiProvider = OPENAI
- "HIPAA-ready controls / designed to support HIPAA-compliant deployment" subject to organizational safeguards and BAAs
