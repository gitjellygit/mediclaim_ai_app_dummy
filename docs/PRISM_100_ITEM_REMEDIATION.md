# PRISM 100-item remediation program

## Batch 1A — Financial correctness

Scope is intentionally limited to confirmed correctness defects.

| Item | Status | Acceptance |
| --- | --- | --- |
| Zero service-line units | Implemented; automated test added; VPS verification pending | Explicit `units=0` must never default to 1 or produce an expected payment |
| Payer/contract identity mismatch | Implemented; automated test added; VPS verification pending | Conflicting explicit payer EDI IDs must never fall back to payer-name matching |
| Patient responsibility vs payer shortfall | Implemented; automated test added; VPS verification pending | Missing patient responsibility must remain unknown; payer underpayment must not be shifted to the patient |
| Policy applicability date | Implemented; automated test added; VPS verification pending | Local eligibility must evaluate policy coverage on the claim DOS, not the current date |
| Missing payment reference signal | Implemented; automated test added; VPS verification pending | Posted local remittance without a payment reference must expose an explicit missing-reference signal |

### Deferred to Batch 1B

- confidence/readiness label semantics
- blocking vs warning presentation
- broader missing-reference/readiness UI
- manual correction/override messaging

### Merge gate

Batch 1A is complete only after:

1. backend lint/tests pass
2. full PR CI passes
3. PR is merged to `main`
4. hosted demo is updated
5. the four financial behaviors above are verified in the hosted environment


## Batch 2C — Contract term provenance and approval

| Checklist item | Status in this branch | Acceptance addressed |
| --- | --- | --- |
| #034 | Implemented; automated + E2E coverage added; CI pending | Contract/schedule/amendment source documents are first-class; every executable fee term carries document/page-or-clause provenance and review metadata; unapproved extracted terms cannot price claims |

Safety behavior:
- newly ingested contract terms start PENDING
- approval requires a source document plus page or clause
- reviewer identity and review timestamp are stored
- pricing ignores non-approved/unprovenanced terms and returns CONTRACT_TERM_REVIEW_REQUIRED
- calculation snapshots retain term-level source and reviewer provenance


## Batch 2D — Percentage-of-Medicare and percentage-of-charge pricing

| Checklist item | Status in this branch | Acceptance addressed |
| --- | --- | --- |
| #036 | Implemented; golden-case tests added; CI pending | Percentage-of-Medicare uses an explicit organization-owned schedule year/locality, reviewed contract percentage and HALF_UP cent rounding; percentage-of-charge uses verified billed line charge; missing schedule/year/rate/charge/review inputs fail closed |

Supported in this batch:
- PERCENT_MEDICARE
- PERCENT_CHARGE
- explicit schedule year, locality and effective dates
- reviewed percentage-term provenance
- HALF_UP cent rounding
- explicit missing/ambiguous reference failures

Not included here:
- multiple-procedure and bundling rules (#037)
- institutional/case-rate/per-diem/capitation methods (#038)


## Batch 2E — Contract provisions

| Checklist item | Status in this branch | Acceptance addressed |
| --- | --- | --- |
| #037 | Implemented; golden-case tests added; CI pending | Reviewed modifier percentages, multiple-procedure reductions, bundling exclusions and lesser-of-charge provisions alter contract pricing with clause-level evidence; unreviewed or unsupported clauses stop automatic pricing |

Golden cases:
- modifier percentage
- multiple-procedure secondary reduction
- bundled code exclusion
- lesser-of-charge
- unapproved provision
- unsupported clause routed to review


## Batch 2F — Institutional and alternative pricing scope

| Checklist item | Status in this branch | Acceptance addressed |
| --- | --- | --- |
| #038 | Implemented; scope tests added; CI pending | Institutional fee-schedule pricing and case-rate, per-diem, capitation and value-based methods are each explicitly recognized; unsupported methods fail closed with CONTRACT_REVIEW instead of being flattened into professional fee-schedule math |

Current support boundary:
- Professional FEE_SCHEDULE: supported
- Professional PERCENT_MEDICARE: supported
- Professional PERCENT_CHARGE: supported
- Institutional FEE_SCHEDULE: manual review required
- CASE_RATE: manual review required
- PER_DIEM: manual review required
- CAPITATION: manual review required
- VALUE_BASED: manual review required
