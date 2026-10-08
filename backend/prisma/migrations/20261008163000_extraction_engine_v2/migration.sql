CREATE TABLE "FieldCandidate" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "claimId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "fieldName" TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "rawValue" TEXT,
  "normalizedValue" JSONB NOT NULL,
  "evidenceText" TEXT,
  "pageNumber" INTEGER,
  "boundingBox" JSONB,
  "documentType" TEXT NOT NULL,
  "sourceProvider" TEXT,
  "sourceConfidence" INTEGER,
  "semanticConfidence" INTEGER,
  "validationStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "validationMessage" TEXT,
  "consensusCount" INTEGER NOT NULL DEFAULT 1,
  "conflictingCount" INTEGER NOT NULL DEFAULT 0,
  "decision" TEXT NOT NULL DEFAULT 'PENDING',
  "decisionReason" TEXT,
  "criticality" TEXT NOT NULL DEFAULT 'STANDARD',
  "engineVersion" TEXT NOT NULL DEFAULT 'v2',
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,

  CONSTRAINT "FieldCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExtractionCache" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "fileHash" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "sourceProvider" TEXT,

  CONSTRAINT "ExtractionCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FieldCandidate_documentId_fieldName_normalizedKey_engineVersion_key"
ON "FieldCandidate"("documentId", "fieldName", "normalizedKey", "engineVersion");

CREATE INDEX "FieldCandidate_claimId_fieldName_decision_idx"
ON "FieldCandidate"("claimId", "fieldName", "decision");

CREATE INDEX "FieldCandidate_documentId_decision_idx"
ON "FieldCandidate"("documentId", "decision");

CREATE UNIQUE INDEX "ExtractionCache_organizationId_fileHash_engineVersion_key"
ON "ExtractionCache"("organizationId", "fileHash", "engineVersion");

CREATE INDEX "ExtractionCache_organizationId_updatedAt_idx"
ON "ExtractionCache"("organizationId", "updatedAt");

ALTER TABLE "FieldCandidate"
ADD CONSTRAINT "FieldCandidate_claimId_fkey"
FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FieldCandidate"
ADD CONSTRAINT "FieldCandidate_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FieldCandidate"
ADD CONSTRAINT "FieldCandidate_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ExtractionCache"
ADD CONSTRAINT "ExtractionCache_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
