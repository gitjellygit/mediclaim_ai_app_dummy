import { createHash, randomUUID } from "node:crypto";

const DEFAULT_STALE_MS = 15 * 60 * 1000;
const MIN_STALE_MS = 60 * 1000;
const MAX_STALE_MS = 60 * 60 * 1000;

export function submissionLockTimeoutMs(env = process.env) {
  const configured = Number(env.CLAIM_SUBMISSION_LOCK_TIMEOUT_MS || DEFAULT_STALE_MS);
  if (!Number.isFinite(configured)) return DEFAULT_STALE_MS;
  return Math.max(MIN_STALE_MS, Math.min(MAX_STALE_MS, Math.floor(configured)));
}

export function stablePatientControlNumber(claimId) {
  const id = String(claimId || "").trim();
  if (!id) throw new Error("claimId is required to create a patient control number");
  return createHash("sha256")
    .update(`claim-app-pcn:${id}`)
    .digest("hex")
    .slice(0, 17)
    .toUpperCase();
}

export function claimPaymentResponsibility(claim) {
  return String(claim?.coordinationOfBenefits || "PRIMARY").toUpperCase();
}

export function isPrimaryClaim(claim) {
  return claimPaymentResponsibility(claim) === "PRIMARY";
}

export async function acquireSubmissionLock(
  prisma,
  claim,
  {
    organizationId,
    now = new Date(),
    env = process.env,
    attemptId = randomUUID()
  } = {}
) {
  const patientControlNumber =
    claim.patientControlNumber || stablePatientControlNumber(claim.id);
  const staleBefore = new Date(now.getTime() - submissionLockTimeoutMs(env));

  const acquired = await prisma.claim.updateMany({
    where: {
      id: claim.id,
      organizationId,
      deletedAt: null,
      OR: [
        { status: "READY" },
        {
          status: "SUBMITTING",
          submissionStartedAt: { lte: staleBefore }
        }
      ]
    },
    data: {
      status: "SUBMITTING",
      patientControlNumber,
      submissionAttemptId: attemptId,
      submissionStartedAt: now
    }
  });

  if (acquired.count !== 1) return null;

  return {
    attemptId,
    patientControlNumber,
    startedAt: now,
    reclaimed: claim.status === "SUBMITTING"
  };
}

export async function releaseSubmissionLock(
  prisma,
  claimId,
  attemptId,
  { status = "READY" } = {}
) {
  const released = await prisma.claim.updateMany({
    where: {
      id: claimId,
      status: "SUBMITTING",
      submissionAttemptId: attemptId
    },
    data: {
      status,
      submissionAttemptId: null,
      submissionStartedAt: null
    }
  });
  return released.count === 1;
}

export async function completeSubmissionLock(
  prisma,
  claimId,
  attemptId,
  data = {}
) {
  const completed = await prisma.claim.updateMany({
    where: {
      id: claimId,
      status: "SUBMITTING",
      submissionAttemptId: attemptId
    },
    data: {
      ...data,
      status: "SUBMITTED",
      submissionAttemptId: null,
      submissionStartedAt: null
    }
  });
  return completed.count === 1;
}

export function safeSubmissionClaim(claim) {
  if (!claim) return null;
  return {
    id: claim.id,
    status: claim.status,
    patientControlNumber: claim.patientControlNumber || null,
    claimSubmissionDate: claim.claimSubmissionDate || null,
    payerClaimStatus: claim.payerClaimStatus || null,
    payerReferenceNo: claim.payerReferenceNo || null,
    remittanceStatus: claim.remittanceStatus || null,
    claimForm: claim.claimForm || null,
    claimFrequencyCode: claim.claimFrequencyCode || null,
    payerName: claim.payerName || null,
    payerEdiId: claim.payerEdiId || null
  };
}
