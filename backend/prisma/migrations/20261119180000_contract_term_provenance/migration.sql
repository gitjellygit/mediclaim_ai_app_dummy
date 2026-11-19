CREATE TABLE "ContractSourceDocument" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "contractId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "storageReference" TEXT NOT NULL,
  "checksum" TEXT,
  "notes" TEXT,
  CONSTRAINT "ContractSourceDocument_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ContractSourceDocument"
  ADD CONSTRAINT "ContractSourceDocument_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "PayerContract"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeeScheduleLine"
  ADD COLUMN "sourceDocumentId" TEXT,
  ADD COLUMN "sourcePage" INTEGER,
  ADD COLUMN "sourceClause" TEXT,
  ADD COLUMN "extractionMethod" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "reviewedByUserId" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

ALTER TABLE "FeeScheduleLine"
  ADD CONSTRAINT "FeeScheduleLine_sourceDocumentId_fkey"
  FOREIGN KEY ("sourceDocumentId") REFERENCES "ContractSourceDocument"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ContractSourceDocument_contractId_documentType_idx"
  ON "ContractSourceDocument"("contractId", "documentType");
CREATE INDEX "FeeScheduleLine_sourceDocumentId_idx"
  ON "FeeScheduleLine"("sourceDocumentId");
CREATE INDEX "FeeScheduleLine_contractId_reviewStatus_idx"
  ON "FeeScheduleLine"("contractId", "reviewStatus");
