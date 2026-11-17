# Recovery appeal history workflow

PRISM preserves appeal and recovery history so a later appeal does not overwrite the earlier submission.

## Behavior

- Re-running denial analysis after an appeal deadline is allowed for diagnostic purposes only.
- Re-analysis does not renew or extend payer appeal rights.
- Recording a late external submission requires a documented payer, contract, reconsideration, or other approved exception.
- Each submitted appeal is stored as an appeal attempt.
- Recovery events explain recovered dollars when transaction-level provenance is available.
- Legacy recovered amounts that predate recovery-event tracking are labeled as legacy snapshots instead of being assigned invented payment provenance.
- A new appeal or escalation cycle is available only after a failed/upheld outcome when an outstanding recoverable balance remains.

This document accompanies the appeal/recovery-history data model and UI introduced in PR #228.
