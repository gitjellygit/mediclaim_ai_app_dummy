# AI Claim Creation from Documents — Test Plan

Feature scope: AI Claims workspace → Create Claim from Documents → OCR/classification/extraction → duplicate detection → patient/encounter matching → claim creation/merge.

## 1. Entry point and navigation

### AICREATE-001 AI Claims page
Expected: Manual New Claim and Create Claim from Documents actions are visible.

### AICREATE-002 Left navigation
Expected: standalone Document Intelligence item is not shown.

### AICREATE-003 Open AI creator
Expected: centered modal opens with workflow explanation.

### AICREATE-004 Close before processing
Expected: modal closes and temporary UI state resets next time it opens.

### AICREATE-005 Close while processing
Expected: modal remains open to avoid losing visible progress.

## 2. File selection

### AICREATE-010 Single PDF
Expected: accepted.

### AICREATE-011 Multiple PDFs
Expected: accepted and listed.

### AICREATE-012 PNG/JPG/JPEG
Expected: accepted.

### AICREATE-013 Unsupported file
Expected: persistent warning explains supported file types.

### AICREATE-014 Mixed supported/unsupported files
Expected: supported files remain selected; unsupported files are rejected with explanation.

### AICREATE-015 No files
Expected: Create Claim with AI remains disabled.

### AICREATE-016 Replace file selection
Expected: new selection replaces old queue; old results clear.

## 3. Sequential processing

### AICREATE-020 First document creates new claim
Expected: result = NEW and claim ID returned.

### AICREATE-021 Second same-encounter document
Expected: result = MERGED when matching score reaches auto-merge threshold.

### AICREATE-022 Candidate match 70–89
Expected: REVIEW status shown, not falsely represented as merged.

### AICREATE-023 Low match
Expected: NEW claim behavior remains explicit.

### AICREATE-024 Processing order
Expected: files process sequentially, not concurrently.

### AICREATE-025 One file fails, next succeeds
Expected: remaining files continue; final summary reports partial success.

### AICREATE-026 All files fail
Expected: no false success; each file shows failure reason.

### AICREATE-027 Duplicate file
Expected: duplicate backend protection returns clear failure/warning and creates no duplicate document.

### AICREATE-028 Renamed duplicate
Expected: SHA-256 duplicate detection still prevents duplication.

## 3A. Existing-claim patient identity validation

### IDVAL-001 Matching patient name
Expected: document attaches successfully.

### IDVAL-002 Clearly different patient name
Example: Alice Johnson claim + John Smith document.
Expected: HTTP 409 DOCUMENT_PATIENT_MISMATCH; document is not persisted or attached.

### IDVAL-003 Matching Member ID
Expected: strong identity match.

### IDVAL-004 Conflicting Member ID
Expected: upload blocked even if patient names are similar.

### IDVAL-005 Matching Policy Number
Expected: strong identity match.

### IDVAL-006 Conflicting Policy Number
Expected: upload blocked.

### IDVAL-007 Matching DOB
Expected: identity support recorded.

### IDVAL-008 Conflicting DOB
Expected: upload blocked.

### IDVAL-009 Middle-name variation
Example: John Smith vs John A Smith where normalized name containment applies.
Expected: do not falsely block solely for the common variation.

### IDVAL-010 No extractable identity
Expected: document may attach but response is UNVERIFIED; UI shows a persistent warning asking for review.

### IDVAL-011 Mismatch cleanup
Expected: rejected uploaded file is deleted from temporary storage.

### IDVAL-012 Mismatch persistence
Expected: no Document database row is created.

### IDVAL-013 Mismatch logging
Expected: log contains claim ID + conflict field names only, not patient names/member IDs/policy numbers.

### IDVAL-014 Claim Detail wrong-patient upload
Expected: centered warning title "Wrong patient document" with clear source/target patient message.

### IDVAL-015 Multi-document AI creation same patient
Expected: first file establishes claim; later files attach to that same claim and pass identity validation.

### IDVAL-016 Multi-document AI creation mixed patients
Example: Alice first, John second.
Expected: John upload is blocked; batch stops at mismatch; Alice claim remains intact.

### IDVAL-017 Submitted claim
Expected: existing lifecycle lock still takes precedence; no document attached.

## 4. AI visibility

### AICREATE-030 Document classification
Expected: result displays suggested document type.

### AICREATE-031 Classification confidence
Expected: confidence displayed when available.

### AICREATE-032 Extraction
Expected: resulting claim contains extracted patient/payer/clinical/financial fields.

### AICREATE-033 Patient/encounter matching
Expected: result explicitly displays NEW / MERGED / REVIEW.

### AICREATE-034 No extractable patient
Expected: claim/review behavior is clearly surfaced and never silently presented as high-confidence AI.

### AICREATE-035 AI failure
Expected: actual backend reason shown in persistent modal.

## 5. Claim result

### AICREATE-040 Successful workflow
Expected: claims list refreshes automatically.

### AICREATE-041 Open Claim
Expected: button opens the created/matched Claim Detail page.

### AICREATE-042 Multi-document same claim
Expected: Claim Detail shows all consolidated documents.

### AICREATE-043 Amount extraction
Expected: final bill populates claimed/billed values; no fake $1 placeholder.

### AICREATE-044 Readiness
Expected: new/changed claim remains DRAFT until required journey/readiness steps are completed.

## 6. Error/retry behavior

### AICREATE-050 Mutation retries
Expected: smart-upload POST is NOT blindly auto-retried.

### AICREATE-051 Network loss after possible server success
Expected: user sees failure; retrying same file is protected by file hash duplicate detection.

### AICREATE-052 Backend 409 duplicate
Expected: clear duplicate reason shown.

### AICREATE-053 Backend 500
Expected: per-file error retained; other queued files continue.

### AICREATE-054 Browser closes/reloads
Expected: no client-side assumption that an incomplete request failed; persisted backend state remains source of truth.

## 7. Security / HIPAA-ready controls

### AICREATE-060 Unauthenticated smart upload
Expected: 401.

### AICREATE-061 Uploaded PHI logs
Expected: patient/member/policy data are not written to application logs.

### AICREATE-062 Public document route
Expected: no unauthenticated PHI document route.

### AICREATE-063 Submitted claim
Expected: smart matching must not silently alter an already submitted claim.

### AICREATE-064 File names
Expected: server-generated stored file names are sanitized.

### AICREATE-065 Unsupported/malicious upload
Expected: production deployment must add malware/content scanning and enforce size/type limits.

## 8. Investor demo regression

1. Open AI Claims.
2. Click Create Claim from Documents.
3. Select Final Bill + Discharge Summary.
4. Show processing workflow explanation.
5. Run Create Claim with AI.
6. Show Final Bill classified + NEW.
7. Show Discharge Summary classified + MERGED.
8. Open Claim.
9. Show extracted patient, policy, diagnosis, dates, financials and both documents.
10. Re-upload exact Final Bill to demonstrate duplicate prevention.
11. Continue to Claim Journey / readiness workflow.

## 9. Known MVP behavior

- Multi-document uploads currently call the existing smart-upload endpoint sequentially.
- Encounter consolidation depends on extracted identity/date/provider signals and the current matching thresholds.
- A REVIEW result is intentionally not auto-merged.
- The older Document Intelligence route may remain internally available for operational/debug use, but it is no longer a primary navigation module.
