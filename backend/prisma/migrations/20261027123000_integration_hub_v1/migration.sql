CREATE TABLE "IntegrationRecord" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "claimId" TEXT,
  "resourceType" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "sourceFormat" TEXT NOT NULL,
  "sourceType" TEXT,
  "dataHash" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sourceUpdatedAt" TIMESTAMP(3),
  "provenance" JSONB,
  CONSTRAINT "IntegrationRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationRecord_connectionId_resourceType_externalId_key"
  ON "IntegrationRecord"("connectionId", "resourceType", "externalId");
CREATE INDEX "IntegrationRecord_organizationId_resourceType_updatedAt_idx"
  ON "IntegrationRecord"("organizationId", "resourceType", "updatedAt");
CREATE INDEX "IntegrationRecord_claimId_resourceType_idx"
  ON "IntegrationRecord"("claimId", "resourceType");
CREATE INDEX "IntegrationRecord_connectionId_lastSeenAt_idx"
  ON "IntegrationRecord"("connectionId", "lastSeenAt");

ALTER TABLE "IntegrationRecord"
  ADD CONSTRAINT "IntegrationRecord_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntegrationRecord"
  ADD CONSTRAINT "IntegrationRecord_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntegrationRecord"
  ADD CONSTRAINT "IntegrationRecord_claimId_fkey"
  FOREIGN KEY ("claimId") REFERENCES "Claim"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
