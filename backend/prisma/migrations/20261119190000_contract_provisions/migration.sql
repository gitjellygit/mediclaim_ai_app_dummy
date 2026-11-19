CREATE TABLE "ContractProvision" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "contractId" TEXT NOT NULL,
  "provisionType" TEXT NOT NULL,
  "parameters" JSONB NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "sourceDocumentId" TEXT,
  "sourcePage" INTEGER,
  "sourceClause" TEXT,
  "extractionMethod" TEXT NOT NULL DEFAULT 'MANUAL',
  "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "ContractProvision_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ContractProvision"
  ADD CONSTRAINT "ContractProvision_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "PayerContract"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContractProvision"
  ADD CONSTRAINT "ContractProvision_sourceDocumentId_fkey"
  FOREIGN KEY ("sourceDocumentId") REFERENCES "ContractSourceDocument"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ContractProvision_contractId_status_priority_idx"
  ON "ContractProvision"("contractId", "status", "priority");
CREATE INDEX "ContractProvision_sourceDocumentId_idx"
  ON "ContractProvision"("sourceDocumentId");
