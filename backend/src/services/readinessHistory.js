/**
 * AI readiness history helpers.
 *
 * Readiness checks are evidence snapshots, not disposable cache entries.
 * Meaningful claim changes mark existing checks stale so the UI can explain
 * why a fresh check is required and compare the new score with the old one.
 */

export async function markReadinessChecksStale(
  prisma,
  claimIds,
  reason = "Claim data changed"
) {
  const ids = Array.isArray(claimIds) ? claimIds.filter(Boolean) : [claimIds].filter(Boolean);
  if (!ids.length) return { count: 0 };

  return prisma.check.updateMany({
    where: {
      claimId: { in: ids },
      isStale: false
    },
    data: {
      isStale: true,
      staleAt: new Date(),
      staleReason: reason
    }
  });
}

export function compareReadinessChecks(current, previous) {
  if (!current) {
    return {
      previousScore: null,
      scoreDelta: null,
      resolvedIssues: [],
      newIssues: []
    };
  }

  const previousIssues = Array.isArray(previous?.issues) ? previous.issues : [];
  const currentIssues = Array.isArray(current?.issues) ? current.issues : [];

  const previousMessages = new Set(previousIssues.map((item) => item?.message).filter(Boolean));
  const currentMessages = new Set(currentIssues.map((item) => item?.message).filter(Boolean));

  return {
    previousScore: previous?.score ?? null,
    scoreDelta:
      previous?.score == null ? null : Number(current.score) - Number(previous.score),
    resolvedIssues: previousIssues.filter(
      (item) => item?.message && !currentMessages.has(item.message)
    ),
    newIssues: currentIssues.filter(
      (item) => item?.message && !previousMessages.has(item.message)
    )
  };
}
