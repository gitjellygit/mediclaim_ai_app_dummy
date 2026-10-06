CREATE TYPE "CodingSystem" AS ENUM ('ICD10_CM', 'CPT', 'HCPCS', 'ICD10_PCS');
CREATE TYPE "CodingSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CHANGED', 'REJECTED');

CREATE TABLE "CodingSuggestion" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "claimId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "system" "CodingSystem" NOT NULL,
  "suggestedCode" TEXT NOT NULL,
  "confidence" INTEGER,
  "evidenceText" TEXT,
  "status" "CodingSuggestionStatus" NOT NULL DEFAULT 'PENDING',
  "finalCode" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,

  CONSTRAINT "CodingSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CodingSuggestion_documentId_system_suggestedCode_key"
ON "CodingSuggestion"("documentId", "system", "suggestedCode");

CREATE INDEX "CodingSuggestion_claimId_status_idx"
ON "CodingSuggestion"("claimId", "status");

CREATE INDEX "CodingSuggestion_documentId_status_idx"
ON "CodingSuggestion"("documentId", "status");

ALTER TABLE "CodingSuggestion"
ADD CONSTRAINT "CodingSuggestion_claimId_fkey"
FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CodingSuggestion"
ADD CONSTRAINT "CodingSuggestion_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CodingSuggestion"
ADD CONSTRAINT "CodingSuggestion_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
