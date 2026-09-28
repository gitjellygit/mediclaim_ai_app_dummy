# Claim Journey — Test Plan

Feature: Eligibility → Prior Authorization → Claim → Claim Status → Remittance

## Test data assumptions
- Use synthetic/demo patient data only.
- A claim can be created manually or through Document Intelligence.
- Live payer/clearinghouse integration is not configured in this MVP.
- Eligibility and prior-auth actions are local pre-checks / recorded workflow decisions.

## 1. Journey load and navigation

### CJ-001 Journey page loads
Expected: Claim selector and five stages are visible.

### CJ-002 No claims exist
Expected: Empty-state message, no crash.

### CJ-003 Claim selector changes claim
Expected: All stage data refreshes for selected claim.

### CJ-004 Claim API returns 500 temporarily
Expected: safe GET retry runs automatically; after retry exhaustion error is shown with manual Retry button.

### CJ-005 Claim not found
Expected: clear error, no stale data from previous claim.

### CJ-006 Refresh button
Expected: claims and selected journey refresh without duplicate side effects.

### CJ-007 Direct Claim Detail navigation
Expected: Review/Open Claim opens correct claim.

## 2. Eligibility stage

### ELIG-001 Complete member/policy/payer data
Expected: pre-check = VERIFIED, coverage = ACTIVE.

### ELIG-002 Missing Member ID
Expected: NEEDS_REVIEW; no downstream auth action.

### ELIG-003 Missing Policy Number
Expected: NEEDS_REVIEW.

### ELIG-004 Missing Payer
Expected: NEEDS_REVIEW.

### ELIG-005 Expired policy
Expected: FAILED, coverage = INACTIVE.

### ELIG-006 Policy start date in future
Expected: FAILED, coverage = NOT_YET_ACTIVE.

### ELIG-007 Eligibility rerun
Expected: result updates idempotently; no duplicate records are created.

### ELIG-008 Eligibility changes after READY claim
Expected: old AI readiness check is invalidated and claim returns to DRAFT.

### ELIG-009 Server failure
Expected: actionable error and Retry; no false VERIFIED state.

### ELIG-010 Logging
Expected: log contains claim ID/action/result only; no patient/member PHI.

## 3. Prior Authorization stage

### AUTH-001 Eligibility not verified
Expected: stage visible but disabled; backend returns 409 if called directly.

### AUTH-002 Auth not required
Expected: status = NOT_REQUIRED and claim stage becomes actionable.

### AUTH-003 Auth required with authorization number
Expected: status = APPROVED.

### AUTH-004 Auth required without authorization number
Expected: status = REQUIRED and claim submission remains blocked.

### AUTH-005 Auth requirement unknown
Expected: stage cannot be finalized from UI.

### AUTH-006 Invalid expiry date
Expected: 400 validation error.

### AUTH-007 Update authorization number
Expected: status recalculates correctly.

### AUTH-008 Auth update after READY
Expected: stale AI readiness is removed and claim returns to DRAFT.

### AUTH-009 Server failure
Expected: no automatic mutation retry; clear Retry/error behavior.

### AUTH-010 Logging
Expected: no authorization number or PHI is written to logs.

## 4. Claim readiness integration

### READY-001 Eligibility not verified + Run AI Check
Expected: BLOCK issue "Eligibility has not been verified"; claim remains DRAFT.

### READY-002 Prior auth unresolved + Run AI Check
Expected: BLOCK issue "Prior authorization requirement is unresolved".

### READY-003 Eligibility VERIFIED + Auth NOT_REQUIRED + valid claim
Expected: AI readiness can reach READY.

### READY-004 Eligibility VERIFIED + Auth APPROVED + valid claim
Expected: AI readiness can reach READY.

### READY-005 Missing amount
Expected: blocking readiness issue.

### READY-006 Missing policy
Expected: blocking readiness issue.

### READY-007 Missing documents
Expected: blocking readiness issue.

### READY-008 Editing claim after readiness
Expected: checks deleted, status DRAFT, rerun required.

### READY-009 Upload/delete/reprocess document after readiness
Expected: checks deleted, status DRAFT.

## 5. Submission gating

### SUB-001 DRAFT claim
Expected: Submit disabled.

### SUB-002 READY but eligibility not VERIFIED
Expected: frontend disabled and backend rejects.

### SUB-003 READY but auth unresolved
Expected: frontend disabled and backend rejects.

### SUB-004 READY + eligibility VERIFIED + auth resolved
Expected: Submit succeeds.

### SUB-005 Submit success
Expected:
- status = SUBMITTED
- claimSubmissionDate set
- payerClaimStatus = SUBMITTED
- claimStatusCheckedAt set
- remittanceStatus = AWAITING

### SUB-006 Submit twice
Expected: second request rejected.

### SUB-007 Submitted claim edit
Expected: backend 409 and UI hides edit.

### SUB-008 Submitted claim document upload
Expected: blocked.

### SUB-009 Submitted claim document delete
Expected: blocked.

### SUB-010 Submitted claim delete
Expected: blocked.

## 6. Claim Status stage

### STATUS-001 Claim not submitted
Expected: stage visible but read-only.

### STATUS-002 Record ACKNOWLEDGED
Expected: saved with timestamp.

### STATUS-003 Record IN_REVIEW
Expected: saved.

### STATUS-004 Record APPROVED
Expected: saved.

### STATUS-005 Record PARTIALLY_APPROVED
Expected: saved.

### STATUS-006 Record DENIED
Expected: saved.

### STATUS-007 Record PAID
Expected: claim status transitions to PAID.

### STATUS-008 Invalid payer status
Expected: 400 validation error.

### STATUS-009 Server failure
Expected: clear error; user-triggered retry only.

## 7. Remittance stage

### REM-001 Claim not submitted
Expected: stage read-only.

### REM-002 Submission initializes AWAITING
Expected: remittance stage becomes actionable.

### REM-003 Record RECEIVED
Expected: remittanceReceivedAt populated.

### REM-004 Record POSTED with paid amount
Expected: claim status becomes PAID.

### REM-005 Negative allowed amount
Expected: 400.

### REM-006 Negative patient responsibility
Expected: 400.

### REM-007 Negative paid amount
Expected: 400.

### REM-008 Paid amount > allowed amount
Expected: 400.

### REM-009 Zero patient responsibility
Expected: accepted.

### REM-010 Payment reference
Expected: saved and displayed after refresh.

### REM-011 No payment reference
Expected: accepted when optional.

### REM-012 Server failure
Expected: no automatic mutation retry; user can explicitly retry.

## 8. UI gating

### UI-001 All five stages visible from start
Expected: yes.

### UI-002 Downstream stage locked
Expected: visible with explanation, not hidden.

### UI-003 Eligibility complete
Expected: Prior Auth becomes actionable.

### UI-004 Prior Auth complete
Expected: Claim stage becomes actionable.

### UI-005 Claim submitted
Expected: Status and Remittance become actionable.

### UI-006 Responsive layout
Expected: five cards stack cleanly on smaller screens.

### UI-007 Loading state
Expected: spinner/skeleton, no partial stale data.

### UI-008 Error state
Expected: error alert and Retry action.

### UI-009 Double-click action button
Expected: button disabled while request in progress.

### UI-010 Refresh after mutation
Expected: latest persisted stage data shown.

## 9. API/error/retry behavior

### API-001 Journey GET network error
Expected: up to 3 safe read attempts with exponential backoff.

### API-002 Journey GET 500
Expected: retried.

### API-003 Journey GET 400/404
Expected: not automatically retried.

### API-004 POST/PATCH transient failure
Expected: not automatically retried to avoid duplicate side effects.

### API-005 Validation error
Expected: exact backend message displayed.

### API-006 Authentication expiry
Expected: existing API client auth handling applies.

## 10. Security / privacy

### SEC-001 Unauthenticated journey endpoint
Expected: 401.

### SEC-002 PHI in logs
Expected: none from journey logs.

### SEC-003 Direct endpoint bypass of UI gating
Expected: backend enforces eligibility/auth/submission prerequisites.

### SEC-004 Invalid numeric payload
Expected: rejected.

### SEC-005 Invalid date payload
Expected: rejected.

## 11. Investor demo regression flow

1. Upload Final Bill.
2. Upload Discharge Summary and show merge.
3. Open Claim Journey.
4. Eligibility pre-check → VERIFIED.
5. Prior Auth → choose Not Required OR enter authorization number → APPROVED.
6. Open Claim.
7. Run AI Check → READY.
8. Approval Intelligence → Ready count = 1, Submitted = 0.
9. Submit Claim.
10. Claim Detail → Submitted + locked.
11. Approval Intelligence → Ready = 0, Submitted = 1.
12. Claim Journey → Claim Status + Remittance unlock.
13. Record ACKNOWLEDGED / IN_REVIEW.
14. Record remittance.
15. Confirm payable/paid lifecycle.

## 12. Known MVP limitation

Eligibility and prior authorization are not live payer transactions yet. The UI and backend deliberately label them as local pre-check / recorded workflow decisions. A payer, clearinghouse, or standards-based connector should replace these implementations before claiming real-time eligibility or authorization verification.
