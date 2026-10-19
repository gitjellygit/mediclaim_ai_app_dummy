import test from "node:test";
import assert from "node:assert/strict";
import { publicDocument } from "../src/services/documentPublicView.js";

test("document public view strips storage, OCR, hash, and nested claim data", () => {
  const result = publicDocument({
    id: "doc-1",
    fileName: "eob.pdf",
    type: "EOB",
    path: "/private/storage/eob.pdf",
    rawText: "full OCR text",
    fileHash: "secret-hash",
    claim: {
      id: "claim-1",
      patientName: "Private Patient",
      memberId: "MEM-SECRET"
    }
  });

  assert.deepEqual(result, {
    id: "doc-1",
    fileName: "eob.pdf",
    type: "EOB"
  });
  assert.equal("claim" in result, false);
  assert.equal("path" in result, false);
  assert.equal("rawText" in result, false);
  assert.equal("fileHash" in result, false);
});
