import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkAuthRateLimit,
  recordAuthFailure,
  clearAuthRateLimit
} from "../src/services/authRateLimit.js";

function fakePrisma() {
  const store = new Map();

  const authRateLimit = {
    async findUnique({ where: { key } }) {
      return store.get(key) || null;
    },
    async deleteMany({ where }) {
      const record = store.get(where.key);
      if (!record) return { count: 0 };
      if (where.resetAt?.lte && record.resetAt > where.resetAt.lte) {
        return { count: 0 };
      }
      store.delete(where.key);
      return { count: 1 };
    },
    async upsert({ where: { key }, create, update }) {
      const current = store.get(key);
      if (!current) {
        const created = { ...create, updatedAt: new Date() };
        store.set(key, created);
        return created;
      }
      const next = {
        ...current,
        count: current.count + Number(update.count?.increment || 0),
        updatedAt: new Date()
      };
      store.set(key, next);
      return next;
    }
  };

  return {
    authRateLimit,
    async $transaction(callback) {
      return callback({ authRateLimit });
    }
  };
}

test("B10 - shared login limiter tracks only failed attempts", async () => {
  const prisma = fakePrisma();
  const key = "login-email:test-hash";
  const initial = await checkAuthRateLimit(prisma, key, 5);
  assert.equal(initial.allowed, true);
  assert.equal(initial.remaining, 5);

  await recordAuthFailure(prisma, key);
  const afterFailure = await checkAuthRateLimit(prisma, key, 5);
  assert.equal(afterFailure.allowed, true);
  assert.equal(afterFailure.remaining, 4);

  await clearAuthRateLimit(prisma, key);
  const cleared = await checkAuthRateLimit(prisma, key, 5);
  assert.equal(cleared.remaining, 5);
});

test("B10 - login route uses shared hashed email and IP rate keys", () => {
  const source = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/routes/auth.js"),
    "utf8"
  );

  assert.match(source, /checkAuthRateLimit/);
  assert.match(source, /recordAuthFailure/);
  assert.match(source, /clearAuthRateLimit/);
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /login-email:/);
  assert.match(source, /login-ip:/);
  assert.doesNotMatch(source, /checkRateLimit\(/);
  assert.doesNotMatch(source, /recordFailedAttempt\(/);
});
