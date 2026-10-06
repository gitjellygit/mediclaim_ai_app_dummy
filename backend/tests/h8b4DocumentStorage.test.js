import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDocumentStorageConfiguration,
  deleteStoredObject,
  materializeStoredDocument,
  openStoredDocument,
  persistUploadedDocument,
  storageKindForPath
} from "../src/services/documentStorage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function withEnv(values, fn) {
  const before = {};
  for (const [key, value] of Object.entries(values)) {
    before[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(before)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test("H8B-4 - production refuses local document storage", { concurrency: false }, async () => {
  await withEnv(
    {
      NODE_ENV: "production",
      DOCUMENT_STORAGE_BACKEND: "local",
      DOCUMENT_S3_BUCKET: null
    },
    () => {
      assert.throws(
        () => assertDocumentStorageConfiguration(),
        /Production requires DOCUMENT_STORAGE_BACKEND=s3/
      );
    }
  );
});

test("H8B-4 - S3 storage requires region and bucket", { concurrency: false }, async () => {
  await withEnv(
    {
      NODE_ENV: "test",
      DOCUMENT_STORAGE_BACKEND: "s3",
      AWS_REGION: null,
      DOCUMENT_S3_BUCKET: null
    },
    () => {
      assert.throws(
        () => assertDocumentStorageConfiguration(),
        /AWS_REGION is required/
      );
    }
  );

  await withEnv(
    {
      NODE_ENV: "test",
      DOCUMENT_STORAGE_BACKEND: "s3",
      AWS_REGION: "us-east-1",
      DOCUMENT_S3_BUCKET: null
    },
    () => {
      assert.throws(
        () => assertDocumentStorageConfiguration(),
        /DOCUMENT_S3_BUCKET is required/
      );
    }
  );
});

test("H8B-4 - local storage remains supported for dev/test", { concurrency: false }, async () => {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "claim-h8b4-"));
  const filename = "test-document.pdf";
  const filePath = path.join(uploadDir, filename);
  fs.writeFileSync(filePath, "%PDF-test");

  try {
    await withEnv(
      {
        NODE_ENV: "test",
        DOCUMENT_STORAGE_BACKEND: "local"
      },
      async () => {
        const storedPath = await persistUploadedDocument(
          {
            path: filePath,
            filename,
            originalname: "Patient Document.pdf",
            mimetype: "application/pdf"
          },
          {
            organizationId: "org-1",
            claimId: "claim-1",
            uploadDir
          }
        );

        assert.equal(storedPath, filename);
        assert.equal(storageKindForPath(storedPath), "local");

        const opened = await openStoredDocument(storedPath, { uploadDir });
        assert.ok(opened);
        assert.equal(opened.backend, "local");
        let bytesRead = 0;
        for await (const chunk of opened.stream) {
          bytesRead += chunk.length;
        }
        assert.ok(bytesRead > 0);

        const materialized = await materializeStoredDocument(storedPath, {
          uploadDir
        });
        assert.equal(materialized.path, filePath);
        await materialized.cleanup();

        const deleted = await deleteStoredObject(storedPath, { uploadDir });
        assert.equal(deleted.deleted, true);
        assert.equal(fs.existsSync(filePath), false);
      }
    );
  } finally {
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
});

test("H8B-4 - S3 locations are explicit and not treated as filesystem paths", () => {
  assert.equal(
    storageKindForPath("s3://private-claims/org/claim/document.pdf"),
    "s3"
  );
  assert.equal(storageKindForPath("legacy-file.pdf"), "local");
});

test("H8B-4 - object uploads use server-side encryption and private authenticated delivery", () => {
  const storage = read("backend/src/services/documentStorage.js");
  const response = read("backend/src/services/documentResponse.js");
  const index = read("backend/src/index.js");

  assert.match(storage, /PutObjectCommand/);
  assert.match(storage, /ServerSideEncryption: kmsKeyId \? "aws:kms" : "AES256"/);
  assert.match(storage, /SSEKMSKeyId/);
  assert.doesNotMatch(storage, /ACL:\s*"public-read"/);

  assert.match(response, /openStoredDocument/);
  assert.match(response, /Cache-Control", "private, no-store/);
  assert.match(response, /Content-Security-Policy", "sandbox"/);
  assert.doesNotMatch(response, /sendFile\(/);

  assert.match(index, /assertDocumentStorageConfiguration\(\)/);
});

test("H8B-4 - upload reprocess delete and purge use storage abstraction", () => {
  const documents = read("backend/src/routes/documents.js");
  const deletion = read("backend/src/services/documentDeletion.js");
  const purge = read("backend/src/services/claimPurge.js");

  assert.match(documents, /persistUploadedDocument/);
  assert.match(documents, /materializeStoredDocument/);
  assert.match(documents, /deleteStoredObject/);
  assert.doesNotMatch(documents, /metadata:\s*\{[^}]*fileName:\s*doc\.fileName/);

  assert.match(deletion, /deleteStoredObject/);
  assert.doesNotMatch(deletion, /metadata:\s*\{[^}]*fileName:\s*doc\.fileName/);
  assert.match(purge, /deleteStoredObject/);
});
