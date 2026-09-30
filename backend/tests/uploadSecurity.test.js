import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDocumentUpload } from "../src/services/documentUpload.js";
import { MAX_UPLOAD_BYTES, detectValidUpload, verifyUploadSignature, uploadFileFilter } from "../src/middleware/uploadSafety.js";

test("B13 - same-name uploads always get unique, path-safe stored names", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claim-upload-"));
  try {
    const upload = createDocumentUpload(dir);
    assert.equal(upload.limits.fileSize, 15 * 1024 * 1024);
    assert.equal(upload.limits.files, 1);
    const name = (originalname) => new Promise((resolve, reject) => {
      upload.storage.getFilename({}, { originalname }, (error, stored) => error ? reject(error) : resolve(stored));
    });
    const names = await Promise.all(Array.from({ length: 40 }, () => name("../../sensitive report.pdf")));
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.every((stored) => /^[a-f0-9-]{36}_/.test(stored) && !stored.includes("/") && !stored.includes("\\")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("B13 - file filter rejects extensions or MIME mismatch, signature blocks spoofed content", () => {
  const filter = (originalname, mimetype) => new Promise((resolve) => {
    uploadFileFilter({}, { originalname, mimetype }, (error, accepted) => resolve({ error, accepted }));
  });
  return Promise.all([
    filter("discharge.pdf", "application/pdf"),
    filter("malware.exe", "application/pdf"),
    filter("spoofed.pdf", "image/png")
  ]).then(([valid, badExtension, mismatch]) => {
    assert.equal(valid.accepted, true);
    assert.equal(badExtension.error?.code, "INVALID_UPLOAD_TYPE");
    assert.equal(mismatch.error?.code, "INVALID_UPLOAD_TYPE");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claim-upload-"));
    const fake = path.join(dir, "spoofed.pdf");
    try {
      fs.writeFileSync(fake, Buffer.from("not actually a PDF"));
      assert.equal(detectValidUpload(fake, "spoofed.pdf"), false);
      let status;
      let body;
      verifyUploadSignature(
        { file: { path: fake, originalname: "spoofed.pdf" } },
        { status(code) { status = code; return this; }, json(value) { body = value; return this; } },
        () => assert.fail("invalid content should not proceed")
      );
      assert.equal(status, 415);
      assert.equal(body.code, "INVALID_UPLOAD_SIGNATURE");
      assert.equal(fs.existsSync(fake), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
