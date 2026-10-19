import { conflict } from "../errors/domainError.js";

export async function assertExpectedClaimStatus(
  tx,
  claimId,
  expectedStatus,
  {
    organizationId = null,
    code = "CLAIM_STATE_CHANGED",
    message = "Claim state changed while this action was in progress. Refresh and retry."
  } = {}
) {
  const result = await tx.claim.updateMany({
    where: {
      id: claimId,
      status: expectedStatus,
      ...(organizationId ? { organizationId } : {}),
      deletedAt: null
    },
    // A same-value status write is a compare-and-set barrier. If another
    // request acquired SUBMITTING after our initial read, count is zero and
    // no dependent mutation may proceed.
    data: { status: expectedStatus }
  });

  if (result.count !== 1) {
    throw conflict(message, code);
  }

  return expectedStatus;
}

export async function updateClaimFromExpectedStatus(
  tx,
  claimId,
  expectedStatus,
  data,
  options = {}
) {
  const result = await tx.claim.updateMany({
    where: {
      id: claimId,
      status: expectedStatus,
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      deletedAt: null
    },
    data
  });

  if (result.count !== 1) {
    throw conflict(
      options.message ||
        "Claim state changed while this action was in progress. Refresh and retry.",
      options.code || "CLAIM_STATE_CHANGED"
    );
  }

  return true;
}
