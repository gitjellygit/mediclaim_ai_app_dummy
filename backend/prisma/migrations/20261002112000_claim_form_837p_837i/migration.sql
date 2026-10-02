-- U4: distinguish professional (837P) and institutional (837I) claims.
-- Nullable for legacy rows; new UI claims explicitly select a form.

CREATE TYPE "ClaimForm" AS ENUM ('PROFESSIONAL', 'INSTITUTIONAL');

ALTER TABLE "Claim"
  ADD COLUMN "claimForm" "ClaimForm";
