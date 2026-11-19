ALTER TABLE "PayerContract"
  ADD COLUMN "productType" TEXT,
  ADD COLUMN "groupNumber" TEXT,
  ADD COLUMN "networkStatus" TEXT,
  ADD COLUMN "providerTin" TEXT,
  ADD COLUMN "placeOfService" TEXT;

CREATE INDEX "PayerContract_organizationId_productType_groupNumber_networkStatus_idx"
  ON "PayerContract"("organizationId", "productType", "groupNumber", "networkStatus");

CREATE INDEX "PayerContract_organizationId_providerTin_placeOfService_idx"
  ON "PayerContract"("organizationId", "providerTin", "placeOfService");
