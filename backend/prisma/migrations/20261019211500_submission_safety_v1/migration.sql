ALTER TYPE "ClaimStatus" ADD VALUE IF NOT EXISTS 'SUBMITTING' BEFORE 'SUBMITTED';

ALTER TABLE "Claim"
  ADD COLUMN "submissionAttemptId" TEXT,
  ADD COLUMN "submissionStartedAt" TIMESTAMP(3);

CREATE INDEX "Claim_organizationId_status_submissionStartedAt_idx"
  ON "Claim"("organizationId", "status", "submissionStartedAt");
