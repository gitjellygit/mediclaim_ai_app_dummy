ALTER TABLE "Check"
ADD COLUMN "isStale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "staleAt" TIMESTAMP(3),
ADD COLUMN "staleReason" TEXT;

CREATE INDEX "Check_claimId_createdAt_idx"
ON "Check"("claimId", "createdAt");
