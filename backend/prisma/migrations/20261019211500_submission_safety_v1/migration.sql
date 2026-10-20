ALTER TYPE "ClaimStatus" ADD VALUE IF NOT EXISTS 'SUBMITTING' BEFORE 'SUBMITTED';

ALTER TABLE "Claim"
  ADD COLUMN "submissionAttemptId" TEXT,
  ADD COLUMN "submissionStartedAt" TIMESTAMP(3),
  ADD COLUMN "submissionReconciliationRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "submissionReconciliationReason" TEXT;

CREATE INDEX "Claim_organizationId_status_submissionStartedAt_idx"
  ON "Claim"("organizationId", "status", "submissionStartedAt");
