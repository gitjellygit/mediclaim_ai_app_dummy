# PRISM chat and handoff protocol

This document exists so PRISM development does not depend on one long ChatGPT conversation.

## Principle

**Chats are working sessions, not the project database.**

The durable project state belongs in:

- GitHub code and tests
- committed project documentation
- the remediation tracker
- architecture decisions
- deployment/runbook documentation

A chat may end, hit a message limit, or be replaced without losing the project.

## Start of every new ChatGPT session

Use this exact sequence.

### 1. Read the canonical files

Read:

1. `docs/PRISM_MASTER_CONTEXT.md`
2. `docs/PRISM_CURRENT_STATE.md`
3. `docs/PRISM_100_ITEM_REMEDIATION.md`
4. `docs/PRISM_ARCHITECTURE_DECISIONS.md`
5. any module-specific runbook relevant to the task

### 2. Verify live GitHub

Before making claims about current state, verify:

- current `main` SHA
- open PRs
- CI status for the active PR
- merged/closed PR state
- current affected files
- migration state in the repository

Never rely on an old chat statement such as "PR X is open" without checking.

### 3. Reconcile documentation against GitHub

If documentation and GitHub differ:

- GitHub wins for code/PR/CI facts
- update `PRISM_CURRENT_STATE.md` in the next appropriate documentation change
- do not silently propagate stale status

### 4. Work from acceptance criteria

For remediation work:

- find the original checklist item
- inspect current code first
- determine whether it is already implemented, partial, or missing
- implement only the smallest connected batch
- add regression/acceptance tests
- avoid giant multi-domain PRs

## End of a meaningful batch

Update documentation when any of these occurs:

- PR merged
- a checklist item changes state
- architecture decision changes
- deployment changes
- database/migration strategy changes
- support boundary changes
- a retained branch becomes superseded
- new operational dependency is introduced

### Update `PRISM_CURRENT_STATE.md`

Keep only useful handoff data:

- current focus
- active PR
- recent merged items
- retained work that is not in `main`
- next recommended sequence
- deployment delta

Do **not** turn it into a chronological chat transcript.

### Update `PRISM_100_ITEM_REMEDIATION.md`

For every affected item, distinguish:

- not started
- implemented
- automated tested
- CI passed
- merged
- deployed
- verified in hosted environment

Do not call an item "done" merely because code exists on a branch.

### Update architecture decisions only for durable decisions

Examples:

- financial calculations fail closed
- payer-stated vs contract-verified semantics
- human review required for executable contract terms
- unsupported pricing methods route to review

Do not record temporary PR numbers as architecture decisions.

## Recommended chat size

Do not intentionally keep all development in one chat.

A good boundary for a fresh chat is:

- after a major batch merges
- after deployment
- when moving to another domain
- when the conversation has become hard to navigate

Because the canonical context is committed, starting a new chat should be low-cost.

## Canonical new-chat prompt

Use:

> Continue PRISM / CLAIM APP development. First read the canonical handoff docs in the repo: PRISM_MASTER_CONTEXT, PRISM_CURRENT_STATE, PRISM_100_ITEM_REMEDIATION, and PRISM_ARCHITECTURE_DECISIONS. Then verify current GitHub main, open PRs, CI, and affected files live. GitHub is authoritative if the docs are stale. Continue from the next incomplete checklist item, work in a small focused PR, add acceptance/regression tests, and update the handoff docs after merge.

That prompt should be sufficient even when the previous chat is no longer writable.

## Source-of-truth rule for ChatGPT

When a user asks "where were we?", "continue", or "what is next?":

1. read the handoff docs;
2. check GitHub live;
3. answer from the reconciled state;
4. avoid asking the user to repeat project history that is already documented.

## Project files vs chat memory

Project memory and prior chats are useful supporting context, but they are not reliable enough to be the sole technical record.

Important technical state must be represented in GitHub or committed docs.

## What belongs where

| Information | Canonical location |
| --- | --- |
| code behavior | current `main` + tests |
| open/merged PR state | live GitHub |
| acceptance program | `PRISM_100_ITEM_REMEDIATION.md` |
| current handoff | `PRISM_CURRENT_STATE.md` |
| stable product/architecture context | `PRISM_MASTER_CONTEXT.md` |
| durable rationale | `PRISM_ARCHITECTURE_DECISIONS.md` |
| VPS deployment | `HOSTINGER_VPS_DEPLOYMENT.md` |
| backup/restore/demo release | `DEMO_DATA_AND_RELEASES.md` |
| temporary discussion | chat |

## Safety against stale context

Future sessions should never:

- merge a PR because an old chat said CI passed
- assume a branch is current without comparing it to `main`
- overwrite a newer schema with a retained branch's older full-file copy
- describe hosted code as updated until deployment is actually performed
- mark a checklist item deployed merely because it is merged
- treat synthetic demo readiness as real-PHI production readiness
