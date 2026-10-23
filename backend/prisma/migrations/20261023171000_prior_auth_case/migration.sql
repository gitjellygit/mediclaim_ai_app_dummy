CREATE TABLE "PriorAuthCase" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "requirementSource" TEXT,
  "payerReference" TEXT,
  "submissionChannel" TEXT,
  "submittedAt" TIMESTAMP(3),
  "responseDueAt" TIMESTAMP(3),
  "decisionAt" TIMESTAMP(3),
  "authorizationNo" TEXT,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveTo" TIMESTAMP(3),
  "requiredDocuments" JSONB,
  "missingDocuments" JSONB,
  "additionalInfoRequests" JSONB,
  "notes" TEXT,
  CONSTRAINT "PriorAuthCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PriorAuthCase_claimId_key" ON "PriorAuthCase"("claimId");
CREATE INDEX "PriorAuthCase_organizationId_status_idx" ON "PriorAuthCase"("organizationId", "status");
CREATE INDEX "PriorAuthCase_responseDueAt_idx" ON "PriorAuthCase"("responseDueAt");

ALTER TABLE "PriorAuthCase"
  ADD CONSTRAINT "PriorAuthCase_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PriorAuthCase"
  ADD CONSTRAINT "PriorAuthCase_claimId_fkey"
  FOREIGN KEY ("claimId") REFERENCES "Claim"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
