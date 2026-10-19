ALTER TABLE "Organization"
  ADD COLUMN "rulesetRevision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Check"
  ADD COLUMN "rulesetRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "rulesetFingerprint" TEXT;

ALTER TABLE "Rule"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "RuleVersion" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organizationId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "versionLabel" TEXT NOT NULL,
  "changeType" TEXT NOT NULL,
  "changedByUserId" TEXT,
  "snapshot" JSONB NOT NULL,
  CONSTRAINT "RuleVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RuleVersion_ruleId_revision_key"
  ON "RuleVersion"("ruleId", "revision");

CREATE INDEX "RuleVersion_organizationId_createdAt_idx"
  ON "RuleVersion"("organizationId", "createdAt");

CREATE INDEX "RuleVersion_ruleId_createdAt_idx"
  ON "RuleVersion"("ruleId", "createdAt");

ALTER TABLE "RuleVersion"
  ADD CONSTRAINT "RuleVersion_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RuleVersion"
  ADD CONSTRAINT "RuleVersion_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "Rule"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Snapshot every existing rule so history starts at the hardening migration.
INSERT INTO "RuleVersion" (
  "id", "organizationId", "ruleId", "revision", "versionLabel",
  "changeType", "changedByUserId", "snapshot"
)
SELECT
  'rv_' || md5(random()::text || clock_timestamp()::text || r."id"),
  r."organizationId",
  r."id",
  1,
  r."version",
  'BASELINE',
  NULL,
  jsonb_build_object(
    'code', r."code",
    'name', r."name",
    'description', r."description",
    'category', r."category",
    'severity', r."severity",
    'enabled', r."enabled",
    'ruleType', r."ruleType",
    'systemManaged', r."systemManaged",
    'mandatory', r."mandatory",
    'scope', r."scope",
    'payerName', r."payerName",
    'payerEdiId', r."payerEdiId",
    'definition', r."definition",
    'source', r."source",
    'version', r."version",
    'effectiveFrom', r."effectiveFrom",
    'effectiveTo', r."effectiveTo",
    'deletedAt', r."deletedAt"
  )
FROM "Rule" r;
