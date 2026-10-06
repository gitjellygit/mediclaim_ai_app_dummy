import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { resolveStoredDocument } from "./storedDocumentPath.js";

const S3_PREFIX = "s3://";

function configuredBackend() {
  return String(process.env.DOCUMENT_STORAGE_BACKEND || "local").trim().toLowerCase();
}

function s3Config() {
  return {
    region: String(process.env.AWS_REGION || "").trim(),
    bucket: String(process.env.DOCUMENT_S3_BUCKET || "").trim(),
    kmsKeyId: String(process.env.DOCUMENT_S3_KMS_KEY_ID || "").trim()
  };
}

function createS3Client() {
  const { region } = s3Config();
  return new S3Client({ region });
}

export function documentStorageBackend() {
  const backend = configuredBackend();
  if (!["local", "s3"].includes(backend)) {
    throw new Error("DOCUMENT_STORAGE_BACKEND must be local or s3");
  }
  return backend;
}

export function assertDocumentStorageConfiguration() {
  const backend = documentStorageBackend();
  if (process.env.NODE_ENV === "production" && backend !== "s3") {
    throw new Error("Production requires DOCUMENT_STORAGE_BACKEND=s3");
  }

  if (backend === "s3") {
    const { region, bucket } = s3Config();
    if (!region) throw new Error("AWS_REGION is required for S3 document storage");
    if (!bucket) throw new Error("DOCUMENT_S3_BUCKET is required for S3 document storage");
  }
}

function sanitizeSegment(value, fallback) {
  const safe = String(value || "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
  return safe || fallback;
}

function s3Location(key, bucket = s3Config().bucket) {
  return `${S3_PREFIX}${bucket}/${key}`;
}

export function storageKindForPath(storedPath) {
  return typeof storedPath === "string" && storedPath.startsWith(S3_PREFIX)
    ? "s3"
    : "local";
}

function parseS3Location(storedPath) {
  if (storageKindForPath(storedPath) !== "s3") return null;
  const withoutScheme = storedPath.slice(S3_PREFIX.length);
  const slash = withoutScheme.indexOf("/");
  if (slash <= 0 || slash === withoutScheme.length - 1) return null;
  return {
    bucket: withoutScheme.slice(0, slash),
    key: withoutScheme.slice(slash + 1)
  };
}

export async function persistUploadedDocument(
  file,
  { organizationId, claimId, uploadDir = process.env.UPLOAD_DIR || "uploads" } = {}
) {
  if (!file?.path) throw new Error("Uploaded file path is required");

  const backend = documentStorageBackend();
  if (backend === "local") {
    const localPath = resolveStoredDocument(file.filename || file.path, uploadDir);
    if (!localPath) throw new Error("Invalid local upload path");
    return file.filename || path.basename(localPath);
  }

  const { region, bucket, kmsKeyId } = s3Config();
  if (!region || !bucket) throw new Error("S3 document storage is not configured");

  const extension = path.extname(file.originalname || "").toLowerCase();
  const key = [
    sanitizeSegment(organizationId, "org"),
    sanitizeSegment(claimId, "claim"),
    `${randomUUID()}${extension}`
  ].join("/");

  const put = {
    Bucket: bucket,
    Key: key,
    Body: fs.createReadStream(file.path),
    ContentType: file.mimetype || "application/octet-stream",
    ServerSideEncryption: kmsKeyId ? "aws:kms" : "AES256"
  };
  if (kmsKeyId) put.SSEKMSKeyId = kmsKeyId;

  await createS3Client().send(new PutObjectCommand(put));

  try {
    fs.unlinkSync(file.path);
  } catch (error) {
    console.error("[document-storage] temporary upload cleanup failed", {
      code: error?.code || null
    });
  }

  return s3Location(key, bucket);
}

export async function openStoredDocument(
  storedPath,
  { uploadDir = process.env.UPLOAD_DIR || "uploads" } = {}
) {
  if (storageKindForPath(storedPath) === "local") {
    const filePath = resolveStoredDocument(storedPath, uploadDir);
    if (!filePath || !fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    return {
      stream: fs.createReadStream(filePath),
      sizeBytes: stat.size,
      backend: "local"
    };
  }

  const location = parseS3Location(storedPath);
  if (!location) return null;

  try {
    const result = await createS3Client().send(
      new GetObjectCommand({
        Bucket: location.bucket,
        Key: location.key
      })
    );
    if (!result.Body) return null;
    return {
      stream: result.Body,
      sizeBytes: result.ContentLength ?? null,
      contentType: result.ContentType || null,
      backend: "s3"
    };
  } catch (error) {
    if (["NoSuchKey", "NotFound"].includes(error?.name) || error?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

export async function deleteStoredObject(
  storedPath,
  { uploadDir = process.env.UPLOAD_DIR || "uploads" } = {}
) {
  if (!storedPath) return { deleted: false, backend: null };

  if (storageKindForPath(storedPath) === "local") {
    const filePath = resolveStoredDocument(storedPath, uploadDir);
    if (!filePath || !fs.existsSync(filePath)) {
      return { deleted: false, backend: "local" };
    }
    fs.unlinkSync(filePath);
    return { deleted: true, backend: "local" };
  }

  const location = parseS3Location(storedPath);
  if (!location) return { deleted: false, backend: "s3" };

  await createS3Client().send(
    new DeleteObjectCommand({
      Bucket: location.bucket,
      Key: location.key
    })
  );
  return { deleted: true, backend: "s3" };
}

export async function materializeStoredDocument(
  storedPath,
  { uploadDir = process.env.UPLOAD_DIR || "uploads" } = {}
) {
  if (storageKindForPath(storedPath) === "local") {
    const filePath = resolveStoredDocument(storedPath, uploadDir);
    if (!filePath || !fs.existsSync(filePath)) return null;
    return { path: filePath, cleanup: async () => {} };
  }

  const opened = await openStoredDocument(storedPath, { uploadDir });
  if (!opened) return null;

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "claim-doc-"));
  const tempPath = path.join(tempDir, randomUUID());
  try {
    await pipeline(opened.stream, fs.createWriteStream(tempPath));
  } catch (error) {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  return {
    path: tempPath,
    cleanup: async () => {
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        console.error("[document-storage] materialized file cleanup failed", {
          code: error?.code || null
        });
      }
    }
  };
}
