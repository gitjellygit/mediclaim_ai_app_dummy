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

test("H8B-3.5B - service-line payload preserves OCR provenance and verification", () => {
  const editor = read("frontend/src/components/ServiceLinesEditor.jsx");
  const claims = read("backend/src/routes/claims.js");
  const schema = read("backend/src/validation/claimMutations.js");

  assert.match(editor, /sourceDocumentId/);
  assert.match(editor, /OCR suggestion — verify/);
  assert.match(editor, /Verify Line/);
  assert.match(editor, /verified: line\.source === "DOCUMENT_OCR"/);

  assert.match(schema, /source: z\.enum\(\["USER", "DOCUMENT_OCR"\]\)/);
  assert.match(schema, /sourceDocumentId/);
  assert.match(claims, /const source = line\.source === "DOCUMENT_OCR"/);
  assert.doesNotMatch(
    claims.slice(claims.indexOf("function normalizeServiceLines"), claims.indexOf("async function auditClaim")),
    /verified:\s*true,[\s\S]*source:\s*"USER",[\s\S]*sourceDocumentId:\s*null/
  );
});

test("H8B-3.5B - document create and dependent writes are transactional", () => {
  const docs = read("backend/src/routes/documents.js");

  assert.match(
    docs,
    /const doc = await prisma\.\$transaction\(async \(tx\) => \{[\s\S]*tx\.document\.create[\s\S]*syncDocumentCodingSuggestions\(tx/
  );
  assert.match(
    docs,
    /const \{ doc, updatedClaim \} = await prisma\.\$transaction\(async \(tx\) => \{[\s\S]*tx\.document\.create[\s\S]*invalidateClaimReadiness\(tx/
  );
});

test("H8B-3.5B - document date matching uses parseClaimDate consistently", () => {
  const docs = read("backend/src/routes/documents.js");
  const start = docs.indexOf("function calculateMatchScore");
  const end = docs.indexOf("async function auditDocumentEvent", start);
  const block = docs.slice(start, end);

  assert.match(block, /parseClaimDate\(docDate\)/);
  assert.match(block, /parseClaimDate\(existingClaim\.dateOfService\)/);
  assert.doesNotMatch(block, /new Date\(docDate\)/);
  assert.doesNotMatch(docs, /const __dirname/);
});
