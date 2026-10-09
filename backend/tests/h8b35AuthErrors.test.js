import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("H8B-3.5A - locked claim edit preserves typed 409 errors", () => {
  const claims = read("backend/src/routes/claims.js");
  const patchStart = claims.indexOf('router.patch("/:id"');
  const patchEnd = claims.indexOf('router.delete("/:id/purge"', patchStart);
  const patch = claims.slice(patchStart, patchEnd);
  assert.match(patch, /assertClaimEditable/);
  assert.match(patch, /catch \(e\)[\s\S]*if \(e\?\.status\) throw e/);
});

test("H8B-3.5A - journey and payer handlers preserve typed errors", () => {
  const journey = read("backend/src/routes/claimJourney.js");
  const payer = read("backend/src/routes/claimPayerSimulation.js");
  assert.match(journey, /catch \(error\) \{\n\s*if \(error\?\.status\) throw error;/);
  assert.match(payer, /catch \(error\) \{\n\s*if \(error\?\.status\) throw error;/);
});

test("H8B-3.5A - documented JWT placeholder is rejected outside test", () => {
  const index = read("backend/src/index.js");
  assert.match(index, /INSECURE_JWT_SECRETS/);
  assert.match(index, /replace-this-with-a-unique-secret-of-at-least-32-characters/);
  assert.match(index, /process\.env\.NODE_ENV !== "test"/);
});

test("H8B-3.5A - reset-lockout is tenant-scoped", () => {
  const auth = read("backend/src/routes/auth.js");
  const start = auth.indexOf('"/reset-lockout"');
  const block = auth.slice(start, start + 2500);
  assert.match(block, /findFirst/);
  assert.match(block, /organizationId:\s*req\.user\.organizationId/);
});

test("H8B-3.5A - refresh token reuse revokes the entire session", () => {
  const auth = read("backend/src/routes/auth.js");
  const start = auth.indexOf('if (tokenRecord.revoked)');
  const block = auth.slice(start, start + 900);
  assert.match(block, /revokeSession/);
  assert.match(block, /REFRESH_REUSE_DETECTED/);

  const rotation = auth.indexOf('if (!rotated)');
  const rotationBlock = auth.slice(rotation, rotation + 900);
  assert.match(rotationBlock, /revokeSession/);
  assert.match(rotationBlock, /REFRESH_REUSE_DETECTED/);
});


test("auth throttling is shared through Postgres and does not persist raw identifiers", () => {
  const schema = read("backend/prisma/schema.prisma");
  const auth = read("backend/src/routes/auth.js");
  const limiter = read("backend/src/services/authRateLimit.js");

  assert.match(schema, /model AuthRateLimit/);
  assert.match(auth, /checkAuthRateLimit/);
  assert.match(auth, /recordAuthFailure/);
  assert.match(auth, /login-email:/);
  assert.match(auth, /login-ip:/);
  assert.match(auth, /createHash\("sha256"\)/);
  assert.doesNotMatch(auth, /checkRateLimit\(/);
  assert.match(limiter, /prisma\.authRateLimit\.findUnique/);
  assert.match(limiter, /authRateLimit\.upsert/);
});
