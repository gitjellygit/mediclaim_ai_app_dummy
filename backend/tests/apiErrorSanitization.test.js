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
  assert.match(source, /e\?\.status \? e\.message : "Unable to check claim readiness"/);
  assert.match(source, /e\?\.code \|\| "CLAIM_READINESS_FAILED"/);
  assert.match(source, /e\?\.status \? e\.message : "Unable to submit claim"/);
  assert.match(source, /e\?\.code \|\| "CLAIM_SUBMISSION_FAILED"/);
});
