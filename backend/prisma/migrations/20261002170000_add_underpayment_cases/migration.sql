-- Underpayment / payment variance recovery workflow.
CREATE TYPE "UnderpaymentCaseStatus" AS ENUM (
  'OPEN',
  'REVIEWING',
  'DISPUTE_PREPARED',
  'DISPUTE_SUBMITTED',
  'RECOVERED',
  'WRITTEN_OFF',
  'CLOSED'
);

CREATE TABLE "UnderpaymentCase" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "claimId" TEXT NOT NULL,
  "status" "UnderpaymentCaseStatus" NOT NULL DEFAULT 'OPEN',
  "expectedPayerPayment" DECIMAL(14,2) NOT NULL,
  "actualPaidAmount" DECIMAL(14,2) NOT NULL,
  "varianceAmount" DECIMAL(14,2) NOT NULL,
  "recoveredAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "reasonCategory" TEXT DEFAULT 'PAYER_PAYMENT_BELOW_EXPECTED',
  "sourceTransactionId" TEXT,
  "notes" TEXT,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),

  CONSTRAINT "UnderpaymentCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnderpaymentCase_claimId_key" ON "UnderpaymentCase"("claimId");
CREATE INDEX "UnderpaymentCase_status_idx" ON "UnderpaymentCase"("status");
CREATE INDEX "UnderpaymentCase_detectedAt_idx" ON "UnderpaymentCase"("detectedAt");

ALTER TABLE "UnderpaymentCase"
ADD CONSTRAINT "UnderpaymentCase_claimId_fkey"
FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
