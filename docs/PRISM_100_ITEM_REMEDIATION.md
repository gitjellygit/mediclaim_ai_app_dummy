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


## Batch 2A — Contract payer liability

| Checklist item | Status | Acceptance |
| --- | --- | --- |
| #031 | Implemented in PR #233; CI/merge pending | Contract allowance, verified patient responsibility, and expected payer payment are separate sourced components; $150 allowance - $30 patient share = $120 payer liability |

## Batch 2B — Contract applicability and truthful basis

| Checklist item | Status in this branch | Acceptance addressed |
| --- | --- | --- |
| #033 | Implemented; automated tests added; CI pending | Contract applicability can be scoped by product/group, network, provider TIN and place of service; missing applicability facts fail closed |
| #035 | Implemented; automated tests added; CI pending | Equally applicable overlapping contracts and equally specific fee lines stop automatic pricing and expose candidates |
| #040 | Implemented; automated/UI tests added; CI pending | Contract-verified, payer-stated and unknown expected payment bases are distinguished; payer fallback never claims contractual compliance |
