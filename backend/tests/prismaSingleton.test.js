import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma, disconnectDatabase } from "../src/db.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("B6 - backend runtime uses one PrismaClient owner and disconnect hook", () => {
  const db = fs.readFileSync(path.join(backendRoot, "src/db.js"), "utf8");
  assert.equal((db.match(/new PrismaClient\s*\(/g) || []).length, 1);
  assert.match(db, /export const prisma/);
  assert.equal(typeof disconnectDatabase, "function");
  assert.ok(prisma);

  const runtimeFiles = [
    "src/index.js",
    "src/routes/claims.js",
    "src/routes/denials.js",
    "src/routes/rules.js",
    "src/routes/documents.js"
  ];
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(path.join(backendRoot, file), "utf8");
    assert.doesNotMatch(source, /new PrismaClient\s*\(/, `${file} must reuse shared client`);
  }

  const entry = fs.readFileSync(path.join(backendRoot, "src/index.js"), "utf8");
  assert.match(entry, /import \{ prisma, disconnectDatabase \} from "\.\/db\.js"/);
  assert.match(entry, /process\.once\("SIGTERM", async \(\) => \{ await disconnectDatabase\(\)/);
  assert.match(entry, /process\.once\("SIGINT", async \(\) => \{ await disconnectDatabase\(\)/);
});
