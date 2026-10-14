ALTER TABLE "DenialCase"
ADD COLUMN "assessmentOverrideReason" TEXT,
ADD COLUMN "assessmentOverriddenAt" TIMESTAMP(3),
ADD COLUMN "appealRationale" TEXT,
ADD COLUMN "appealEvidenceDocumentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "appealPreparedAt" TIMESTAMP(3),
ADD COLUMN "appealSubmittedAt" TIMESTAMP(3),
ADD COLUMN "appealSubmissionReference" TEXT;
