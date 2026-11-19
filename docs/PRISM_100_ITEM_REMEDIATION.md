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
