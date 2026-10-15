ALTER TABLE "DenialCase"
  ADD COLUMN "appealSubmissionChannel" TEXT,
  ADD COLUMN "appealExternalSubmittedAt" TIMESTAMP(3);

ALTER TABLE "Document"
  ADD COLUMN "appealCaseId" TEXT;

CREATE INDEX "Document_appealCaseId_idx"
  ON "Document"("appealCaseId");

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_appealCaseId_fkey"
  FOREIGN KEY ("appealCaseId")
  REFERENCES "DenialCase"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
