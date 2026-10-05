-- H8B-1: make configurable readiness rules organization-scoped.
-- Existing global rules are cloned to every existing organization so no tenant
-- loses the configured readiness behavior it had before this migration.

ALTER TABLE "Rule" ADD COLUMN "organizationId" TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Rule")
     AND NOT EXISTS (SELECT 1 FROM "Organization") THEN
    RAISE EXCEPTION
      'Cannot tenant-scope existing rules because no Organization rows exist';
  END IF;
END $$;

-- code is no longer globally unique; it is unique within an organization.
ALTER TABLE "Rule" DROP CONSTRAINT IF EXISTS "Rule_code_key";

-- Snapshot the old global definitions before replacing them with tenant copies.
CREATE TEMP TABLE "_RuleGlobalSnapshot" ON COMMIT DROP AS
SELECT "createdAt", "code", "name", "severity", "enabled"
FROM "Rule";

DELETE FROM "Rule";

INSERT INTO "Rule" (
  "id",
  "createdAt",
  "organizationId",
  "code",
  "name",
  "severity",
  "enabled"
)
SELECT
  'rule_mig_' || md5(o."id" || ':' || r."code"),
  r."createdAt",
  o."id",
  r."code",
  r."name",
  r."severity",
  r."enabled"
FROM "Organization" o
CROSS JOIN "_RuleGlobalSnapshot" r;

ALTER TABLE "Rule" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Rule"
ADD CONSTRAINT "Rule_organizationId_code_key"
UNIQUE ("organizationId", "code");

ALTER TABLE "Rule"
ADD CONSTRAINT "Rule_organizationId_fkey"
FOREIGN KEY ("organizationId")
REFERENCES "Organization"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

CREATE INDEX "Rule_organizationId_idx" ON "Rule"("organizationId");
