-- CreateTable
CREATE TABLE "CodeSetRelease" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "system" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "authoritative" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "CodeSetRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeDefinition" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releaseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "activeFrom" DATE,
    "activeTo" DATE,
    CONSTRAINT "CodeDefinition_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "CodeSetRelease_system_version_key" ON "CodeSetRelease"("system", "version");
CREATE INDEX "CodeSetRelease_system_effectiveFrom_effectiveTo_idx" ON "CodeSetRelease"("system", "effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "CodeDefinition_releaseId_code_key" ON "CodeDefinition"("releaseId", "code");
CREATE INDEX "CodeDefinition_code_idx" ON "CodeDefinition"("code");
CREATE INDEX "CodeDefinition_releaseId_activeFrom_activeTo_idx" ON "CodeDefinition"("releaseId", "activeFrom", "activeTo");

-- ForeignKey
ALTER TABLE "CodeDefinition" ADD CONSTRAINT "CodeDefinition_releaseId_fkey"
FOREIGN KEY ("releaseId") REFERENCES "CodeSetRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
