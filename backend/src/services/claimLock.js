import { conflict } from "../errors/domainError.js";

export const LOCKED_CLAIM_STATUSES = new Set(["SUBMITTED", "DENIED", "PAID"]);

export function isClaimLocked(claim) {
  return Boolean(
    claim?.claimSubmissionDate ||
    LOCKED_CLAIM_STATUSES.has(claim?.status)
  );
}

export function isClaimSubmittedOrLater(claim) {
  return isClaimLocked(claim);
}

export function assertClaimEditable(
  claim,
  message = "Submitted or finalized claims are locked. Reopen or amend the claim first."
) {
  if (isClaimLocked(claim)) {
    throw conflict(message, "CLAIM_LOCKED");
  }
  return claim;
}
