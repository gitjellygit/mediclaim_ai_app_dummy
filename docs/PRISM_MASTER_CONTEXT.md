# PRISM master context

This file is the durable project orientation for developers, reviewers, and future ChatGPT sessions.

**Do not use this file for fast-changing PR/CI status.** Use `docs/PRISM_CURRENT_STATE.md` and verify GitHub live.

## Product identity

**PRISM** = **Provider Revenue, Insurance & Submission Management**

Tagline: **AI-Assisted Healthcare Claims Management**

PRISM is a healthcare revenue-cycle / claims-management application focused on claim intake, readiness, payer submission, adjudication evidence, denials, appeals, payment variance, underpayment recovery, and operational decision support.

## Repository and stack

Repository: `gitjellygit/mediclaim_ai_app_dummy`

Core stack:

- PostgreSQL 16
- Backend: Node.js / Express / Prisma
- Frontend: React / Vite
- Backend local port: `4000`
- Frontend local port: `5173`

Local verification commands:

```bash
cd backend
npm test

cd ../frontend
npm run test:e2e:fast
```

## Environments

### Local development

Local development may use local document storage and synthetic data.

### Hostinger demo/UAT

The Hostinger deployment is **synthetic demo/UAT only**.

- install path: `/opt/jellygit/prism`
- Compose project: `prism-demo`
- API loopback: `127.0.0.1:4001`
- web loopback: `127.0.0.1:5174`
- public domains:
  - `https://prism.jellygit.com`
  - `https://api-prism.jellygit.com`
- PostgreSQL remains private to the Docker network
- Caddy is the public reverse proxy
- local persistent document storage is allowed only because this is synthetic demo/UAT

See:

- `docs/HOSTINGER_VPS_DEPLOYMENT.md`
- `docs/DEMO_DATA_AND_RELEASES.md`

### Real-PHI production

The current repository must not be described as HIPAA-compliant or production-ready for real PHI merely because technical safeguards exist.

Real-PHI production requires the production security/HIPAA gate, applicable BAAs/vendor agreements, deployment controls, S3/private object storage, IAM/KMS/networking/logging/retention controls, incident response, and the remaining production validation work.

See the production HIPAA go-live checklist in `docs/`.

## Core product areas

Current repository capabilities include:

- claim intake and claim detail
- document upload, OCR/classification, duplicate detection, and provenance
- readiness/completeness and medical consistency
- eligibility and prior authorization signals
- Claim Journey and payer lifecycle
- Stedi test/production connector safeguards
- professional claim submission paths
- simulated payer / clearinghouse lifecycle
- denial intelligence
- appeal workflow and appeal history
- remittance / 835 processing
- payment variance and underpayment recovery
- revenue-recovery workflow
- synthetic demo/UAT dataset

## Financial correctness principles

These are project-level invariants. Future changes should preserve them unless a documented architecture decision explicitly replaces them.

1. **Contract allowance is not automatically payer liability.**
   Expected payer liability must account for verified patient responsibility.

2. **Payer shortfall is not patient responsibility.**
   Missing patient responsibility remains unknown unless supported by payer/remittance or reviewed evidence.

3. **Financial calculations fail closed when material reference data is missing or ambiguous.**
   Do not invent a contract, rate, patient share, code-set result, or contractual conclusion.

4. **Explicit payer identifiers outrank payer-name similarity.**
   Conflicting payer EDI identifiers must not fall back to a name match.

5. **An explicit service-line unit value of zero is invalid.**
   It must never silently become one.

6. **Policy/rule applicability uses the appropriate business date.**
   Payer/clinical rules use service-date semantics; workflow rules may use evaluation time.

7. **Payer-stated expected payment is not the same as contract-verified expected payment.**
   UI and APIs must preserve that distinction.

8. **Executable contract terms require traceable source provenance and human review.**
   Unapproved OCR/AI/manual-extracted terms must not automatically price a claim.

9. **Heuristic scores are not measured probabilities.**
   UI should label deterministic heuristic signals truthfully.

10. **Unsupported pricing logic should be explicit.**
    Prefer a machine-readable manual-review state over silently applying an approximate formula.

## Demo data

The deterministic UAT dataset contains 60 synthetic claims across 12 workflow scenarios.

It is synthetic-only. The seed is designed to preserve non-`DEMO-UAT-` claims and is gated for the isolated demo VPS.

See `docs/DEMO_DATA_AND_RELEASES.md`.

## Source-of-truth hierarchy

When facts disagree, use this order:

1. **Live GitHub state and current `main`** for code, PRs, CI, branches, and merged behavior.
2. **Committed migrations/schema/tests** for implemented technical behavior.
3. **`docs/PRISM_100_ITEM_REMEDIATION.md`** for the remediation checklist and acceptance criteria.
4. **`docs/PRISM_CURRENT_STATE.md`** for a compact handoff snapshot.
5. **`docs/PRISM_ARCHITECTURE_DECISIONS.md`** for durable design decisions and rationale.
6. Chat history / memory only as supporting context.

Never let an old chat summary override current GitHub state.

## Canonical project documents

- `docs/PRISM_MASTER_CONTEXT.md` — stable project orientation and invariants
- `docs/PRISM_CURRENT_STATE.md` — current handoff snapshot
- `docs/PRISM_100_ITEM_REMEDIATION.md` — remediation program
- `docs/PRISM_ARCHITECTURE_DECISIONS.md` — durable decision log
- `docs/PRISM_CHAT_HANDOFF_PROTOCOL.md` — how a new work session should resume
- `docs/HOSTINGER_VPS_DEPLOYMENT.md` — deployment topology
- `docs/DEMO_DATA_AND_RELEASES.md` — demo seed, backup, restore, release

## Rule for future work

Before changing code:

1. read the master context;
2. read current state;
3. read the relevant checklist/decision entry;
4. verify `main`, open PRs, CI, and affected files live in GitHub;
5. re-check whether the requested behavior is already implemented;
6. work in a small focused PR;
7. add acceptance/regression tests;
8. update current state and the checklist after merge.
