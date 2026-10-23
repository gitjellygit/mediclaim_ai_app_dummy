CREATE TABLE "RuleRecommendation" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "denialCategory" TEXT NOT NULL,
  "carcCode" TEXT,
  "rarcCode" TEXT,
  "payerName" TEXT,
  "payerEdiId" TEXT,
  "occurrenceCount" INTEGER NOT NULL,
  "revenueAtRisk" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "firstObservedAt" TIMESTAMP(3),
  "lastObservedAt" TIMESTAMP(3),
  "proposedRule" JSONB,
  "rationale" TEXT NOT NULL,
  "approvedRuleId" TEXT,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  CONSTRAINT "RuleRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RuleRecommendation_organizationId_fingerprint_key"
  ON "RuleRecommendation"("organizationId", "fingerprint");
CREATE INDEX "RuleRecommendation_organizationId_status_updatedAt_idx"
  ON "RuleRecommendation"("organizationId", "status", "updatedAt");
CREATE INDEX "RuleRecommendation_organizationId_denialCategory_idx"
  ON "RuleRecommendation"("organizationId", "denialCategory");

ALTER TABLE "RuleRecommendation"
  ADD CONSTRAINT "RuleRecommendation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
