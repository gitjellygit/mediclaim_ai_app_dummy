-- Existing globally unique hash prevented identical files on separate patient
-- claims. Keep deduplication within one claim instead. PostgreSQL allows
-- multiple NULL hash values, matching the previous optional field semantics.
DROP INDEX IF EXISTS "Document_fileHash_key";
CREATE UNIQUE INDEX "Document_claimId_fileHash_key"
ON "Document"("claimId", "fileHash");
