# CLAIM APP Automated Test Report — 2026-09-28

## Scope

This pass focused on document download/preview security, document deletion lifecycle, claim-field consistency after document deletion, submitted-claim protection, bulk-delete safety, readiness invalidation, and frontend authentication of document actions.

Execution environment:
- GitHub Actions
- Node.js 20
- PostgreSQL 16
- Prisma migrations applied to a clean test database
- Backend integration tests + frontend production compilation

Workflow run: 36469067223

## Result

- Automated tests: **18**
- Passed: **18**
- Failed: **0**
- Frontend production compile: **PASS**
- Database migrations: **PASS**

## Product decision: deleting the only document

### Allowed
A user may delete the only supporting document when the claim is not submitted.

The claim is not deleted. Instead:
- the document is removed;
- previous readiness checks are invalidated;
- claim status returns to DRAFT;
- fields known to be document-derived are recomputed from remaining documents;
- if no supporting document remains, those document-derived fields become null/empty.

### Not allowed
Documents on a SUBMITTED claim remain locked and cannot be deleted through the normal workflow.

### Manual data protection
Deleting the last document must **not** wipe manually entered/verified claim information.

To support this, Claim now tracks documentDerivedFields. Only fields recorded as document-derived are recomputed/cleared.

Examples:
- AI-extracted amount from the deleted Final Bill -> cleared when no bill remains.
- AI-extracted diagnosis/ICD-10 -> cleared when no supporting document remains.
- Manually entered amount -> retained even if the only document is deleted.

## Issues found and fixed during this pass

### 1. Hidden Document Intelligence download/preview lost authentication
The old standalone page remained internally routable after it was removed from navigation. Its direct download and iframe preview did not send a bearer token, so protected document routes could fail.

**Fix:** both download and preview now use authenticated requests.

### 2. PHI preview caching
Document preview used public cache behavior.

**Fix:** protected preview/download responses now use private, no-store.

### 3. Stored document path hardening
Download/preview now resolve the stored filename within the configured upload directory and do not expose server filesystem paths in 404 responses.

### 4. Last-document deletion left stale AI-extracted fields
Previously, deleting the only Final Bill could leave amount/diagnosis values on the claim even though their supporting source was gone.

**Fix:** document-derived field provenance was added and those values are now recomputed/cleared.

### 5. Multi-document recomputation
When one of several supporting documents is deleted, document-derived values are recalculated from the documents that remain instead of simply becoming blank.

## Automated cases executed

| # | Scenario | Result |
|---|---|---|
| 01 | Download without authentication | PASS — 401 |
| 02 | Authenticated download returns exact bytes | PASS |
| 03 | Authenticated preview returns exact bytes + private/no-store | PASS |
| 04 | Missing document returns 404 without filesystem disclosure | PASS |
| 05 | Stored path traversal cannot escape upload directory | PASS |
| 06 | Delete only document from DRAFT claim | PASS |
| 07 | Last document deletion clears document-derived amount/billed amount | PASS |
| 08 | Last document deletion clears derived diagnosis/ICD-10 | PASS |
| 09 | Manually entered claim fields survive document deletion | PASS |
| 10 | Delete one of two bills -> amount recomputed from remaining bill | PASS |
| 11 | Document mutation invalidates readiness check and resets to DRAFT | PASS |
| 12 | Submitted claim document deletion blocked | PASS — 409 |
| 13 | Bulk delete containing submitted document is atomic | PASS |
| 14 | AI readiness detects no supporting documents after deletion | PASS |
| 15 | Provenance helper clears only document-derived fields | PASS |
| 16 | Hidden Document Intelligence download/preview sends bearer auth | PASS |
| 17 | Claim Detail download/preview sends bearer auth | PASS |
| 18 | Document route contains no public PHI preview caching | PASS |

## Regression behavior after deleting the last document

For a claim whose amount and diagnosis came from documents:

Before:
- Documents: 1
- Amount: $1,200
- Diagnosis: populated
- Readiness may have existed

After deleting the only document:
- Documents: 0
- Amount: null / —
- Total billed: null / —
- Diagnosis: null / — when document-derived
- ICD-10: empty when document-derived
- Status: DRAFT
- Previous readiness checks: removed
- New AI check: BLOCK — No supporting documents uploaded

For manually entered fields, the values remain.

## Known migration/legacy-data note

documentDerivedFields is newly introduced. New document-created claims and future document-populated fields are tracked correctly.

Claims created before this migration do not automatically have historical field-level provenance. For old test/demo claims, either:
- recreate the claim through the current AI document workflow, or
- perform an explicit reviewed backfill rather than guessing which historical values were manually entered.

This conservative behavior avoids accidentally erasing manually verified historical data.

## Follow-up test areas

Recommended next automated expansion:
- patient identity mismatch upload integration with actual PDF fixtures;
- exact duplicate/renamed duplicate SHA-256 integration;
- authorization by role for document deletion/download;
- simultaneous delete/update concurrency;
- malformed/oversized/malicious upload tests;
- audit-event coverage for preview/download/delete;
- claim search scale/load test;
- denial/appeal lifecycle integration tests;
- LLM fallback/timeout tests with mocked provider;
- tenant isolation before multi-customer production deployment.