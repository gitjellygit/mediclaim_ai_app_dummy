ALTER TABLE "Claim"
ADD COLUMN IF NOT EXISTS "subscriberDob" DATE;

DROP INDEX IF EXISTS "PayerTransaction_transactionId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "PayerTransaction_transactionId_claimId_key"
ON "PayerTransaction"("transactionId", "claimId");

-- Remove legacy full payer response/X12 payloads from application transaction history.
-- The normalized minimum-necessary fields remain in responsePayload.
UPDATE "PayerTransaction"
SET "responsePayload" = "responsePayload" - 'raw' - 'x12'
WHERE "responsePayload" IS NOT NULL
  AND jsonb_typeof("responsePayload") = 'object'
  AND (
    "responsePayload" ? 'raw'
    OR "responsePayload" ? 'x12'
  );
