export const ACTIVE_DENIAL_CASE_STATUSES = [
  "OPEN",
  "ANALYZED",
  "CORRECTION_REQUIRED",
  "APPEAL_PREPARED",
  "APPEAL_SUBMITTED",
  "RESUBMITTED"
];

export function findActiveDenialCase(prismaClient, claimId) {
  return prismaClient.denialCase.findFirst({
    where: {
      claimId,
      status: { in: ACTIVE_DENIAL_CASE_STATUSES }
    },
    orderBy: { createdAt: "desc" }
  });
}
