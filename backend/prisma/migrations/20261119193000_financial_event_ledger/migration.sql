CREATE TABLE "PaymentBatch" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organizationId" TEXT NOT NULL,
  "sourceTransactionId" TEXT NOT NULL,
  "controlNumber" TEXT,
  "paymentReference" TEXT,
  "paymentMethod" TEXT,
  "paymentDate" TEXT,
  "payerName" TEXT,
  "payeeNpi" TEXT,
  "sourcePayload" JSONB,
  CONSTRAINT "PaymentBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialEvent" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organizationId" TEXT NOT NULL,
  "claimId" TEXT,
  "paymentBatchId" TEXT,
  "eventType" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "sourceTransactionId" TEXT NOT NULL,
  "sourceEventKey" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  CONSTRAINT "FinancialEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PaymentBatch"
  ADD CONSTRAINT "PaymentBatch_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FinancialEvent"
  ADD CONSTRAINT "FinancialEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FinancialEvent"
  ADD CONSTRAINT "FinancialEvent_claimId_fkey"
  FOREIGN KEY ("claimId") REFERENCES "Claim"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FinancialEvent"
  ADD CONSTRAINT "FinancialEvent_paymentBatchId_fkey"
  FOREIGN KEY ("paymentBatchId") REFERENCES "PaymentBatch"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PaymentBatch_organizationId_sourceTransactionId_key"
  ON "PaymentBatch"("organizationId", "sourceTransactionId");
CREATE INDEX "PaymentBatch_organizationId_paymentReference_idx"
  ON "PaymentBatch"("organizationId", "paymentReference");
CREATE INDEX "PaymentBatch_organizationId_createdAt_idx"
  ON "PaymentBatch"("organizationId", "createdAt");

CREATE UNIQUE INDEX "FinancialEvent_organizationId_sourceEventKey_key"
  ON "FinancialEvent"("organizationId", "sourceEventKey");
CREATE INDEX "FinancialEvent_organizationId_claimId_occurredAt_idx"
  ON "FinancialEvent"("organizationId", "claimId", "occurredAt");
CREATE INDEX "FinancialEvent_paymentBatchId_eventType_idx"
  ON "FinancialEvent"("paymentBatchId", "eventType");
CREATE INDEX "FinancialEvent_sourceTransactionId_idx"
  ON "FinancialEvent"("sourceTransactionId");
