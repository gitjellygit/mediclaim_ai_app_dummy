import { validMoney } from "../utils/money.js";
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

  const amount = validMoney(String(raw).replace(/[^0-9.]/g, ""));
  return amount != null && Number(amount) > 0 ? Number(amount) : null;
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

const OCR_CONFUSION_GROUPS = [
  new Set(["0", "o"]),
  new Set(["1", "i", "l"]),
  new Set(["2", "z"]),
  new Set(["5", "s"]),
  new Set(["6", "g"]),
  new Set(["8", "b"])
];

function isOcrConfusion(a, b) {
  if (a === b) return true;
  return OCR_CONFUSION_GROUPS.some((group) => group.has(a) && group.has(b));
}

function identifiersEquivalent(a, b) {
  const left = normalizeIdentityText(a);
  const right = normalizeIdentityText(b);
  if (!left || !right) return { equivalent: false, exact: false, tolerant: false };
  if (left === right) return { equivalent: true, exact: true, tolerant: false };

  if (left.length === right.length && left.length >= 5) {
    let differences = 0;
    let onlyOcrConfusions = true;
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] === right[i]) continue;
      differences += 1;
      if (!isOcrConfusion(left[i], right[i])) onlyOcrConfusions = false;
      if (differences > 2) break;
    }
    if (differences >= 1 && differences <= 2 && onlyOcrConfusions) {
      return { equivalent: true, exact: false, tolerant: true };
    }
  }

  return { equivalent: false, exact: false, tolerant: false };
}

/**
 * Identity matching is evidence-based rather than a single-field veto.
 *
 * - Exact/tolerant identifiers and patient name/DOB are positive evidence.
 * - A clear patient-name or DOB conflict remains a hard block.
 * - Two independent strong identifier conflicts remain a hard block.
 * - One isolated identifier conflict is REVIEW, not MISMATCH, so OCR noise or
 *   stale payer-card values do not prevent a valid document from being stored.
 */
export function validateDocumentIdentityAgainstClaim(claim, extracted = {}) {
  const identity = getExtractedIdentity(extracted);
  const conflicts = [];
  const matches = [];
  const tolerantMatches = [];
  const warnings = [];

  const member = identifiersEquivalent(claim.memberId, identity.memberId);
  if (claim.memberId && identity.memberId) {
    if (member.equivalent) {
      matches.push("memberId");
      if (member.tolerant) tolerantMatches.push("memberId");
    } else {
      conflicts.push("memberId");
    }
  }

  const policy = identifiersEquivalent(claim.policyNo, identity.policyNo);
  if (claim.policyNo && identity.policyNo) {
    if (policy.equivalent) {
      matches.push("policyNo");
      if (policy.tolerant) tolerantMatches.push("policyNo");
    } else {
      conflicts.push("policyNo");
    }
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
      const samePersonVariation =
        claimName.includes(docName) || docName.includes(claimName);

      if (samePersonVariation) matches.push("patientName");
      else conflicts.push("patientName");
    }
  }

  const hardConflict =
    conflicts.includes("patientName") ||
    conflicts.includes("patientDob") ||
    ["memberId", "policyNo"].filter((field) => conflicts.includes(field)).length >= 2;

  if (hardConflict) {
    return {
      status: "MISMATCH",
      conflicts,
      matches,
      tolerantMatches,
      warnings,
      extractedPatientName: identity.patientName || null
    };
  }

  if (conflicts.length > 0) {
    warnings.push(...conflicts);
    return {
      status: "REVIEW",
      conflicts,
      matches,
      tolerantMatches,
      warnings,
      extractedPatientName: identity.patientName || null
    };
  }

  if (matches.length > 0) {
    return {
      status: "MATCH",
      conflicts: [],
      matches,
      tolerantMatches,
      warnings,
      extractedPatientName: identity.patientName || null
    };
  }

  return {
    status: "UNVERIFIED",
    conflicts: [],
    matches: [],
    tolerantMatches,
    warnings,
    extractedPatientName: identity.patientName || null
  };
}
