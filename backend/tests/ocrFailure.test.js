import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDocument } from "../src/services/docIntel.js";

test("B12 - provider failure without fallback text is explicit and logs no OCR/exception content", async () => {
  const original = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const analysis = await analyzeDocument(
      { fileName: "scan.pdf", mimeType: "application/pdf", path: "/not/read/by/fakes" },
      {
        ocrExtractor: async () => { throw new Error("SENSITIVE_DOCUMENT_TEXT"); },
        pdfExtractor: async () => ""
      }
    );
    assert.equal(analysis.ocrStatus, "FAILED");
    assert.equal(analysis.ocrProvider, "AWS_TEXTRACT_FAILED");
    assert.equal(analysis.rawExtractedText, "");
    assert.doesNotMatch(JSON.stringify(logs), /SENSITIVE_DOCUMENT_TEXT/);
  } finally {
    console.error = original;
  }
});

test("B12 - readable PDF fallback recovers from a failed OCR provider", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const analysis = await analyzeDocument(
      { fileName: "scan.pdf", mimeType: "application/pdf", path: "/not/read/by/fakes" },
      {
        ocrExtractor: async () => { throw new Error("upstream unavailable"); },
        pdfExtractor: async () => "Patient Name: Example Person. Final bill total amount 350."
      }
    );
    assert.equal(analysis.ocrStatus, "PROCESSED");
    assert.equal(analysis.ocrProvider, "PDF_PARSE");
  } finally {
    console.error = original;
  }
});

test("B12 - synchronous OCR wait is capped and API does not treat OCR outage as a completed document", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
  const service = fs.readFileSync(path.join(root, "services/docIntel.js"), "utf8");
  const routes = fs.readFileSync(path.join(root, "routes/documents.js"), "utf8");
  const processing = fs.readFileSync(
    path.join(root, "services/documentProcessing.js"),
    "utf8"
  );
  assert.match(service, /OCR_SYNC_WAIT_MS/);
  assert.match(service, /Math\.min\(30, Math\.ceil/);
  assert.match(processing, /intel\.ocrStatus === "FAILED"/);
  assert.match(processing, /code = "OCR_UNAVAILABLE"/);
  assert.match(routes, /inspectUploadedDocument\(req\.file\)/);
  assert.match(routes, /analysis\.ocrStatus === "FAILED"/);
  assert.match(routes, /status: "FAILED"/);
});
