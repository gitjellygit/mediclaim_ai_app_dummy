import crypto from "node:crypto";
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
  if (!rule || rule.scope !== "PAYER") return null;
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

function affectedClaimScope(rule, previousRule) {
  if (
    rule?.scope !== "PAYER" ||
    (previousRule && previousRule.scope !== "PAYER")
  ) {
    return {};
  }

  const scopes = [payerClaimWhere(rule), payerClaimWhere(previousRule)].filter(Boolean);
  if (!scopes.length) return { id: "__NO_MATCH__" };
  return scopes.length === 1 ? scopes[0] : { OR: scopes };
}

export async function bumpRulesetAndInvalidate(
  tx,
  organizationId,
  rule,
  reason,
  previousRule = null
) {
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
      ...affectedClaimScope(rule, previousRule)
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

function effectiveAt(rule, now) {
  if (!rule || rule.enabled === false || rule.deletedAt) return false;
  if (rule.effectiveFrom && new Date(rule.effectiveFrom).getTime() > now.getTime()) return false;
  if (rule.effectiveTo && new Date(rule.effectiveTo).getTime() < now.getTime()) return false;
  return true;
}

export function applicableRules(rules, claim, now = new Date()) {
  return (rules || [])
    .filter((rule) => effectiveAt(rule, now))
    .filter((rule) => rule.scope !== "PAYER" || ruleScopeMatches(rule, claim))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

export function rulesetFingerprint(rules, claim, now = new Date()) {
  const normalized = applicableRules(rules, claim, now).map((rule) => ({
    code: rule.code,
    revision: Number(rule.revision || 1),
    version: rule.version || "1.0",
    severity: rule.severity,
    enabled: Boolean(rule.enabled),
    mandatory: Boolean(rule.mandatory),
    scope: rule.scope,
    payerName: rule.payerName || null,
    payerEdiId: rule.payerEdiId || null,
    definition: rule.definition || null,
    effectiveFrom: rule.effectiveFrom ? new Date(rule.effectiveFrom).toISOString() : null,
    effectiveTo: rule.effectiveTo ? new Date(rule.effectiveTo).toISOString() : null
  }));

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

export async function rulesetFreshness(prisma, organizationId, check, claim, now = new Date()) {
  if (!check) return { fresh: false, reason: "No readiness check" };
  if (!check.rulesetFingerprint) {
    return {
      fresh: false,
      reason: "The last AI Check predates ruleset fingerprinting. Refresh AI readiness before submitting."
    };
  }

  const rules = await prisma.rule.findMany({
    where: { organizationId, deletedAt: null }
  });
  const current = rulesetFingerprint(rules, claim, now);
  return current === check.rulesetFingerprint
    ? { fresh: true, reason: null }
    : {
        fresh: false,
        reason: "Applicable readiness rules changed after the last AI Check. Refresh AI readiness before submitting."
      };
}

export function ruleMatchesClaim(rule, claim) {
  return ruleScopeMatches(rule, claim);
}
