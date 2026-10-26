ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'CLAIMS_MANAGER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'CLAIMS_SPECIALIST';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DENIAL_SPECIALIST';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PRIOR_AUTH_SPECIALIST';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ACCOUNTANT';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'CLINICAL_REVIEWER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'AUDITOR';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PROVIDER';

ALTER TABLE "Claim"
  ADD COLUMN "managerPriority" TEXT,
  ADD COLUMN "managerPriorityReason" TEXT,
  ADD COLUMN "holdReason" TEXT,
  ADD COLUMN "holdUntil" TIMESTAMP(3);

ALTER TABLE "User"
  ADD COLUMN "displayName" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "teamId" TEXT;

CREATE TABLE "Team" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SavedQueue" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "filters" JSONB NOT NULL,
  "sharedWithTeam" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "SavedQueue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClaimComment" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organizationId" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "mentionUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  CONSTRAINT "ClaimComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClinicalRequest" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "assignedToUserId" TEXT,
  "requestType" TEXT NOT NULL,
  "requestText" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "dueAt" TIMESTAMP(3),
  "responseText" TEXT,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "ClinicalRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "claimId" TEXT,
  "readAt" TIMESTAMP(3),
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApprovalRequest" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "reviewedByUserId" TEXT,
  "requestType" TEXT NOT NULL,
  "amount" DECIMAL(14,2),
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "decisionReason" TEXT,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClaimOwnershipHistory" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organizationId" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "changedByUserId" TEXT,
  "previousAssigneeUserId" TEXT,
  "newAssigneeUserId" TEXT,
  "previousTeam" TEXT,
  "newTeam" TEXT,
  "previousPriority" TEXT,
  "newPriority" TEXT,
  "reason" TEXT,
  CONSTRAINT "ClaimOwnershipHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Team_organizationId_name_key" ON "Team"("organizationId","name");
CREATE INDEX "Team_organizationId_active_idx" ON "Team"("organizationId","active");
CREATE UNIQUE INDEX "SavedQueue_ownerUserId_name_key" ON "SavedQueue"("ownerUserId","name");
CREATE INDEX "SavedQueue_organizationId_ownerUserId_idx" ON "SavedQueue"("organizationId","ownerUserId");
CREATE INDEX "ClaimComment_organizationId_claimId_createdAt_idx" ON "ClaimComment"("organizationId","claimId","createdAt");
CREATE INDEX "ClinicalRequest_organizationId_status_dueAt_idx" ON "ClinicalRequest"("organizationId","status","dueAt");
CREATE INDEX "ClinicalRequest_assignedToUserId_status_idx" ON "ClinicalRequest"("assignedToUserId","status");
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId","readAt","createdAt");
CREATE INDEX "Notification_organizationId_createdAt_idx" ON "Notification"("organizationId","createdAt");
CREATE INDEX "ApprovalRequest_organizationId_status_createdAt_idx" ON "ApprovalRequest"("organizationId","status","createdAt");
CREATE INDEX "ApprovalRequest_claimId_status_idx" ON "ApprovalRequest"("claimId","status");
CREATE INDEX "ClaimOwnershipHistory_organizationId_claimId_createdAt_idx" ON "ClaimOwnershipHistory"("organizationId","claimId","createdAt");
CREATE INDEX "User_teamId_idx" ON "User"("teamId");

ALTER TABLE "Team" ADD CONSTRAINT "Team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SavedQueue" ADD CONSTRAINT "SavedQueue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedQueue" ADD CONSTRAINT "SavedQueue_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClaimComment" ADD CONSTRAINT "ClaimComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClaimComment" ADD CONSTRAINT "ClaimComment_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClaimComment" ADD CONSTRAINT "ClaimComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalRequest" ADD CONSTRAINT "ClinicalRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClinicalRequest" ADD CONSTRAINT "ClinicalRequest_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClinicalRequest" ADD CONSTRAINT "ClinicalRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClinicalRequest" ADD CONSTRAINT "ClinicalRequest_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClaimOwnershipHistory" ADD CONSTRAINT "ClaimOwnershipHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClaimOwnershipHistory" ADD CONSTRAINT "ClaimOwnershipHistory_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClaimOwnershipHistory" ADD CONSTRAINT "ClaimOwnershipHistory_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
