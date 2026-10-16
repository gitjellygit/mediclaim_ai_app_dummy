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

UPDATE "Rule"
SET "ruleType" = 'SYSTEM',
    "systemManaged" = true,
    "source" = 'SYSTEM',
    "mandatory" = CASE
      WHEN "code" = 'RECOMMENDED_ICD' THEN false
      ELSE true
    END,
    "category" = CASE
      WHEN "code" IN ('REQ_POLICY_NO', 'US_MEMBER_ID') THEN 'PATIENT_COVERAGE'
      WHEN "code" = 'US_NPI_VALID' THEN 'PROVIDER'
      WHEN "code" IN ('US_CPT_PRESENT', 'US_DIAGNOSIS_CPT_LINK', 'RECOMMENDED_ICD') THEN 'CODING'
      WHEN "code" = 'US_PRIOR_AUTH' THEN 'AUTHORIZATION'
      ELSE 'CLAIM'
    END
WHERE "code" IN (
  'REQ_POLICY_NO',
  'RECOMMENDED_ICD',
  'US_NPI_VALID',
  'US_CPT_PRESENT',
  'US_DIAGNOSIS_CPT_LINK',
  'US_TIMELY_FILING',
  'US_MEMBER_ID',
  'US_PRIOR_AUTH',
  'US_837_SUBMISSION_FIELDS'
);
