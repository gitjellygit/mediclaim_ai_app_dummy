import test from "node:test";
import assert from "node:assert/strict";
import { documentCreateData } from "../src/services/documentProcessing.js";

test("P3 - shared persistence keeps OCR text, provider, hash and classification", () => {
  const data = documentCreateData({
    claimId: "claim-1",
    file: {
      originalname: "bill.pdf",
      mimetype: "application/pdf",
      size: 1234,
      filename: "stored-bill.pdf"
    },
    fileHash: "abc123",
    intel: {
      suggestedType: "FINAL_BILL",
      confidence: 97,
      extracted: { amount: 100 },
      rawExtractedText: "sample OCR text",
      ocrProvider: "TEST_OCR"
    }
  });

  assert.equal(data.claimId, "claim-1");
  assert.equal(data.type, "FINAL_BILL");
  assert.equal(data.fileHash, "abc123");
  assert.equal(data.rawText, "sample OCR text");
  assert.equal(data.ocrProvider, "TEST_OCR");
  assert.equal(data.status, "PROCESSED");
});

test("P3 - explicit manual document type wins without dropping AI suggestion", () => {
  const data = documentCreateData({
    claimId: "claim-1",
    file: {
      originalname: "note.pdf",
      mimetype: "application/pdf",
      size: 100,
      filename: "stored-note.pdf"
    },
    fileHash: "hash",
    intel: {
      suggestedType: "PROGRESS_NOTE",
      confidence: 80,
      extracted: {}
    },
    type: "OPERATIVE_NOTE"
  });

  assert.equal(data.type, "OPERATIVE_NOTE");
  assert.equal(data.suggestedType, "PROGRESS_NOTE");
});
