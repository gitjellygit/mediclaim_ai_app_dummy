# PRISM current state

> **Snapshot date:** 2026-11-20
>
> This file is a handoff snapshot, not a substitute for live GitHub. At the start of every new session, verify `main`, open PRs, CI, and deployment state before acting.

## Current main

Snapshot main SHA:

```text
c2c36fba9a01e8a46d834dacbdbda5862a3f60ee
```

Snapshot latest main commit:

```text
Batch 3A: ERA line reconciliation and adjustment evidence (#041 #042)
```

**Always re-check this live.**

## Active work at this snapshot

PR #240 has been merged.

There is no active code PR for the next remediation batch yet.

The next code work should rebuild #043/#044 from current `main`, incorporating the now-merged #041/#042 ERA service-line reconciliation behavior.

The documentation handoff PR (#242) may still be open until these canonical files are merged.

## Remediation items already merged

The following original 100-item checklist items have merged implementation:

- #021 — policy/rule effective-date semantics
- #022 — explicit unavailable authoritative code-reference signal
- #031 — contract allowance vs verified patient share vs expected payer liability
- #032 — strict payer/contract identity behavior
- #034 — source provenance + human approval for executable contract terms
- #039 — explicit zero-unit handling
- #041 — ERA service-line reconciliation to original submitted line identity
- #042 — payer-stated adjustment evidence kept separate from contract interpretation
- #061 — truthful readiness/risk semantics
- #062 — truthful heuristic/model signal labels

These are implemented in `main`; hosted-demo verification may still be pending for individual items.

## Engineered work retained outside main

The following work was developed and tested in prior branches/PRs but is **not currently authoritative main behavior**. Do not assume it can be merged without reconciliation against current `main`.

### Contract applicability — #033, #035, #040

Retained branch:

```text
batch2/contract-applicability-rebased
```

Prior PR: #236 (closed during PR cleanup)

Scope:

- contract applicability by product/group, network, provider TIN, and place of service
- ambiguous contract / fee-schedule match detection
- contract-verified vs payer-stated vs unknown expected-payment basis

The prior branch had successful Automated Tests and CodeQL before later `main` changes created integration conflicts.

### Percentage pricing — #036

Retained branch:

```text
batch2/medicare-charge-pricing-stacked
```

Prior PR: #237 (closed during PR cleanup)

Scope:

- percentage-of-Medicare
- percentage-of-charge
- explicit schedule year/locality/effective dates
- reviewed pricing-term provenance
- cent rounding and fail-closed missing inputs

### Contract provisions — #037

Retained branch:

```text
batch2/contract-provisions-stacked
```

Prior PR: #238 (closed during PR cleanup)

Scope:

- modifier percentage
- multiple-procedure reduction
- bundling exclusion
- lesser-of-charge
- explicit manual review for unsupported/unapproved provisions

### Institutional / alternative pricing scope — #038

Retained branch:

```text
batch2/institutional-pricing-scope-stacked
```

Prior PR: #239 (closed during PR cleanup)

Scope:

- explicit support boundary for institutional fee schedule, case-rate, per-diem, capitation, and value-based methods
- unsupported methods route to contract review instead of approximate pricing

### Financial ledger — #043, #044

Retained branch:

```text
batch3/financial-event-ledger
```

Prior PR: #241 (closed during PR cleanup)

Scope:

- provider-level PLB adjustments
- append-only financial event ledger
- payment/reversal/correction events
- cumulative claim-paid amount
- replay/idempotency keys

The prior PR had successful Automated Tests and CodeQL before it was closed so it could later be reconciled safely with newer main changes and #041/#042.

## Repository cleanup state

At this snapshot the intent is to keep **only one active focused PR at a time**.

Old stacked/conflicted PRs were closed rather than force-merged. Their code branches were intentionally retained for later reconstruction/reconciliation.

## Recommended next sequence

1. Rebuild #043/#044 from current `main`, preserving the merged #041/#042 Stedi reconciliation behavior.
2. Test and merge #043/#044.
3. Reintroduce contract work from retained branches in small order:
   - #033/#035/#040
   - #036
   - #037
   - #038
4. Continue the 100-item remediation program with the next unimplemented payment/reconciliation items.

## Hostinger

Hostinger remains demo/UAT synthetic-only.

Before any hosted update:

1. verify current `main`;
2. use the backup-first release procedure in `docs/DEMO_DATA_AND_RELEASES.md`;
3. apply committed migrations;
4. check `/health/ready`;
5. verify synthetic client-demo flows;
6. update this file's deployment section if the hosted state materially changes.

## New-session instruction

A fresh PRISM work session should begin with:

> Read `docs/PRISM_MASTER_CONTEXT.md`, `docs/PRISM_CURRENT_STATE.md`, `docs/PRISM_100_ITEM_REMEDIATION.md`, and relevant architecture decisions. Then verify current GitHub `main`, open PRs, CI, and affected files live. GitHub is authoritative if documentation is stale. Continue from the next incomplete checklist item without rebuilding already-merged work.
