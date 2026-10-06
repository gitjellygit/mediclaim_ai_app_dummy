ALTER TABLE "Claim" ADD COLUMN "payerConnectorId" TEXT;
CREATE INDEX "Claim_payerConnectorId_idx" ON "Claim"("payerConnectorId");
