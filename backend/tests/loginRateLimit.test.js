import test from "node:test";
import assert from "node:assert/strict";
import {
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit
} from "../src/utils/security.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("B10 - successful login checks do not consume failed-attempt allowance", () => {
  const key = "login:b10-unittest@hospital.local";
  clearRateLimit(key);
  try {
    for (let i = 0; i < 8; i++) {
      const limit = checkRateLimit(key, 5);
      assert.equal(limit.allowed, true);
      assert.equal(limit.remaining, 5);
    }
    recordFailedAttempt(key);
    assert.equal(checkRateLimit(key, 5).remaining, 4);
    clearRateLimit(key);
    assert.equal(checkRateLimit(key, 5).remaining, 5);
  } finally {
    clearRateLimit(key);
  }
});

test("B10 - login rate-limit check and recording use the same normalized email", () => {
  const source = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/routes/auth.js"),
    "utf8"
  );
  assert.match(source, /checkRateLimit\(rateKey, MAX_FAILED_ATTEMPTS\)/);
  assert.match(source, /const emailKey = String\(email\)\.toLowerCase\(\)\.trim\(\)/);
  assert.match(source, /const rateKey = `login:\$\{emailKey\}`/);
  assert.match(source, /recordFailedAttempt\(rateKey\)/);
  assert.match(source, /clearRateLimit\(rateKey\)/);
});
