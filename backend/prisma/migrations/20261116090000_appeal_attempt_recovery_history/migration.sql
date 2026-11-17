-- Preserve each appeal cycle and explain recovered dollars with append-only history.

ALTER TABLE "DenialCase"
  ADD COLUMN "lateAppealExceptionReason" TEXT,
  ADD COLUMN "lateAppealExceptionRecordedAt" TIMESTAMP(3);

CREATE TABLE "AppealAttempt" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "denialCaseId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'FIRST_LEVEL',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "rationale" TEXT,
  "evidenceDocumentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "preparedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "submissionReference" TEXT,
  "submissionChannel" TEXT,
  "externalSubmittedAt" TIMESTAMP(3),
  "appealDeadline" TIMESTAMP(3),
  "outcome" TEXT,
  "outcomeAt" TIMESTAMP(3),
  "payerClaimStatus" TEXT,
  "remittanceStatus" TEXT,
  "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "lateExceptionReason" TEXT,
  "notes" TEXT,
  CONSTRAINT "AppealAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecoveryEvent" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "denialCaseId" TEXT NOT NULL,
  "appealAttemptId" TEXT,
  "eventType" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "source" TEXT NOT NULL,
  "reference" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  CONSTRAINT "RecoveryEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppealAttempt_denialCaseId_attemptNumber_key"
  ON "AppealAttempt"("denialCaseId", "attemptNumber");
CREATE INDEX "AppealAttempt_denialCaseId_submittedAt_idx"
  ON "AppealAttempt"("denialCaseId", "submittedAt");
CREATE INDEX "AppealAttempt_status_idx" ON "AppealAttempt"("status");
CREATE INDEX "RecoveryEvent_denialCaseId_occurredAt_idx"
  ON "RecoveryEvent"("denialCaseId", "occurredAt");
CREATE INDEX "RecoveryEvent_appealAttemptId_idx"
  ON "RecoveryEvent"("appealAttemptId");
CREATE INDEX "RecoveryEvent_reference_idx" ON "RecoveryEvent"("reference");

ALTER TABLE "AppealAttempt"
  ADD CONSTRAINT "AppealAttempt_denialCaseId_fkey"
  FOREIGN KEY ("denialCaseId") REFERENCES "DenialCase"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecoveryEvent"
  ADD CONSTRAINT "RecoveryEvent_denialCaseId_fkey"
  FOREIGN KEY ("denialCaseId") REFERENCES "DenialCase"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecoveryEvent"
  ADD CONSTRAINT "RecoveryEvent_appealAttemptId_fkey"
  FOREIGN KEY ("appealAttemptId") REFERENCES "AppealAttempt"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill the current/legacy appeal into attempt #1 so the new UI has
-- explainable history without losing existing demo/UAT data.
INSERT INTO "AppealAttempt" (
  "id", "createdAt", "updatedAt", "denialCaseId", "attemptNumber", "level", "status",
  "rationale", "evidenceDocumentIds", "preparedAt", "submittedAt",
  "submissionReference", "submissionChannel", "externalSubmittedAt", "appealDeadline",
  "lateExceptionReason"
)
SELECT
  'legacy-attempt-' || d."id",
  d."createdAt",
  d."updatedAt",
  d."id",
  1,
  'FIRST_LEVEL',
  CASE
    WHEN d."status"::text = 'OVERTURNED' THEN 'OVERTURNED'
    WHEN d."status"::text = 'UPHELD' THEN 'UPHELD'
    WHEN d."appealSubmittedAt" IS NOT NULL THEN 'SUBMITTED'
    WHEN d."appealPreparedAt" IS NOT NULL THEN 'PREPARED'
    ELSE 'DRAFT'
  END,
  d."appealRationale",
  d."appealEvidenceDocumentIds",
  d."appealPreparedAt",
  d."appealSubmittedAt",
  d."appealSubmissionReference",
  d."appealSubmissionChannel",
  d."appealExternalSubmittedAt",
  d."appealDeadline",
  NULL
FROM "DenialCase" d
WHERE d."appealPreparedAt" IS NOT NULL
   OR d."appealSubmittedAt" IS NOT NULL
   OR d."appealSubmissionReference" IS NOT NULL;

-- Historical recoveredAmount did not previously carry source-level provenance.
-- Preserve it transparently as a legacy snapshot instead of inventing a payer event.
INSERT INTO "RecoveryEvent" (
  "id", "denialCaseId", "appealAttemptId", "eventType", "amount",
  "source", "reference", "occurredAt", "notes"
)
SELECT
  'legacy-recovery-' || d."id",
  d."id",
  CASE
    WHEN a."id" IS NOT NULL THEN a."id"
    ELSE NULL
  END,
  'RECOVERY',
  d."recoveredAmount",
  'LEGACY_DENIAL_SNAPSHOT',
  d."appealSubmissionReference",
  d."updatedAt",
  'Backfilled from DenialCase.recoveredAmount. Exact historical payment/remittance provenance was not stored by the legacy model.'
FROM "DenialCase" d
LEFT JOIN "AppealAttempt" a
  ON a."denialCaseId" = d."id" AND a."attemptNumber" = 1
WHERE COALESCE(d."recoveredAmount", 0) > 0;
