import crypto from "node:crypto";
import { moneyCents, moneyFromCents } from "../utils/money.js";

const SAFE_RULE_MAPPINGS = Object.freeze({
  AUTHORIZATION: {
    category: "AUTHORIZATION",
    severity: "BLOCK",
    name: "Require authorization number before submission",
    description:
      "Recommended from recurring authorization denials. Require an authorization number before payer submission.",
    definition: { field: "authorizationNo", operator: "REQUIRED" }
  },
  ELIGIBILITY: {
    category: "PATIENT_COVERAGE",
    severity: "BLOCK",
    name: "Require verified eligibility before submission",
    description:
      "Recommended from recurring eligibility denials. Require verified eligibility before payer submission.",
    definition: {
      field: "eligibilityStatus",
      operator: "EQUALS",
      value: "VERIFIED"
    }
  },
  DOCUMENTATION: {
    category: "DOCUMENTATION",
    severity: "WARN",
    name: "Require supporting documentation",
    description:
      "Recommended from recurring documentation denials. Require at least one supporting document before submission.",
    definition: {
      field: "documentCount",
      operator: "GREATER_OR_EQUAL",
      value: 1
    }
  }
});

function normalized(value) {
  return String(value || "").trim().toUpperCase();
}

function fingerprintFor(pattern) {
  return crypto
    .createHash("sha256")
    .update(
      [
        normalized(pattern.payerEdiId || pattern.payerName || "ALL"),
        normalized(pattern.denialCategory),
        normalized(pattern.carcCode),
        normalized(pattern.rarcCode)
      ].join("|")
    )
    .digest("hex");
}

function ruleCode(pattern) {
  const payer = normalized(pattern.payerEdiId || pattern.payerName || "ORG")
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 18) || "ORG";
  const category = normalized(pattern.denialCategory)
    .replace(/[^A-Z0-9]/g, "_")
    .slice(0, 24);
  const suffix = fingerprintFor(pattern).slice(0, 8).toUpperCase();
  return `DENIAL_PREVENT_${category}_${payer}_${suffix}`.slice(0, 80);
}

function proposedRuleFor(pattern) {
  const mapping = SAFE_RULE_MAPPINGS[normalized(pattern.denialCategory)];
  if (!mapping) return null;

  return {
    code: ruleCode(pattern),
    name: mapping.name,
    description: mapping.description,
    category: mapping.category,
    severity: mapping.severity,
    enabled: false,
    scope: pattern.payerName || pattern.payerEdiId ? "PAYER" : "ORGANIZATION",
    payerName: pattern.payerName || null,
    payerEdiId: pattern.payerEdiId || null,
    definition: mapping.definition,
    version: "1.0"
  };
}

export function recommendationRationale(pattern) {
  const payer = pattern.payerName || pattern.payerEdiId || "all payers";
  const codeText = [pattern.carcCode, pattern.rarcCode].filter(Boolean).join("/");
  const codes = codeText ? ` (${codeText})` : "";
  const safe = Boolean(proposedRuleFor(pattern));
  return `${pattern.occurrenceCount} recurring ${String(pattern.denialCategory || "unclassified").toLowerCase()} denials${codes} were observed for ${payer}, representing ${Number(pattern.revenueAtRisk || 0).toFixed(2)} in recorded revenue at risk. ${safe ? "PRISM can map this pattern to a deterministic pre-submit rule for admin review." : "PRISM cannot safely map this pattern to a supported deterministic rule field, so it remains review-only."}`;
}

export async function detectDenialPreventionPatterns(
  db,
  organizationId,
  { minimumOccurrences = 3 } = {}
) {
  const denials = await db.denialCase.findMany({
    where: {
      claim: {
        is: {
          organizationId,
          deletedAt: null
        }
      },
      denialCategory: { not: null }
    },
    select: {
      denialCategory: true,
      carcCode: true,
      rarcCode: true,
      revenueAtRisk: true,
      denialDate: true,
      createdAt: true,
      claim: {
        select: {
          payerName: true,
          payerEdiId: true
        }
      }
    }
  });

  const grouped = new Map();
  for (const denial of denials) {
    const pattern = {
      denialCategory: normalized(denial.denialCategory),
      carcCode: denial.carcCode ? normalized(denial.carcCode) : null,
      rarcCode: denial.rarcCode ? normalized(denial.rarcCode) : null,
      payerName: denial.claim?.payerName || null,
      payerEdiId: denial.claim?.payerEdiId || null
    };
    const key = fingerprintFor(pattern);
    if (!grouped.has(key)) {
      grouped.set(key, {
        ...pattern,
        fingerprint: key,
        occurrenceCount: 0,
        revenueAtRiskCents: 0n,
        firstObservedAt: null,
        lastObservedAt: null
      });
    }

    const current = grouped.get(key);
    current.occurrenceCount += 1;
    current.revenueAtRiskCents += moneyCents(denial.revenueAtRisk || 0);

    const observedAt = denial.denialDate || denial.createdAt;
    const timestamp = observedAt ? new Date(observedAt) : null;
    if (timestamp && !Number.isNaN(timestamp.getTime())) {
      if (!current.firstObservedAt || timestamp < current.firstObservedAt) {
        current.firstObservedAt = timestamp;
      }
      if (!current.lastObservedAt || timestamp > current.lastObservedAt) {
        current.lastObservedAt = timestamp;
      }
    }
  }

  return [...grouped.values()]
    .filter((item) => item.occurrenceCount >= minimumOccurrences)
    .map((item) => {
      const revenueAtRisk = Number(moneyFromCents(item.revenueAtRiskCents));
      const pattern = {
        denialCategory: item.denialCategory,
        carcCode: item.carcCode,
        rarcCode: item.rarcCode,
        payerName: item.payerName,
        payerEdiId: item.payerEdiId,
        occurrenceCount: item.occurrenceCount,
        revenueAtRisk
      };
      return {
        fingerprint: item.fingerprint,
        ...pattern,
        firstObservedAt: item.firstObservedAt,
        lastObservedAt: item.lastObservedAt,
        proposedRule: proposedRuleFor(pattern),
        rationale: recommendationRationale(pattern)
      };
    })
    .sort((a, b) => {
      if (b.occurrenceCount !== a.occurrenceCount) {
        return b.occurrenceCount - a.occurrenceCount;
      }
      return b.revenueAtRisk - a.revenueAtRisk;
    });
}

export function preventionRuleProposalFor(pattern) {
  return proposedRuleFor(pattern);
}
