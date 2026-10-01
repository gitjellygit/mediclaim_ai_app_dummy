-- F2: replace free-text workflow/status columns with controlled PostgreSQL enums.
-- Existing recognized values are preserved. Unexpected legacy values are mapped
-- to conservative non-final states so the migration can complete safely.

CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'READY', 'SUBMITTED', 'DENIED', 'PAID');
CREATE TYPE "EligibilityStatus" AS ENUM ('NOT_CHECKED', 'VERIFIED', 'NEEDS_REVIEW', 'FAILED');
CREATE TYPE "PriorAuthStatus" AS ENUM ('NOT_CHECKED', 'NEEDS_REVIEW', 'NOT_REQUIRED', 'REQUIRED', 'APPROVED', 'DENIED');
CREATE TYPE "PayerClaimStatus" AS ENUM ('SUBMITTED', 'ACKNOWLEDGED', 'IN_REVIEW', 'PENDED', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'DENIED', 'PAID');
CREATE TYPE "RemittanceStatus" AS ENUM ('NOT_AVAILABLE', 'AWAITING', 'RECEIVED', 'POSTED');
CREATE TYPE "PayerConnectionMode" AS ENUM ('LOCAL', 'SIMULATED', 'LIVE');
CREATE TYPE "DocumentType" AS ENUM ('DISCHARGE_SUMMARY', 'FINAL_BILL', 'BREAKUP_BILL', 'LAB_REPORT', 'RADIOLOGY', 'PRESCRIPTION', 'ID_PROOF', 'INSURANCE_CARD', 'PRIOR_AUTHORIZATION', 'OPERATIVE_NOTE', 'PROGRESS_NOTE', 'EOB', 'OTHER');
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');
CREATE TYPE "DenialCaseStatus" AS ENUM ('OPEN', 'ANALYZED', 'CORRECTION_REQUIRED', 'APPEAL_PREPARED', 'APPEAL_SUBMITTED', 'RESUBMITTED', 'OVERTURNED', 'UPHELD', 'CLOSED');
CREATE TYPE "DenialCaseSource" AS ENUM ('MANUAL', 'PAYER_STATUS', 'SIMULATED_PAYER_STATUS');

ALTER TABLE "Claim"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "ClaimStatus"
    USING (
      CASE
        WHEN "status" IN ('DRAFT','NEEDS_REVIEW','READY','SUBMITTED','DENIED','PAID')
          THEN "status"
        ELSE 'DRAFT'
      END
    )::"ClaimStatus",
  ALTER COLUMN "status" SET DEFAULT 'DRAFT',
  ALTER COLUMN "eligibilityStatus" DROP DEFAULT,
  ALTER COLUMN "eligibilityStatus" TYPE "EligibilityStatus"
    USING (
      CASE
        WHEN "eligibilityStatus" IN ('NOT_CHECKED','VERIFIED','NEEDS_REVIEW','FAILED')
          THEN "eligibilityStatus"
        ELSE 'NEEDS_REVIEW'
      END
    )::"EligibilityStatus",
  ALTER COLUMN "eligibilityStatus" SET DEFAULT 'NOT_CHECKED',
  ALTER COLUMN "priorAuthStatus" DROP DEFAULT,
  ALTER COLUMN "priorAuthStatus" TYPE "PriorAuthStatus"
    USING (
      CASE
        WHEN "priorAuthStatus" IN ('NOT_CHECKED','NEEDS_REVIEW','NOT_REQUIRED','REQUIRED','APPROVED','DENIED')
          THEN "priorAuthStatus"
        ELSE 'NEEDS_REVIEW'
      END
    )::"PriorAuthStatus",
  ALTER COLUMN "priorAuthStatus" SET DEFAULT 'NOT_CHECKED',
  ALTER COLUMN "payerClaimStatus" TYPE "PayerClaimStatus"
    USING (
      CASE
        WHEN "payerClaimStatus" IS NULL THEN NULL
        WHEN "payerClaimStatus" IN ('SUBMITTED','ACKNOWLEDGED','IN_REVIEW','PENDED','APPROVED','PARTIALLY_APPROVED','REJECTED','DENIED','PAID')
          THEN "payerClaimStatus"
        ELSE NULL
      END
    )::"PayerClaimStatus",
  ALTER COLUMN "remittanceStatus" DROP DEFAULT,
  ALTER COLUMN "remittanceStatus" TYPE "RemittanceStatus"
    USING (
      CASE
        WHEN "remittanceStatus" IN ('NOT_AVAILABLE','AWAITING','RECEIVED','POSTED')
          THEN "remittanceStatus"
        ELSE 'NOT_AVAILABLE'
      END
    )::"RemittanceStatus",
  ALTER COLUMN "remittanceStatus" SET DEFAULT 'NOT_AVAILABLE',
  ALTER COLUMN "payerConnectionMode" DROP DEFAULT,
  ALTER COLUMN "payerConnectionMode" TYPE "PayerConnectionMode"
    USING (
      CASE
        WHEN "payerConnectionMode" IN ('LOCAL','SIMULATED','LIVE')
          THEN "payerConnectionMode"
        ELSE 'LOCAL'
      END
    )::"PayerConnectionMode",
  ALTER COLUMN "payerConnectionMode" SET DEFAULT 'LOCAL';

ALTER TABLE "Document"
  ALTER COLUMN "type" TYPE "DocumentType"
    USING (
      CASE
        WHEN "type" IN ('DISCHARGE_SUMMARY','FINAL_BILL','BREAKUP_BILL','LAB_REPORT','RADIOLOGY','PRESCRIPTION','ID_PROOF','INSURANCE_CARD','PRIOR_AUTHORIZATION','OPERATIVE_NOTE','PROGRESS_NOTE','EOB','OTHER')
          THEN "type"
        ELSE 'OTHER'
      END
    )::"DocumentType",
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "DocumentStatus"
    USING (
      CASE
        WHEN "status" IN ('PENDING','PROCESSED','FAILED')
          THEN "status"
        ELSE 'PENDING'
      END
    )::"DocumentStatus",
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "DenialCase"
  ALTER COLUMN "source" DROP DEFAULT,
  ALTER COLUMN "source" TYPE "DenialCaseSource"
    USING (
      CASE
        WHEN "source" IN ('MANUAL','PAYER_STATUS','SIMULATED_PAYER_STATUS')
          THEN "source"
        ELSE 'MANUAL'
      END
    )::"DenialCaseSource",
  ALTER COLUMN "source" SET DEFAULT 'MANUAL',
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "DenialCaseStatus"
    USING (
      CASE
        WHEN "status" IN ('OPEN','ANALYZED','CORRECTION_REQUIRED','APPEAL_PREPARED','APPEAL_SUBMITTED','RESUBMITTED','OVERTURNED','UPHELD','CLOSED')
          THEN "status"
        ELSE 'OPEN'
      END
    )::"DenialCaseStatus",
  ALTER COLUMN "status" SET DEFAULT 'OPEN';
