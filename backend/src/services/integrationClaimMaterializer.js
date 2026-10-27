import {
  changedFields,
  mergeProvenance,
  systemProvenance
} from "./claimFieldProvenance.js";
import { markReadinessChecksStale } from "./readinessHistory.js";

function positiveMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizedGender(value) {
  const gender = String(value || "").toUpperCase();
  if (gender === "M" || gender === "MALE") return "MALE";
  if (gender === "F" || gender === "FEMALE") return "FEMALE";
  if (gender === "OTHER" || gender === "O") return "OTHER";
  return null;
}

export function claimPatchFromCanonical(data = {}) {
  const amount = positiveMoney(data.amount ?? data.total?.value ?? data.total);
  const patch = {
    patientName: data.patientName || null,
    payerName: data.payerName || null,
    policyNo: data.policyNo || null,
    memberId: data.memberId || null,
    subscriberId: data.subscriberId || null,
    subscriberName: data.subscriberName || null,
    patientDob: dateOrNull(data.patientDob),
    patientGender: normalizedGender(data.patientGender),
    dateOfService: dateOrNull(data.dateOfService),
    billingProviderNpi: data.billingProviderNpi || null,
    renderingProviderNpi: data.renderingProviderNpi || null,
    payerEdiId: data.payerEdiId || null,
    diagnosisText: data.diagnosisText || null,
    icd10Codes: Array.isArray(data.icd10Codes) ? data.icd10Codes : undefined,
    amount,
    totalBilledAmount: positiveMoney(data.totalBilledAmount) ?? amount
  };

  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== null && value !== undefined)
  );
}

export function canMaterializeCanonicalClaim(data = {}) {
  const patch = claimPatchFromCanonical(data);
  return Boolean(
    String(patch.patientName || "").trim() &&
    String(patch.payerName || "").trim() &&
    positiveMoney(patch.amount)
  );
}

export async function materializeCanonicalClaim(tx, {
  organizationId,
  connectionId,
  externalClaimId,
  data,
  actorUserId = null
}) {
  const patch = claimPatchFromCanonical(data);
  if (!canMaterializeCanonicalClaim(data)) {
    return {
      materialized: false,
      reason: "patientName, payerName and positive amount are required to materialize a billable claim"
    };
  }

  const identity = await tx.claimExternalIdentity.findUnique({
    where: {
      connectionId_externalClaimId: { connectionId, externalClaimId }
    },
    include: { claim: true }
  });

  if (identity?.claim) {
    const existingProvenance =
      identity.claim.fieldProvenance &&
      typeof identity.claim.fieldProvenance === "object" &&
      !Array.isArray(identity.claim.fieldProvenance)
        ? identity.claim.fieldProvenance
        : {};

    const safePatch = Object.fromEntries(
      Object.entries(patch).filter(([field]) => {
        const source = existingProvenance[field];
        return !(source?.source === "USER" && source?.verified === true);
      })
    );
    const changed = changedFields(identity.claim, safePatch);
    if (!changed.length) {
      return {
        materialized: true,
        created: false,
        unchanged: true,
        protectedManualFields: Object.keys(patch).filter((field) => {
          const source = existingProvenance[field];
          return source?.source === "USER" && source?.verified === true;
        }),
        claim: identity.claim
      };
    }

    const changedPatch = Object.fromEntries(
      Object.entries(safePatch).filter(([field]) => changed.includes(field))
    );
    const provenance = systemProvenance(changed, {
      source: "INTEGRATION",
      label: "Imported from Integration Hub",
      sourceDetail: "Connection " + connectionId,
      verified: false
    });

    const claim = await tx.claim.update({
      where: { id: identity.claim.id },
      data: {
        ...changedPatch,
        fieldProvenance: mergeProvenance(existingProvenance, provenance)
      }
    });
    await markReadinessChecksStale(tx, claim.id, "Source integration updated claim data");
    return {
      materialized: true,
      created: false,
      unchanged: false,
      protectedManualFields: Object.keys(patch).filter((field) => {
        const source = existingProvenance[field];
        return source?.source === "USER" && source?.verified === true;
      }),
      claim
    };
  }

  const provenance = systemProvenance(Object.keys(patch), {
    source: "INTEGRATION",
    label: "Imported from Integration Hub",
    sourceDetail: "Connection " + connectionId,
    verified: false
  });

  const claim = await tx.claim.create({
    data: {
      organizationId,
      createdById: actorUserId,
      ...patch,
      status: "DRAFT",
      fieldProvenance: provenance
    }
  });

  await tx.claimExternalIdentity.create({
    data: {
      organizationId,
      connectionId,
      claimId: claim.id,
      externalClaimId,
      recordType: "CLAIM"
    }
  });

  return { materialized: true, created: true, claim };
}
