const ACTIVE_DENIAL_STATUSES = [
  "OPEN",
  "ANALYZED",
  "CORRECTION_REQUIRED",
  "APPEAL_PREPARED",
  "APPEAL_SUBMITTED",
  "RESUBMITTED"
];

function asMoney(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : 0;
}

export async function syncDenialRecoveryFromPayment(tx, {
  claimId,
  paidAmount
}) {
  const paid = asMoney(paidAmount);
  if (!claimId || paid <= 0) return null;

  const denial = await tx.denialCase.findFirst({
    where: {
      claimId,
      status: { in: ACTIVE_DENIAL_STATUSES }
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
  });
  if (!denial) return null;

  const atRisk = asMoney(denial.revenueAtRisk);
  const recovered = atRisk > 0 ? Math.min(atRisk, paid) : paid;
  const fullyRecovered = atRisk > 0 && recovered >= atRisk;

  return tx.denialCase.update({
    where: { id: denial.id },
    data: {
      recoveredAmount: recovered,
      status: fullyRecovered ? "OVERTURNED" : denial.status
    }
  });
}
