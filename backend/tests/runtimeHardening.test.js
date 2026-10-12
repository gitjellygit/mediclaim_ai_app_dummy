import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryRateLimiter } from "../src/middleware/rateLimit.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");
const repoRoot = path.resolve(backendRoot, "..");

test("runtime hardening - rate limiter returns 429 after configured threshold", () => {
  const middleware = createMemoryRateLimiter({ windowMs: 60_000, max: 2 });
  const req = { ip: "203.0.113.10", socket: {}, originalUrl: "/api/claims" };
  let statusCode = null;
  let payload = null;
  const res = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; }
  };
  let passed = 0;
  const next = () => { passed += 1; };

  middleware(req, res, next);
  middleware(req, res, next);
  middleware(req, res, next);

  assert.equal(passed, 2);
  assert.equal(statusCode, 429);
  assert.equal(payload.code, "RATE_LIMITED");
});

test("runtime hardening - server exposes liveness/readiness and closes HTTP before Prisma", () => {
  const source = fs.readFileSync(path.join(backendRoot, "src/index.js"), "utf8");
  assert.match(source, /helmet\(/);
  assert.match(source, /\/health\/live/);
  assert.match(source, /\/health\/ready/);
  assert.match(source, /prisma\.\$queryRaw/);
  assert.ok(source.indexOf("server.close(") < source.indexOf("await disconnectDatabase()"));
});

test("runtime hardening - production container runs as non-root and checks readiness", () => {
  const dockerfile = fs.readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /\/health\/ready/);
});
