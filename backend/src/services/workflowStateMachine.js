import { conflict } from "../errors/domainError.js";

const CLAIM_TRANSITIONS = {
  DRAFT: new Set(["DRAFT", "NEEDS_REVIEW", "READY", "SUBMITTED"]),
  NEEDS_REVIEW: new Set(["NEEDS_REVIEW", "DRAFT", "READY", "SUBMITTED"]),
  READY: new Set(["READY", "DRAFT", "NEEDS_REVIEW", "SUBMITTED"]),
  SUBMITTED: new Set(["SUBMITTED", "DENIED", "PAID"]),
  DENIED: new Set(["DENIED", "PAID"]),
  PAID: new Set(["PAID"])
};

const DENIAL_TRANSITIONS = {
  OPEN: new Set(["OPEN", "ANALYZED", "CORRECTION_REQUIRED", "APPEAL_PREPARED", "CLOSED"]),
  ANALYZED: new Set(["ANALYZED", "CORRECTION_REQUIRED", "APPEAL_PREPARED", "CLOSED"]),
  CORRECTION_REQUIRED: new Set(["CORRECTION_REQUIRED", "ANALYZED", "APPEAL_PREPARED", "RESUBMITTED", "CLOSED"]),
  APPEAL_PREPARED: new Set(["APPEAL_PREPARED", "APPEAL_SUBMITTED", "CORRECTION_REQUIRED", "CLOSED"]),
  APPEAL_SUBMITTED: new Set(["APPEAL_SUBMITTED", "OVERTURNED", "UPHELD", "CLOSED"]),
  RESUBMITTED: new Set(["RESUBMITTED", "OVERTURNED", "UPHELD", "CLOSED"]),
  OVERTURNED: new Set(["OVERTURNED", "CLOSED"]),
  UPHELD: new Set(["UPHELD", "APPEAL_PREPARED", "CLOSED"]),
  CLOSED: new Set(["CLOSED"])
};

function transitionError(entity, from, to) {
  return conflict(
    `Invalid ${entity} status transition: ${from} -> ${to}`,
    "INVALID_STATUS_TRANSITION"
  );
}

export function canTransitionClaim(from, to) {
  return Boolean(CLAIM_TRANSITIONS[from]?.has(to));
}

export function assertClaimTransition(from, to) {
  if (!canTransitionClaim(from, to)) throw transitionError("claim", from, to);
  return to;
}

export function canTransitionDenial(from, to) {
  return Boolean(DENIAL_TRANSITIONS[from]?.has(to));
}

export function assertDenialTransition(from, to) {
  if (!canTransitionDenial(from, to)) throw transitionError("denial case", from, to);
  return to;
}

export const claimTransitionMatrix = CLAIM_TRANSITIONS;
export const denialTransitionMatrix = DENIAL_TRANSITIONS;
