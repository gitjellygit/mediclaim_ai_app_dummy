ALTER TABLE "Claim"
ADD COLUMN IF NOT EXISTS "subscriberDob" DATE;

DROP INDEX IF EXISTS "PayerTransaction_transactionId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "PayerTransaction_transactionId_claimId_key"
ON "PayerTransaction"("transactionId", "claimId");
