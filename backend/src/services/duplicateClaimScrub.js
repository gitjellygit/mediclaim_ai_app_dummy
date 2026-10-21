function day(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function signature(lines = []) {
  return lines
    .filter((line) => line.verified !== false)
    .map((line) => [
      String(line.cptHcpcsCode || "").trim().toUpperCase(),
      [...(line.modifiers || [])].map((v) => String(v).toUpperCase()).sort().join(","),
      day(line.serviceDateFrom) || "",
      day(line.serviceDateTo) || ""
    ].join("|"))
    .sort()
    .join(";");
}

export async function findLikelyDuplicateClaim(prisma, claim, organizationId) {
  const dos = claim.dateOfService;
  if (!dos || !claim.payerName || !claim.memberId) return null;

  const candidates = await prisma.claim.findMany({
    where: {
      id: { not: claim.id },
      organizationId,
      deletedAt: null,
      payerName: { equals: claim.payerName, mode: "insensitive" },
      memberId: claim.memberId,
      dateOfService: dos,
      status: { in: ["READY", "SUBMITTING", "SUBMITTED", "DENIED", "PAID"] }
    },
    include: {
      serviceLines: { orderBy: { createdAt: "asc" } }
    },
    take: 20
  });

  if (!candidates.length) return null;
  const currentSignature = signature(claim.serviceLines || []);

  return candidates.find((candidate) => {
    if (currentSignature && signature(candidate.serviceLines || []) !== currentSignature) {
      return false;
    }
    const sameAmount =
      claim.amount == null ||
      candidate.amount == null ||
      Number(claim.amount) === Number(candidate.amount);
    return sameAmount;
  }) || null;
}
