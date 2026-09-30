import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseClaimDate } from "../src/utils/claimDate.js";
import {
  MAX_UPLOAD_BYTES,
  uploadFileFilter,
  detectValidUpload,
  verifyUploadSignature
} from "../src/middleware/uploadSafety.js";
import { captureAsyncRouter } from "../src/middleware/asyncRouter.js";

test("Date parser rejects impossible ISO and US dates", () => {
  for (const value of ["02/31/2026", "2026-02-30", "13/01/2026", "2026-00-10", "banana"]) {
    assert.equal(parseClaimDate(value), null, value);
  }
  assert.equal(parseClaimDate("09/30/2026")?.toISOString(), "2026-09-30T00:00:00.000Z");
  assert.equal(parseClaimDate("2024-02-29")?.toISOString(), "2024-02-29T00:00:00.000Z");
});

test("Uploads have bounded size and extension + MIME allowlist", () => {
  assert.equal(MAX_UPLOAD_BYTES, 15 * 1024 * 1024);
  const decision = (file) => new Promise((resolve) => uploadFileFilter({}, file, (error, allowed) => resolve({ error, allowed })));
  return Promise.all([
    decision({ originalname: "safe.pdf", mimetype: "application/pdf" }),
    decision({ originalname: "script.pdf", mimetype: "application/javascript" }),
    decision({ originalname: "evil.exe", mimetype: "application/pdf" })
  ]).then(([allowed, wrongMime, wrongExtension]) => {
    assert.equal(allowed.allowed, true);
    assert.equal(wrongMime.error?.code, "INVALID_UPLOAD_TYPE");
    assert.equal(wrongExtension.error?.code, "INVALID_UPLOAD_TYPE");
  });
});

test("Upload signature validation rejects spoofed PDF content and removes uploaded file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claim-upload-test-"));
  try {
    const valid = path.join(dir, "valid.pdf");
    fs.writeFileSync(valid, "%PDF-1.7\\n%%EOF");
    assert.equal(detectValidUpload(valid, "test.pdf"), true);

    const forged = path.join(dir, "forged.pdf");
    fs.writeFileSync(forged, "<script>alert(1)</script>");
    let response;
    verifyUploadSignature(
      { file: { path: forged, originalname: "forged.pdf" } },
      { status(status) { response = { status }; return { json(payload) { response.payload = payload; } }; } },
      () => { throw new Error("Spoofed upload was accepted"); }
    );
    assert.equal(response.status, 415);
    assert.equal(response.payload.code, "INVALID_UPLOAD_SIGNATURE");
    assert.equal(fs.existsSync(forged), false);
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

test("Async wrapper forwards rejected route promises to error handler", async () => {
  const router = { stack: [{ route: { stack: [{ handle: async () => { throw new Error("sample service failure"); } }] } }] };
  captureAsyncRouter(router);
  const handler = router.stack[0].route.stack[0].handle;
  const error = await new Promise((resolve) => handler({}, {}, resolve));
  assert.equal(error.message, "sample service failure");
});
