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
