ALTER TABLE "Claim"
  ADD COLUMN "assignedToUserId" TEXT,
  ADD COLUMN "workTeam" TEXT,
  ADD COLUMN "workDueAt" TIMESTAMP(3),
  ADD COLUMN "nextFollowUpAt" TIMESTAMP(3),
  ADD COLUMN "lastWorkedAt" TIMESTAMP(3),
  ADD COLUMN "escalatedAt" TIMESTAMP(3);

ALTER TABLE "Claim"
  ADD CONSTRAINT "Claim_assignedToUserId_fkey"
  FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Claim_assignedToUserId_idx" ON "Claim"("assignedToUserId");
CREATE INDEX "Claim_organizationId_workDueAt_idx" ON "Claim"("organizationId", "workDueAt");
CREATE INDEX "Claim_organizationId_nextFollowUpAt_idx" ON "Claim"("organizationId", "nextFollowUpAt");
