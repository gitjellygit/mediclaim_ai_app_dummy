-- H8B-2: replace reusable plaintext refresh tokens with revocable session records.
-- Existing refresh sessions are intentionally invalidated during deployment so
-- users re-authenticate under the hardened cookie/rotation model.

DELETE FROM "RefreshToken";

DROP INDEX IF EXISTS "RefreshToken_token_key";
DROP INDEX IF EXISTS "RefreshToken_token_idx";

ALTER TABLE "RefreshToken"
  DROP COLUMN "token",
  ADD COLUMN "tokenHash" TEXT NOT NULL,
  ADD COLUMN "sessionId" TEXT NOT NULL,
  ADD COLUMN "lastUsedAt" TIMESTAMP(3),
  ADD COLUMN "userAgent" TEXT,
  ADD COLUMN "ipAddress" TEXT;

CREATE UNIQUE INDEX "RefreshToken_tokenHash_key"
  ON "RefreshToken"("tokenHash");

CREATE INDEX "RefreshToken_sessionId_idx"
  ON "RefreshToken"("sessionId");

CREATE INDEX "RefreshToken_userId_sessionId_idx"
  ON "RefreshToken"("userId", "sessionId");
