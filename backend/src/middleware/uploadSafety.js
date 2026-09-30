import fs from "node:fs";
import path from "node:path";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const TYPES = new Map([
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"]
]);

export function uploadFileFilter(_req, file, callback) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  const expected = TYPES.get(extension);
  if (!expected || file.mimetype !== expected) {
    const error = new Error("Unsupported file type");
    error.code = "INVALID_UPLOAD_TYPE";
    return callback(error);
  }
  callback(null, true);
}

export function detectValidUpload(filePath, fileName) {
  const extension = path.extname(fileName || "").toLowerCase();
  if (!TYPES.has(extension)) return false;
  const fd = fs.openSync(filePath, "r");
  let header;
  try {
    header = Buffer.alloc(8);
    fs.readSync(fd, header, 0, header.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (extension === ".pdf") return header.subarray(0, 5).toString("ascii") === "%PDF-";
  if (extension === ".png") return header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if ([".jpg", ".jpeg"].includes(extension)) return header.subarray(0, 3).equals(Buffer.from([255,216,255]));
  return header.subarray(0, 4).equals(Buffer.from([73,73,42,0])) ||
    header.subarray(0, 4).equals(Buffer.from([77,77,0,42]));
}

// Multer has already persisted a temporary file here. Reject misleading
// extensions/mimetype declarations *before* any document parsing or DB write.
export function verifyUploadSignature(req, res, next) {
  if (!req.file) return next();
  try {
    if (detectValidUpload(req.file.path, req.file.originalname)) return next();
  } catch (error) {
    console.error("[upload] signature validation failed", { name: error.name });
  }
  try { fs.unlinkSync(req.file.path); } catch { /* best effort */ }
  return res.status(415).json({
    error: "Unsupported file",
    message: "File content does not match PDF, PNG, JPEG, or TIFF",
    code: "INVALID_UPLOAD_SIGNATURE"
  });
}
