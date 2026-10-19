import { ruleScopeMatches } from "./configurableRuleEngine.js";

const IN_PROCESS_STATUSES = ["DRAFT", "NEEDS_REVIEW", "READY"];

export function ruleSnapshot(rule) {
  return {
    code: rule.code,
    name: rule.name,
    description: rule.description || null,
    category: rule.category,
    severity: rule.severity,
    enabled: Boolean(rule.enabled),
    ruleType: rule.ruleType,
    systemManaged: Boolean(rule.systemManaged),
    mandatory: Boolean(rule.mandatory),
    scope: rule.scope,
    payerName: rule.payerName || null,
    payerEdiId: rule.payerEdiId || null,
    definition: rule.definition || null,
    source: rule.source,
    version: rule.version,
    revision: rule.revision || 1,
    effectiveFrom: rule.effectiveFrom ? new Date(rule.effectiveFrom).toISOString() : null,
    effectiveTo: rule.effectiveTo ? new Date(rule.effectiveTo).toISOString() : null,
    deletedAt: rule.deletedAt ? new Date(rule.deletedAt).toISOString() : null
  };
}

export async function writeRuleVersion(tx, rule, changeType, changedByUserId = null) {
  return tx.ruleVersion.create({
    data: {
      organizationId: rule.organizationId,
      ruleId: rule.id,
      revision: rule.revision || 1,
      versionLabel: rule.version || "1.0",
      changeType,
      changedByUserId,
      snapshot: ruleSnapshot(rule)
    }
  });
}

function payerClaimWhere(rule) {
  if (rule.scope !== "PAYER") return {};
  const edi = String(rule.payerEdiId || "").trim();
  if (edi) {
    return {
      OR: [
        { payerEdiId: { equals: edi, mode: "insensitive" } },
        { connectedPayerCode: { equals: edi, mode: "insensitive" } }
      ]
    };
  }

  const name = String(rule.payerName || "").trim();
  if (!name) return { id: "__NO_MATCH__" };
  return {
    OR: [
      { payerName: { equals: name, mode: "insensitive" } },
      { connectedPayerName: { equals: name, mode: "insensitive" } }
    ]
  };
}

export async function bumpRulesetAndInvalidate(tx, organizationId, rule, reason) {
  const organization = await tx.organization.update({
    where: { id: organizationId },
    data: { rulesetRevision: { increment: 1 } },
    select: { rulesetRevision: true }
  });

  const claims = await tx.claim.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: { in: IN_PROCESS_STATUSES },
      ...payerClaimWhere(rule)
    },
    select: { id: true, status: true }
  });

  const claimIds = claims.map((claim) => claim.id);
  if (claimIds.length) {
    await tx.check.updateMany({
      where: { claimId: { in: claimIds }, isStale: false },
      data: {
        isStale: true,
        staleAt: new Date(),
        staleReason: reason
      }
    });

    await tx.claim.updateMany({
      where: { id: { in: claimIds }, status: "READY" },
      data: { status: "NEEDS_REVIEW" }
    });
  }

  return {
    rulesetRevision: organization.rulesetRevision,
    affectedClaims: claimIds.length,
    readyClaimsReopened: claims.filter((claim) => claim.status === "READY").length
  };
}

export async function rulesetFreshness(prisma, organizationId, check, now = new Date()) {
  if (!check) return { fresh: false, reason: "No readiness check" };

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { rulesetRevision: true }
  });
  if (!organization) return { fresh: false, reason: "Organization not found" };

  if (Number(check.rulesetRevision || 1) !== Number(organization.rulesetRevision || 1)) {
    return { fresh: false, reason: "Readiness rules changed after the last AI Check" };
  }

  // A future-dated rule can cross its activation/expiration boundary without an
  // admin mutation. Detect that at submission time so a pre-boundary check
  // cannot be reused after policy applicability changes.
  const temporalChange = await prisma.rule.findFirst({
    where: {
      organizationId,
      enabled: true,
      deletedAt: null,
      OR: [
        {
          effectiveFrom: {
            gt: check.createdAt,
            lte: now
          }
        },
        {
          effectiveTo: {
            gt: check.createdAt,
            lt: now
          }
        }
      ]
    },
    select: { id: true }
  });

  return temporalChange
    ? { fresh: false, reason: "A rule effective-date boundary changed after the last AI Check" }
    : { fresh: true, reason: null };
}

export function ruleMatchesClaim(rule, claim) {
  return ruleScopeMatches(rule, claim);
}
