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
