CREATE TABLE "PayerContract" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "payerName" TEXT,
  "payerEdiId" TEXT,
  "version" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
  "notes" TEXT,
  CONSTRAINT "PayerContract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeeScheduleLine" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "contractId" TEXT NOT NULL,
  "cptHcpcsCode" TEXT NOT NULL,
  "modifier" TEXT,
  "placeOfService" TEXT,
  "unitRate" DECIMAL(14,2) NOT NULL,
  "description" TEXT,
  CONSTRAINT "FeeScheduleLine_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "UnderpaymentCase"
  ADD COLUMN "expectedPaymentSource" TEXT DEFAULT 'REMITTANCE_EXPECTATION',
  ADD COLUMN "contractId" TEXT,
  ADD COLUMN "calculationSnapshot" JSONB;

CREATE UNIQUE INDEX "PayerContract_organizationId_name_version_key"
  ON "PayerContract"("organizationId", "name", "version");
CREATE INDEX "PayerContract_organizationId_payerEdiId_status_idx"
  ON "PayerContract"("organizationId", "payerEdiId", "status");
CREATE INDEX "PayerContract_organizationId_payerName_status_idx"
  ON "PayerContract"("organizationId", "payerName", "status");
CREATE INDEX "PayerContract_effectiveFrom_effectiveTo_idx"
  ON "PayerContract"("effectiveFrom", "effectiveTo");
CREATE INDEX "FeeScheduleLine_contractId_cptHcpcsCode_idx"
  ON "FeeScheduleLine"("contractId", "cptHcpcsCode");
CREATE INDEX "FeeScheduleLine_cptHcpcsCode_idx"
  ON "FeeScheduleLine"("cptHcpcsCode");
CREATE INDEX "UnderpaymentCase_contractId_idx"
  ON "UnderpaymentCase"("contractId");

ALTER TABLE "PayerContract"
  ADD CONSTRAINT "PayerContract_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeeScheduleLine"
  ADD CONSTRAINT "FeeScheduleLine_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "PayerContract"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnderpaymentCase"
  ADD CONSTRAINT "UnderpaymentCase_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "PayerContract"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
