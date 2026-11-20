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


## Batch 1B — Readiness and truthfulness

This batch addresses four original checklist items from the November 17 review.

| Checklist item | Status in this PR | Acceptance addressed |
| --- | --- | --- |
| #021 Policy/rule effective-date semantics | Implemented; automated test added; VPS verification pending | Payer/clinical configured-rule windows use service date; WORKFLOW rules remain evaluation-time based |
| #022 Missing authoritative code reference signal | Implemented; automated test added; VPS verification pending | Required ICD/CPT reference data absence creates an explicit blocking issue instead of an empty issue list |
| #061 Readiness/risk semantics | Implemented; UI regression added; VPS verification pending | Validation readiness and rules-based risk are labeled as distinct signals, not payer outcome probabilities |
| #062 Heuristic confidence labels | Implemented; automated/UI regression added; VPS verification pending | Fixed document/denial heuristics are labeled heuristic/model-reported rather than measured correctness probability |

### Program status after Batch 1B opens

- Closed and merged: #032, #039
- In progress in Batch 1B: #021, #022, #061, #062
- Still open: 94 checklist items
- #031 remains open and is intentionally deferred to the contract/reimbursement foundation work; related patient-responsibility safeguards were added earlier but do not satisfy #031's acceptance criterion.

## Batch 2A — Contract payer liability

| Checklist item | Status | Acceptance |
| --- | --- | --- |
| #031 | Merged in PR #233; VPS verification pending | Contract allowance, verified patient responsibility, and expected payer payment are separate sourced components; $150 allowance - $30 patient share = $120 payer liability |

## Batch 2C — Contract term provenance and approval

| Checklist item | Status in this branch | Acceptance addressed |
| --- | --- | --- |
| #034 | Merged in PR #235; automated + E2E coverage passed; VPS verification pending | Contract/schedule/amendment source documents are first-class; every executable fee term carries document/page-or-clause provenance and review metadata; unapproved extracted terms cannot price claims |

Safety behavior:
- newly ingested contract terms start PENDING
- approval requires a source document plus page or clause
- reviewer identity and review timestamp are stored
- pricing ignores non-approved/unprovenanced terms and returns CONTRACT_TERM_REVIEW_REQUIRED
- calculation snapshots retain term-level source and reviewer provenance


## Program status snapshot — 2026-11-20

### Fully merged implementation — 10 / 100

- #021 — policy/rule effective-date semantics
- #022 — unavailable authoritative code-reference signal
- #031 — contract allowance vs verified patient share vs expected payer liability
- #032 — strict payer/contract identity behavior
- #034 — source provenance + human approval for executable contract terms
- #039 — explicit zero-unit handling
- #041 — ERA service-line reconciliation to original submitted line identity
- #042 — payer-stated adjustment evidence kept separate from contract interpretation
- #061 — truthful readiness/risk semantics
- #062 — truthful heuristic/model signal labels

### Engineered but not merged

The following retained branches contain prior implementation work that must be reconciled with current `main` before being counted as done:

- #033, #035, #040 — contract applicability / ambiguity / truthful expected-payment basis
- #036 — percentage-of-Medicare / percentage-of-charge pricing
- #037 — reviewed modifier / multiple-procedure / bundling / lesser-of provisions
- #038 — institutional and alternative pricing support boundary
- #043, #044 — provider-level adjustments and append-only financial ledger

### Next recommended implementation

Rebuild #043/#044 from current `main` now that #041/#042 are merged, preserving the new ERA service-line reconciliation behavior.
