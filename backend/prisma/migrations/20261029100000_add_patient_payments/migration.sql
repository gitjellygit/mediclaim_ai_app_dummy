-- Patient responsibility workflow for pure self-pay and patient balances.

CREATE TABLE "PatientBalance" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdById" TEXT,
  "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
  "sourceConnectionId" TEXT,
  "externalKey" TEXT NOT NULL,
  "externalPatientId" TEXT,
  "externalEncounterId" TEXT,
  "patientName" TEXT NOT NULL,
  "medicalRecordNumber" TEXT,
  "serviceDate" DATE,
  "totalCharges" DECIMAL(14,2) NOT NULL,
  "insuranceResponsibility" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "patientResponsibility" DECIMAL(14,2) NOT NULL,
  "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "balanceAmount" DECIMAL(14,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UNPAID',
  "statementStatus" TEXT NOT NULL DEFAULT 'NOT_SENT',
  "paymentPlanStatus" TEXT NOT NULL DEFAULT 'NONE',
  "notes" TEXT,
  CONSTRAINT "PatientBalance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PatientPayment" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organizationId" TEXT NOT NULL,
  "patientBalanceId" TEXT NOT NULL,
  "recordedById" TEXT,
  "amount" DECIMAL(14,2) NOT NULL,
  "method" TEXT NOT NULL,
  "reference" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  CONSTRAINT "PatientPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PatientBalance_organizationId_externalKey_key"
  ON "PatientBalance"("organizationId", "externalKey");
CREATE INDEX "PatientBalance_organizationId_status_createdAt_idx"
  ON "PatientBalance"("organizationId", "status", "createdAt");
CREATE INDEX "PatientBalance_externalEncounterId_idx"
  ON "PatientBalance"("externalEncounterId");
CREATE INDEX "PatientBalance_patientName_idx"
  ON "PatientBalance"("patientName");
CREATE INDEX "PatientPayment_organizationId_createdAt_idx"
  ON "PatientPayment"("organizationId", "createdAt");
CREATE INDEX "PatientPayment_patientBalanceId_paidAt_idx"
  ON "PatientPayment"("patientBalanceId", "paidAt");

ALTER TABLE "PatientBalance"
  ADD CONSTRAINT "PatientBalance_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientBalance"
  ADD CONSTRAINT "PatientBalance_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PatientPayment"
  ADD CONSTRAINT "PatientPayment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientPayment"
  ADD CONSTRAINT "PatientPayment_patientBalanceId_fkey"
  FOREIGN KEY ("patientBalanceId") REFERENCES "PatientBalance"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientPayment"
  ADD CONSTRAINT "PatientPayment_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
