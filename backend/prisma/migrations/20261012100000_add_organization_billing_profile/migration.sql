-- Per-organization billing/EDI configuration.
-- Deliberately nullable: production claim submission must fail closed until an
-- organization explicitly configures and activates its profile.
CREATE TABLE "OrganizationBillingProfile" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "submitterName" TEXT,
  "submitterId" TEXT,
  "submitterPhone" TEXT,
  "billingProviderName" TEXT,
  "billingAddress1" TEXT,
  "billingAddress2" TEXT,
  "billingCity" TEXT,
  "billingState" TEXT,
  "billingPostalCode" TEXT,
  "signatureOnFile" BOOLEAN,
  "assignmentOfBenefits" BOOLEAN,
  "releaseOfInformation" BOOLEAN,
  "professionalPlanParticipationCode" TEXT,
  "institutionalPlanParticipationCode" TEXT,
  "defaultProfessionalPlaceOfService" TEXT,
  "defaultInstitutionalPlaceOfService" TEXT,

  CONSTRAINT "OrganizationBillingProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationBillingProfile_organizationId_key"
ON "OrganizationBillingProfile"("organizationId");

CREATE INDEX "OrganizationBillingProfile_organizationId_idx"
ON "OrganizationBillingProfile"("organizationId");

ALTER TABLE "OrganizationBillingProfile"
ADD CONSTRAINT "OrganizationBillingProfile_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
