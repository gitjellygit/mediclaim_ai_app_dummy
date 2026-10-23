CREATE TABLE "IntegrationConnection" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'SANDBOX',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastHealthyAt" TIMESTAMP(3),
  "lastErrorAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClaimExternalIdentity" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "externalClaimId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL DEFAULT 'CLAIM',
  CONSTRAINT "ClaimExternalIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntegrationEvent" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "claimId" TEXT,
  "externalEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "sourceStatus" TEXT,
  "correlationId" TEXT,
  "payloadHash" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "metadata" JSONB,
  CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationConnection_organizationId_name_key" ON "IntegrationConnection"("organizationId", "name");
CREATE INDEX "IntegrationConnection_organizationId_kind_status_idx" ON "IntegrationConnection"("organizationId", "kind", "status");
CREATE UNIQUE INDEX "ClaimExternalIdentity_connectionId_externalClaimId_key" ON "ClaimExternalIdentity"("connectionId", "externalClaimId");
CREATE INDEX "ClaimExternalIdentity_organizationId_claimId_idx" ON "ClaimExternalIdentity"("organizationId", "claimId");
CREATE INDEX "ClaimExternalIdentity_claimId_idx" ON "ClaimExternalIdentity"("claimId");
CREATE UNIQUE INDEX "IntegrationEvent_connectionId_externalEventId_key" ON "IntegrationEvent"("connectionId", "externalEventId");
CREATE INDEX "IntegrationEvent_organizationId_createdAt_idx" ON "IntegrationEvent"("organizationId", "createdAt");
CREATE INDEX "IntegrationEvent_claimId_createdAt_idx" ON "IntegrationEvent"("claimId", "createdAt");
CREATE INDEX "IntegrationEvent_connectionId_status_createdAt_idx" ON "IntegrationEvent"("connectionId", "status", "createdAt");

ALTER TABLE "IntegrationConnection"
  ADD CONSTRAINT "IntegrationConnection_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClaimExternalIdentity"
  ADD CONSTRAINT "ClaimExternalIdentity_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClaimExternalIdentity"
  ADD CONSTRAINT "ClaimExternalIdentity_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClaimExternalIdentity"
  ADD CONSTRAINT "ClaimExternalIdentity_claimId_fkey"
  FOREIGN KEY ("claimId") REFERENCES "Claim"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntegrationEvent"
  ADD CONSTRAINT "IntegrationEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntegrationEvent"
  ADD CONSTRAINT "IntegrationEvent_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntegrationEvent"
  ADD CONSTRAINT "IntegrationEvent_claimId_fkey"
  FOREIGN KEY ("claimId") REFERENCES "Claim"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
