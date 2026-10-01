-- F4: soft-delete claims and make audit events tenant-owned.
ALTER TABLE "Claim" ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "AuditEvent" ADD COLUMN "organizationId" TEXT;

UPDATE "AuditEvent" a
SET "organizationId" = COALESCE(
  (SELECT c."organizationId" FROM "Claim" c WHERE c."id" = a."claimId"),
  (SELECT u."organizationId" FROM "User" u WHERE u."id" = a."actorUserId"),
  'org_legacy_default'
)
WHERE a."organizationId" IS NULL;

ALTER TABLE "AuditEvent" ALTER COLUMN "organizationId" SET NOT NULL;

CREATE INDEX "Claim_organizationId_deletedAt_createdAt_idx"
  ON "Claim"("organizationId", "deletedAt", "createdAt");
DROP INDEX IF EXISTS "Claim_organizationId_createdAt_idx";

CREATE INDEX "AuditEvent_organizationId_createdAt_idx"
  ON "AuditEvent"("organizationId", "createdAt");

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
