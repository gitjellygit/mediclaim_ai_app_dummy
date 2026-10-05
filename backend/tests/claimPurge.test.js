import test from "node:test";
import assert from "node:assert/strict";
import { resolveClaimDocumentFiles } from "../src/services/claimPurge.js";

test("P4 - permanent purge resolves stored document names through upload storage", () => {
  const files = resolveClaimDocumentFiles(
    [
      { id: "doc-1", path: "stored-a.pdf" },
      { id: "doc-2", path: "../unsafe.pdf" }
    ],
    "/tmp/claim-purge-test"
  );

  assert.equal(files.length, 1);
  assert.equal(files[0].id, "doc-1");
  assert.match(files[0].path, /claim-purge-test/);
  assert.match(files[0].path, /stored-a\.pdf$/);
});
