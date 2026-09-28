-- Denial & Appeal Intelligence plus security/audit trace.
CREATE TABLE "DenialCase" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "claimId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "denialCategory" TEXT,
  "groupCode" TEXT,
  "carcCode" TEXT,
  "rarcCode" TEXT,
  "reasonText" TEXT,
  "denialDate" TIMESTAMP(3),
  "correctable" BOOLEAN,
  "appealEligible" BOOLEAN,
  "appealDeadline" TIMESTAMP(3),
  "revenueAtRisk" INTEGER,
  "recoveredAmount" INTEGER,
  "recommendedAction" TEXT,
  "requiredDocuments" JSONB,
  "aiExplanation" TEXT,
  "aiConfidence" INTEGER,
  "aiProvider" TEXT,
  "aiModel" TEXT,
  "aiAnalyzedAt" TIMESTAMP(3),
  "aiInputVersion" TEXT DEFAULT 'denial-v1',
  CONSTRAINT "DenialCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimId" TEXT,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "outcome" TEXT NOT NULL,
  "metadata" JSONB,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DenialCase_claimId_idx" ON "DenialCase"("claimId");
CREATE INDEX "DenialCase_status_idx" ON "DenialCase"("status");
CREATE INDEX "DenialCase_denialCategory_idx" ON "DenialCase"("denialCategory");
CREATE INDEX "AuditEvent_claimId_idx" ON "AuditEvent"("claimId");
CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

ALTER TABLE "DenialCase"
ADD CONSTRAINT "DenialCase_claimId_fkey"
FOREIGN KEY ("claimId") REFERENCES "Claim"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_claimId_fkey"
FOREIGN KEY ("claimId") REFERENCES "Claim"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
