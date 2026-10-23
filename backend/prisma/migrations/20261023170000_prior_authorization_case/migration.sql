CREATE TABLE "PriorAuthorizationCase" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "claimId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUIRED',
  "urgency" TEXT NOT NULL DEFAULT 'STANDARD',
  "requirementSource" TEXT,
  "requiredDocuments" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "evidenceDocumentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "responseDueAt" TIMESTAMP(3),
  "additionalInfoDueAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "decisionAt" TIMESTAMP(3),
  "submissionChannel" TEXT,
  "externalReference" TEXT,
  "authorizationNo" TEXT,
  "expiry" TIMESTAMP(3),
  "notes" TEXT,
  CONSTRAINT "PriorAuthorizationCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PriorAuthorizationCase_claimId_key" ON "PriorAuthorizationCase"("claimId");
CREATE INDEX "PriorAuthorizationCase_status_responseDueAt_idx" ON "PriorAuthorizationCase"("status", "responseDueAt");
CREATE INDEX "PriorAuthorizationCase_additionalInfoDueAt_idx" ON "PriorAuthorizationCase"("additionalInfoDueAt");

ALTER TABLE "PriorAuthorizationCase"
  ADD CONSTRAINT "PriorAuthorizationCase_claimId_fkey"
  FOREIGN KEY ("claimId") REFERENCES "Claim"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
