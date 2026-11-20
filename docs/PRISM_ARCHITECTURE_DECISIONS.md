# PRISM architecture decisions

This is a lightweight durable decision log.

Use it for decisions that future engineers and ChatGPT sessions must understand. Fast-changing PR/CI state does not belong here.

---

## ADR-001 — GitHub and committed docs are the durable project memory

**Status:** Accepted

### Decision

PRISM development will not depend on a single long ChatGPT conversation.

The durable handoff system is:

- current GitHub `main` and tests
- `PRISM_MASTER_CONTEXT.md`
- `PRISM_CURRENT_STATE.md`
- `PRISM_100_ITEM_REMEDIATION.md`
- this decision log
- deployment/runbook docs

### Consequence

A new chat can resume work by reading the canonical files and reconciling them with live GitHub.

---

## ADR-002 — Financial correctness fails closed

**Status:** Accepted

### Decision

When required financial evidence is missing, ambiguous, conflicting, unreviewed, or unsupported, PRISM should return an explicit cannot-verify/review state rather than inventing a value or silently choosing a candidate.

### Examples

- conflicting payer EDI identifiers do not fall back to payer-name matching
- zero service-line units do not become one
- unknown patient responsibility remains unknown
- ambiguous contracts/fee terms should not be auto-selected
- unapproved contract terms should not execute
- unsupported pricing methods should route to review

---

## ADR-003 — Contract allowance and payer liability are different concepts

**Status:** Accepted

### Decision

A contractual allowed amount is not automatically expected payer payment.

Expected payer liability must account for verified patient responsibility.

### Example

```text
Contract allowance        $150
Verified patient share     $30
Expected payer liability  $120
Payer paid                $120
Underpayment                 $0
```

---

## ADR-004 — Payer-stated evidence is distinct from contract verification

**Status:** Accepted

### Decision

Payer/remittance values and adjustment reasons are preserved as payer-stated evidence.

They must not be labeled as contractual truth unless PRISM independently verifies the applicable contract/rate/provision.

---

## ADR-005 — Executable contract terms require source provenance and human review

**Status:** Accepted

### Decision

An executable contract term must be traceable to an original contract/schedule/amendment source and page/clause, and must be human-approved before it can drive automatic pricing.

OCR/AI extraction may assist ingestion but does not constitute approval.

---

## ADR-006 — Heuristic scores must be labeled truthfully

**Status:** Accepted

### Decision

Deterministic heuristic scores are not measured probabilities of correctness.

UI/API language should distinguish:

- heuristic signal
- model-reported signal
- validated outcome/metric

---

## ADR-007 — Small focused PRs over large remediation bundles

**Status:** Accepted

### Decision

The 100-item remediation program is executed in small connected batches.

Each batch should:

- re-check current code first
- define acceptance criteria
- include backend/UI together where necessary
- include regression/acceptance tests
- pass CI before merge
- update tracker/handoff state after merge

Stacked PR chains should be avoided where practical because they create rebase/conflict risk across shared schema/services.
