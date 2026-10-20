# Submission Safety v1

Submission Safety v1 protects outbound 837 claims from duplicate transmission and unsupported billing modes.

## Atomic submission lifecycle

A claim must be READY before transmission. The submit route atomically acquires ownership:

```
READY -> SUBMITTING -> SUBMITTED
```

The READY -> SUBMITTING transition is a database compare-and-set. Concurrent requests cannot both own the same claim.

Each acquisition stores:
- a stable 17-character patient control number derived from the claim ID,
- a unique submission attempt ID,
- the submission start timestamp.

Only the owner attempt may release or complete the claim. A stale SUBMITTING state can be reclaimed after `CLAIM_SUBMISSION_LOCK_TIMEOUT_MS` (default 15 minutes). This protects against crashed workers while preventing a late old request from overwriting a newer retry.

For Stedi, an unchanged retry reuses the same patient control number, payload hash, and Idempotency-Key.

## Failure semantics

- Validation/configuration failures before lock acquisition do not change claim state.
- A definite payer rejection or normal connector error releases the owned lock back to READY.
- An outcome-unknown transmission remains SUBMITTING until status is reconciled or the stale timeout permits a controlled retry.
- A completed SUBMITTED claim cannot be retransmitted by calling /submit again.

## Primary claims only

Secondary and tertiary 837 submission is blocked at:
1. readiness,
2. /submit preflight, and
3. the Stedi claim mapper.

This release does not yet emit the required other-payer adjudication/COB loops.

## Prior authorization

When present, `authorizationNo` is mapped to:

```
claimInformation.claimSupplementalInformation.priorAuthorizationNumber
```

A claim marked as requiring prior authorization cannot submit without an approved status and authorization number.

## Minimum-necessary submit response

The submit response returns only operational submission fields. It does not return documents, storage paths, OCR text, document hashes, rule/check payloads, field provenance, or internal submission-lock identifiers.

## Regression gate

Required automated coverage includes:
- concurrent submit race: exactly one owner,
- active lock cannot be stolen,
- stale lock can be reclaimed,
- old owner cannot release/complete after reclaim,
- retry after successful submit is blocked,
- stable patient control number and Stedi idempotency,
- secondary/tertiary readiness and submit rejection,
- mapper-level COB rejection,
- prior authorization mapping,
- safe submit DTO and hidden lock metadata.
