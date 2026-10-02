-- U3: U.S. claim data model foundation

CREATE TYPE "SubscriberRelationship" AS ENUM ('SELF', 'SPOUSE', 'CHILD', 'OTHER');
CREATE TYPE "CoordinationOfBenefits" AS ENUM ('PRIMARY', 'SECONDARY', 'TERTIARY');
CREATE TYPE "ClaimFrequencyCode" AS ENUM ('ORIGINAL', 'CORRECTED', 'VOID');

ALTER TABLE "Claim"
  ADD COLUMN "billingProviderNpi" TEXT,
  ADD COLUMN "renderingProviderNpi" TEXT,
  ADD COLUMN "referringProviderNpi" TEXT,
  ADD COLUMN "providerTin" TEXT,
  ADD COLUMN "providerTaxonomyCode" TEXT,
  ADD COLUMN "inpatientProcedureCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "groupNumber" TEXT,
  ADD COLUMN "subscriberId" TEXT,
  ADD COLUMN "subscriberName" TEXT,
  ADD COLUMN "subscriberRelationship" "SubscriberRelationship",
  ADD COLUMN "coordinationOfBenefits" "CoordinationOfBenefits",
  ADD COLUMN "payerEdiId" TEXT,
  ADD COLUMN "typeOfBill" TEXT,
  ADD COLUMN "drgCode" TEXT,
  ADD COLUMN "claimFrequencyCode" "ClaimFrequencyCode" NOT NULL DEFAULT 'ORIGINAL',
  ADD COLUMN "timelyFilingDeadline" TIMESTAMP(3);

CREATE TABLE "ServiceLine" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "claimId" TEXT NOT NULL,
  "cptHcpcsCode" TEXT NOT NULL,
  "modifiers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "units" DECIMAL(10,2),
  "charge" DECIMAL(14,2),
  "diagnosisPointers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "placeOfService" TEXT,
  "serviceDateFrom" TIMESTAMP(3),
  "serviceDateTo" TIMESTAMP(3),
  "revenueCode" TEXT,
  "poaIndicator" TEXT,

  CONSTRAINT "ServiceLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceLine_claimId_idx" ON "ServiceLine"("claimId");
CREATE INDEX "ServiceLine_cptHcpcsCode_idx" ON "ServiceLine"("cptHcpcsCode");

ALTER TABLE "ServiceLine"
  ADD CONSTRAINT "ServiceLine_claimId_fkey"
  FOREIGN KEY ("claimId") REFERENCES "Claim"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
