ALTER TABLE "Rule"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'CLAIM',
  ADD COLUMN "ruleType" TEXT NOT NULL DEFAULT 'CUSTOM',
  ADD COLUMN "systemManaged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mandatory" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'ORGANIZATION',
  ADD COLUMN "payerName" TEXT,
  ADD COLUMN "payerEdiId" TEXT,
  ADD COLUMN "definition" JSONB,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'ORGANIZATION',
  ADD COLUMN "version" TEXT NOT NULL DEFAULT '1.0',
  ADD COLUMN "effectiveFrom" TIMESTAMP(3),
  ADD COLUMN "effectiveTo" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Rule_organizationId_deletedAt_idx" ON "Rule"("organizationId", "deletedAt");
CREATE INDEX "Rule_organizationId_category_idx" ON "Rule"("organizationId", "category");
CREATE INDEX "Rule_organizationId_scope_payerEdiId_idx" ON "Rule"("organizationId", "scope", "payerEdiId");
