import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/db.js";
import {
  acquireSubmissionLock,
  claimPaymentResponsibility,
  completeSubmissionLock,
  isPrimaryClaim,
  releaseSubmissionLock,
  safeSubmissionClaim,
  stablePatientControlNumber
} from "../src/services/submissionSafety.js";

const ORG_ID = "org_submission_safety_test";
const createdClaimIds = [];

after(async () => {
  if (createdClaimIds.length) {
    await prisma.claim.deleteMany({ where: { id: { in: createdClaimIds } } });
  }
});

async function createClaim(status = "READY", overrides = {}) {
  await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: {
      id: ORG_ID,
      name: "Submission Safety Test",
      slug: "submission-safety-test"
    }
  });

  const claim = await prisma.claim.create({
    data: {
      organizationId: ORG_ID,
      patientName: "Submission Safety Patient",
      payerName: "Submission Safety Payer",
      status,
      ...overrides
    }
  });
  createdClaimIds.push(claim.id);
  return claim;
}

test("submission safety - patient control number is stable, non-PHI and 17 characters", () => {
  const first = stablePatientControlNumber("claim-abc-123");
  const second = stablePatientControlNumber("claim-abc-123");
  const other = stablePatientControlNumber("claim-abc-124");

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^[A-F0-9]{17}$/);
});

test("submission safety - payment responsibility defaults to primary and blocks secondary/tertiary", () => {
  assert.equal(claimPaymentResponsibility({}), "PRIMARY");
  assert.equal(isPrimaryClaim({}), true);
  assert.equal(isPrimaryClaim({ coordinationOfBenefits: "PRIMARY" }), true);
  assert.equal(isPrimaryClaim({ coordinationOfBenefits: "SECONDARY" }), false);
  assert.equal(isPrimaryClaim({ coordinationOfBenefits: "TERTIARY" }), false);
});

test("submission safety - concurrent compare-and-set acquisition produces exactly one owner", async () => {
  const claim = await createClaim("READY");

  const attempts = await Promise.all(
    Array.from({ length: 12 }, () =>
      acquireSubmissionLock(prisma, claim, {
        organizationId: ORG_ID,
        env: { CLAIM_SUBMISSION_LOCK_TIMEOUT_MS: "60000" }
      })
    )
  );

  const owners = attempts.filter(Boolean);
  assert.equal(owners.length, 1);

  const stored = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(stored.status, "SUBMITTING");
  assert.equal(stored.submissionAttemptId, owners[0].attemptId);
  assert.equal(stored.patientControlNumber, stablePatientControlNumber(claim.id));
});

test("submission safety - active SUBMITTING lock cannot be stolen", async () => {
  const claim = await createClaim("SUBMITTING", {
    submissionAttemptId: "active-attempt",
    submissionStartedAt: new Date()
  });

  const acquired = await acquireSubmissionLock(prisma, claim, {
    organizationId: ORG_ID,
    env: { CLAIM_SUBMISSION_LOCK_TIMEOUT_MS: "60000" }
  });

  assert.equal(acquired, null);
  const stored = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(stored.submissionAttemptId, "active-attempt");
});

test("submission safety - stale SUBMITTING lock is reclaimable but old owner loses authority", async () => {
  const now = new Date("2026-10-19T20:00:00.000Z");
  const claim = await createClaim("SUBMITTING", {
    submissionAttemptId: "old-attempt",
    submissionStartedAt: new Date("2026-10-19T18:00:00.000Z")
  });

  const acquired = await acquireSubmissionLock(prisma, claim, {
    organizationId: ORG_ID,
    now,
    env: { CLAIM_SUBMISSION_LOCK_TIMEOUT_MS: "60000" },
    attemptId: "new-attempt"
  });

  assert.equal(acquired?.attemptId, "new-attempt");
  assert.equal(acquired?.reclaimed, true);

  assert.equal(
    await releaseSubmissionLock(prisma, claim.id, "old-attempt"),
    false
  );
  assert.equal(
    await completeSubmissionLock(prisma, claim.id, "old-attempt"),
    false
  );

  assert.equal(
    await completeSubmissionLock(prisma, claim.id, "new-attempt", {
      claimSubmissionDate: now,
      payerClaimStatus: "SUBMITTED",
      remittanceStatus: "AWAITING"
    }),
    true
  );

  const stored = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(stored.status, "SUBMITTED");
  assert.equal(stored.submissionAttemptId, null);
  assert.equal(stored.submissionStartedAt, null);
});

test("submission safety - owner can release a failed preflight back to READY", async () => {
  const claim = await createClaim("READY");
  const acquired = await acquireSubmissionLock(prisma, claim, {
    organizationId: ORG_ID,
    attemptId: "preflight-attempt"
  });

  assert.ok(acquired);
  assert.equal(
    await releaseSubmissionLock(prisma, claim.id, "preflight-attempt"),
    true
  );

  const stored = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(stored.status, "READY");
  assert.equal(stored.submissionAttemptId, null);
});

test("submission safety - response DTO cannot expose storage or OCR fields", () => {
  const safe = safeSubmissionClaim({
    id: "claim-1",
    status: "SUBMITTED",
    patientControlNumber: "ABC",
    claimSubmissionDate: new Date("2026-10-19T00:00:00Z"),
    payerClaimStatus: "ACKNOWLEDGED",
    payerReferenceNo: "PAYER-1",
    remittanceStatus: "AWAITING",
    claimForm: "PROFESSIONAL",
    claimFrequencyCode: "ORIGINAL",
    payerName: "Example",
    payerEdiId: "60054",
    documents: [{ path: "/secret/file.pdf", rawText: "secret OCR" }],
    fieldProvenance: { secret: true }
  });

  assert.deepEqual(Object.keys(safe).sort(), [
    "claimForm",
    "claimFrequencyCode",
    "claimSubmissionDate",
    "id",
    "patientControlNumber",
    "payerClaimStatus",
    "payerEdiId",
    "payerName",
    "payerReferenceNo",
    "remittanceStatus",
    "status"
  ].sort());
  assert.doesNotMatch(JSON.stringify(safe), /secret|rawText|path|documents/i);
});
