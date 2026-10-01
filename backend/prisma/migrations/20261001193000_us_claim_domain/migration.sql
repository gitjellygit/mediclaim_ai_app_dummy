-- U2: convert India-oriented claim terminology to U.S. insurance terminology
-- while preserving all existing data in place.

ALTER TYPE "ClaimType" RENAME VALUE 'CASHLESS' TO 'PROVIDER_BILLED';
ALTER TYPE "ClaimType" RENAME VALUE 'REIMBURSEMENT' TO 'MEMBER_REIMBURSEMENT';

ALTER TABLE "Claim" RENAME COLUMN "uhid" TO "medicalRecordNumber";
ALTER TABLE "Claim" RENAME COLUMN "tpaName" TO "planAdministratorName";
ALTER TABLE "Claim" RENAME COLUMN "sumInsured" TO "coverageLimit";
ALTER TABLE "Claim" RENAME COLUMN "balanceSumInsured" TO "remainingCoverageLimit";
ALTER TABLE "Claim" RENAME COLUMN "tpaReferenceNo" TO "payerReferenceNo";
