ALTER TABLE "DenialCase"
ADD COLUMN IF NOT EXISTS "sourceTransactionId" TEXT,
ADD COLUMN IF NOT EXISTS "payerEvidence" JSONB;

CREATE INDEX IF NOT EXISTS "DenialCase_sourceTransactionId_idx"
ON "DenialCase"("sourceTransactionId");
