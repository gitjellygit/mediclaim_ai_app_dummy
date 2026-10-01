-- F3: organization / multi-tenant foundation.
-- Existing records are assigned to a single legacy organization so the migration
-- is backward-compatible. New authenticated writes must provide organizationId.

INSERT INTO "Organization" ("id", "createdAt", "updatedAt", "name", "slug")
VALUES ('org_legacy_default', NOW(), NOW(), 'Legacy Organization', 'legacy-default');

ALTER TABLE "User" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Claim" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Claim" ADD COLUMN "createdById" TEXT;

UPDATE "User" SET "organizationId" = 'org_legacy_default' WHERE "organizationId" IS NULL;
UPDATE "Claim" SET "organizationId" = 'org_legacy_default' WHERE "organizationId" IS NULL;

ALTER TABLE "User" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Claim" ALTER COLUMN "organizationId" SET NOT NULL;

CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");
CREATE INDEX "Claim_organizationId_createdAt_idx" ON "Claim"("organizationId", "createdAt");
CREATE INDEX "Claim_createdById_idx" ON "Claim"("createdById");

ALTER TABLE "User"
  ADD CONSTRAINT "User_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Claim"
  ADD CONSTRAINT "Claim_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Claim"
  ADD CONSTRAINT "Claim_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
