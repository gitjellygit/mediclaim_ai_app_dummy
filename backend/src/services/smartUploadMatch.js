import { validateDocumentIdentityAgainstClaim } from "./documentIdentity.js";

/**
 * Never attach a smart-uploaded document to an existing claim if even one
 * known identity identifier conflicts. Ambiguous verified matches require
 * manual review rather than choosing a claim by creation time.
 */
export function selectSmartUploadMatch(extracted = {}, recentClaims = [], calculateScore) {
  const patientName = String(extracted.patientName || "").trim().toLowerCase();
  const fresh = { claim: null, candidateClaim: null, matchScore: 0, matchStatus: "NEW" };
  if (!patientName || ["unknown", "unknown patient"].includes(patientName)) return fresh;

  const candidates = recentClaims.map((claim) => ({
    claim,
    score: calculateScore(extracted, claim),
    identity: validateDocumentIdentityAgainstClaim(claim, extracted)
  })).filter(({ identity }) => identity.status !== "MISMATCH")
    .sort((a, b) => b.score - a.score);

  const verified = candidates.filter(({ score, identity }) =>
    score >= 90 &&
    identity.status === "MATCH" &&
    identity.matches.some((key) => ["memberId", "policyNo", "patientDob"].includes(key))
  );

  // Two distinct claims could legitimately share insurance/policy details.
  // Do not arbitrarily select either record for an automatic merge.
  if (verified.length > 1) {
    return { ...fresh, matchStatus: "REVIEW", matchScore: verified[0].score };
  }
  if (verified.length === 1) {
    return { claim: verified[0].claim, candidateClaim: null,
      matchStatus: "MERGED", matchScore: verified[0].score };
  }
  if (candidates.length && candidates[0].score >= 70) {
    return { claim: null, candidateClaim: candidates[0].claim,
      matchStatus: "REVIEW", matchScore: candidates[0].score };
  }
  return fresh;
}
