import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("B7 - readiness and submission exceptions cannot return raw error messages", () => {
  const source = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/routes/claims.js"),
    "utf8"
  );
  assert.doesNotMatch(source, /res\.status\(400\)\.json\(\{ error: e\.message \}\)/);
  assert.match(source, /error: "Unable to check claim readiness", code: "CLAIM_READINESS_FAILED"/);
  assert.match(source, /error: "Unable to submit claim", code: "CLAIM_SUBMISSION_FAILED"/);
});
