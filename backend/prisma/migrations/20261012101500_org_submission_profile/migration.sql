ALTER TABLE "Organization"
  ADD COLUMN "stediSubmitterName" TEXT,
  ADD COLUMN "stediSubmitterId" TEXT,
  ADD COLUMN "stediSubmitterPhone" TEXT,
  ADD COLUMN "stediBillingProviderName" TEXT,
  ADD COLUMN "stediBillingAddress1" TEXT,
  ADD COLUMN "stediBillingAddress2" TEXT,
  ADD COLUMN "stediBillingCity" TEXT,
  ADD COLUMN "stediBillingState" TEXT,
  ADD COLUMN "stediBillingPostalCode" TEXT,
  ADD COLUMN "stediProfessionalSignatureIndicator" TEXT,
  ADD COLUMN "stediProfessionalPlanParticipationCode" TEXT,
  ADD COLUMN "stediInstitutionalPlanParticipationCode" TEXT,
  ADD COLUMN "stediBenefitsAssignmentIndicator" TEXT,
  ADD COLUMN "stediReleaseInformationCode" TEXT,
  ADD COLUMN "stediDefaultProfessionalPlaceOfService" TEXT,
  ADD COLUMN "stediDefaultInstitutionalPlaceOfService" TEXT;

ALTER TABLE "PayerTransaction"
  ADD COLUMN "requestHash" TEXT;

CREATE UNIQUE INDEX "PayerTransaction_claimId_transactionType_requestHash_key"
  ON "PayerTransaction"("claimId", "transactionType", "requestHash");
