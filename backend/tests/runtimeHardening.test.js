import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(backendRoot, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("runtime hardening - Helmet and production HSTS are enabled", () => {
  const pkg = JSON.parse(read("backend/package.json"));
  const index = read("backend/src/index.js");

  assert.equal(pkg.dependencies.helmet, "^8.1.0");
  assert.match(index, /import helmet from "helmet"/);
  assert.match(index, /strictTransportSecurity/);
  assert.match(index, /31_536_000/);
});

test("runtime hardening - API and expensive operations are separately rate limited", () => {
  const index = read("backend/src/index.js");
  const limiter = read("backend/src/middleware/rateLimit.js");

  assert.match(index, /app\.use\("\/api", apiRateLimit\)/);
  assert.match(index, /app\.use\("\/api", expensiveOperationRateLimit\)/);
  assert.ok(limiter.includes('/^\\/documents\\/(upload|smart-upload)(?:\\/|$)/'));
  assert.ok(limiter.includes('/^\\/claims\\/[^/]+\\/submit(?:\\/|$)/'));
  assert.ok(limiter.includes('/^\\/claims\\/[^/]+\\/check(?:\\/|$)/'));
  assert.match(limiter, /status\(429\)/);
});

test("runtime hardening - readiness checks database while liveness stays process-only", () => {
  const index = read("backend/src/index.js");

  assert.match(index, /app\.get\("\/health\/live"/);
  assert.match(index, /app\.get\("\/health\/ready"/);
  assert.match(index, /prisma\.\$queryRawUnsafe\("SELECT 1"\)/);
  assert.match(index, /status\(503\).*not_ready/s);
});

test("runtime hardening - HTTP drains before Prisma disconnect", () => {
  const index = read("backend/src/index.js");
  const closeIndex = index.indexOf("server.close(");
  const disconnectIndex = index.indexOf("await disconnectDatabase()", closeIndex);

  assert.ok(closeIndex >= 0);
  assert.ok(disconnectIndex > closeIndex);
  assert.match(index, /closeIdleConnections/);
  assert.match(index, /closeAllConnections/);
});

test("runtime hardening - production Docker image is non-root and health checked", () => {
  const dockerfile = read("Dockerfile");

  assert.match(dockerfile, /FROM node:22-bookworm-slim/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /health\/ready/);
  assert.match(dockerfile, /prisma migrate deploy/);
});
