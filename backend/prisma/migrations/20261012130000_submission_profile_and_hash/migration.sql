ALTER TABLE "Organization"
ADD COLUMN "claimSubmissionProfile" JSONB;

ALTER TABLE "PayerTransaction"
ADD COLUMN "requestHash" TEXT;

CREATE UNIQUE INDEX "PayerTransaction_claimId_transactionType_requestHash_key"
ON "PayerTransaction"("claimId", "transactionType", "requestHash");
