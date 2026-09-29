ALTER TABLE "Claim"
ADD COLUMN "payerConnectionMode" TEXT NOT NULL DEFAULT 'LOCAL',
ADD COLUMN "simulatedPayerCode" TEXT;

CREATE TABLE "PayerTransaction" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimId" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'SIMULATED',
  "payerCode" TEXT NOT NULL,
  "transactionType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "latencyMs" INTEGER,
  "requestPayload" JSONB,
  "responsePayload" JSONB,

  CONSTRAINT "PayerTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayerTransaction_transactionId_key"
ON "PayerTransaction"("transactionId");

CREATE INDEX "PayerTransaction_claimId_createdAt_idx"
ON "PayerTransaction"("claimId", "createdAt");

CREATE INDEX "PayerTransaction_payerCode_idx"
ON "PayerTransaction"("payerCode");

CREATE INDEX "PayerTransaction_transactionType_idx"
ON "PayerTransaction"("transactionType");

ALTER TABLE "PayerTransaction"
ADD CONSTRAINT "PayerTransaction_claimId_fkey"
FOREIGN KEY ("claimId") REFERENCES "Claim"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
