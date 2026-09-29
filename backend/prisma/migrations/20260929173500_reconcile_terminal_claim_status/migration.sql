-- Reconcile historical journey records so the overall claim lifecycle matches
-- terminal payer/remittance outcomes already recorded in the database.

UPDATE "Claim"
SET "status" = 'DENIED'
WHERE "payerClaimStatus" = 'DENIED'
  AND "status" = 'SUBMITTED';

UPDATE "Claim"
SET "status" = 'PAID'
WHERE "remittanceStatus" = 'POSTED'
  AND COALESCE("paidAmount", 0) > 0
  AND "status" IN ('SUBMITTED', 'DENIED');
