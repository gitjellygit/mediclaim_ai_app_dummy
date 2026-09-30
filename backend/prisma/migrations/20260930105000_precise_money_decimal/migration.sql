-- This is a lossless widening conversion for existing integer-dollar rows.
-- Decimal strings retain cent precision for all new writes.
-- Take a database snapshot before applying to an existing environment.
ALTER TABLE "Claim"
  ALTER COLUMN "amount" TYPE DECIMAL(14,2) USING "amount"::DECIMAL(14,2),
  ALTER COLUMN "sumInsured" TYPE DECIMAL(14,2) USING "sumInsured"::DECIMAL(14,2),
  ALTER COLUMN "balanceSumInsured" TYPE DECIMAL(14,2) USING "balanceSumInsured"::DECIMAL(14,2),
  ALTER COLUMN "totalBilledAmount" TYPE DECIMAL(14,2) USING "totalBilledAmount"::DECIMAL(14,2),
  ALTER COLUMN "approvedAmount" TYPE DECIMAL(14,2) USING "approvedAmount"::DECIMAL(14,2),
  ALTER COLUMN "deductionAmount" TYPE DECIMAL(14,2) USING "deductionAmount"::DECIMAL(14,2),
  ALTER COLUMN "copayAmount" TYPE DECIMAL(14,2) USING "copayAmount"::DECIMAL(14,2),
  ALTER COLUMN "deductibleRemaining" TYPE DECIMAL(14,2) USING "deductibleRemaining"::DECIMAL(14,2),
  ALTER COLUMN "allowedAmount" TYPE DECIMAL(14,2) USING "allowedAmount"::DECIMAL(14,2),
  ALTER COLUMN "patientResponsibility" TYPE DECIMAL(14,2) USING "patientResponsibility"::DECIMAL(14,2),
  ALTER COLUMN "paidAmount" TYPE DECIMAL(14,2) USING "paidAmount"::DECIMAL(14,2);

ALTER TABLE "DenialCase"
  ALTER COLUMN "revenueAtRisk" TYPE DECIMAL(14,2) USING "revenueAtRisk"::DECIMAL(14,2),
  ALTER COLUMN "recoveredAmount" TYPE DECIMAL(14,2) USING "recoveredAmount"::DECIMAL(14,2);
