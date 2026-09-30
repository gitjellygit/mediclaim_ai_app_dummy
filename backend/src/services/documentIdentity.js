/** Identity checks for claim document uploads. */
function cleanValue(value) {
  if (!value) return null;
  return String(value).trim();
}

export function getExtractedPatientName(extracted) {
  return (
    cleanValue(extracted?.patientName) ||
    cleanValue(extracted?.patient_name) ||
    cleanValue(extracted?.name)
  );
}

export function getExtractedAmount(extracted) {
  const raw =
    extracted?.amount ||
    extracted?.claimAmount ||
    extracted?.claim_amount ||
    extracted?.totalAmount ||
    extracted?.total_amount;

  if (!raw) return null;

  const amount = Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null;
}

function normalizeIdentityText(value) {
  return cleanValue(value)
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "") || null;
}

function normalizeDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function getExtractedIdentity(extracted = {}) {
  return {
    patientName: getExtractedPatientName(extracted),
    memberId:
      cleanValue(extracted?.memberId) ||
      cleanValue(extracted?.member_id),
    policyNo:
      cleanValue(extracted?.policyNo) ||
      cleanValue(extracted?.policy_number) ||
      cleanValue(extracted?.policyNumber),
    patientDob:
      extracted?.dateOfBirth ||
      extracted?.patientDob ||
      extracted?.dob ||
      null
  };
}

/**
 * Validates that a document being attached to an existing claim belongs to
 * the same patient/member. Strong conflicting identifiers always block.
 * Patient-name conflicts block only when both names are available and clearly
 * different. Documents with no extractable identity can still be attached,
 * but the response is marked UNVERIFIED so the UI can warn the user.
 */
export function validateDocumentIdentityAgainstClaim(claim, extracted = {}) {
  const identity = getExtractedIdentity(extracted);
  const conflicts = [];
  const matches = [];

  const claimMember = normalizeIdentityText(claim.memberId);
  const docMember = normalizeIdentityText(identity.memberId);
  if (claimMember && docMember) {
    if (claimMember === docMember) matches.push("memberId");
    else conflicts.push("memberId");
  }

  const claimPolicy = normalizeIdentityText(claim.policyNo);
  const docPolicy = normalizeIdentityText(identity.policyNo);
  if (claimPolicy && docPolicy) {
    if (claimPolicy === docPolicy) matches.push("policyNo");
    else conflicts.push("policyNo");
  }

  const claimDob = normalizeDateOnly(claim.patientDob);
  const docDob = normalizeDateOnly(identity.patientDob);
  if (claimDob && docDob) {
    if (claimDob === docDob) matches.push("patientDob");
    else conflicts.push("patientDob");
  }

  const claimName = normalizeIdentityText(claim.patientName);
  const docName = normalizeIdentityText(identity.patientName);
  const claimNameIsKnown =
    claimName &&
    claimName !== "unknownpatient" &&
    claimName !== "unknown";
  const docNameIsKnown =
    docName &&
    docName !== "unknownpatient" &&
    docName !== "unknown";

  if (claimNameIsKnown && docNameIsKnown) {
    if (claimName === docName) {
      matches.push("patientName");
    } else {
      // Allow common middle-name / suffix variations, but block clearly
      // different patients such as Alice Johnson vs John Smith.
      const samePersonVariation =
        claimName.includes(docName) || docName.includes(claimName);

      if (samePersonVariation) matches.push("patientName");
      else conflicts.push("patientName");
    }
  }

  if (conflicts.length > 0) {
    return {
      status: "MISMATCH",
      conflicts,
      matches,
      extractedPatientName: identity.patientName || null
    };
  }

  if (matches.length > 0) {
    return {
      status: "MATCH",
      conflicts: [],
      matches,
      extractedPatientName: identity.patientName || null
    };
  }

  return {
    status: "UNVERIFIED",
    conflicts: [],
    matches: [],
    extractedPatientName: identity.patientName || null
  };
}

