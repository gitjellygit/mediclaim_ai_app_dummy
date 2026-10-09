-- Keep source insurance identity separate from the payer connection used for workflow transactions.
ALTER TABLE "Claim"
ADD COLUMN "connectedPayerCode" TEXT,
ADD COLUMN "connectedPayerName" TEXT;
