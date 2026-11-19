CREATE TABLE "MedicareRateSchedule" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "locality" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "source" TEXT NOT NULL,
  "notes" TEXT,
  CONSTRAINT "MedicareRateSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MedicareRateLine" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "cptHcpcsCode" TEXT NOT NULL,
  "modifier" TEXT,
  "placeOfService" TEXT,
  "amount" DECIMAL(14,2) NOT NULL,
  "description" TEXT,
  CONSTRAINT "MedicareRateLine_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PayerContract"
  ADD COLUMN "pricingMethod" TEXT NOT NULL DEFAULT 'FEE_SCHEDULE',
  ADD COLUMN "referencePercent" DECIMAL(8,4),
  ADD COLUMN "roundingMode" TEXT NOT NULL DEFAULT 'HALF_UP',
  ADD COLUMN "pricingSourceDocumentId" TEXT,
  ADD COLUMN "pricingSourcePage" INTEGER,
  ADD COLUMN "pricingSourceClause" TEXT,
  ADD COLUMN "pricingExtractionMethod" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "pricingReviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "pricingReviewedByUserId" TEXT,
  ADD COLUMN "pricingReviewedAt" TIMESTAMP(3),
  ADD COLUMN "medicareRateScheduleId" TEXT;

ALTER TABLE "MedicareRateSchedule"
  ADD CONSTRAINT "MedicareRateSchedule_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MedicareRateLine"
  ADD CONSTRAINT "MedicareRateLine_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "MedicareRateSchedule"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayerContract"
  ADD CONSTRAINT "PayerContract_medicareRateScheduleId_fkey"
  FOREIGN KEY ("medicareRateScheduleId") REFERENCES "MedicareRateSchedule"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "MedicareRateSchedule_organizationId_year_locality_key"
  ON "MedicareRateSchedule"("organizationId", "year", "locality");
CREATE INDEX "MedicareRateSchedule_organizationId_status_year_locality_idx"
  ON "MedicareRateSchedule"("organizationId", "status", "year", "locality");
CREATE INDEX "MedicareRateLine_scheduleId_cptHcpcsCode_idx"
  ON "MedicareRateLine"("scheduleId", "cptHcpcsCode");
CREATE INDEX "PayerContract_organizationId_pricingMethod_status_idx"
  ON "PayerContract"("organizationId", "pricingMethod", "status");
CREATE INDEX "PayerContract_medicareRateScheduleId_idx"
  ON "PayerContract"("medicareRateScheduleId");
