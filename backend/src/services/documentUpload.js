import fs from "node:fs";
import multer from "multer";
import { MAX_UPLOAD_BYTES, uploadFileFilter } from "../middleware/uploadSafety.js";

/** One storage convention for the legacy claims route and document routes. */
export function createDocumentUpload(uploadDir = process.env.UPLOAD_DIR || "uploads") {
  fs.mkdirSync(uploadDir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      cb(null, `${Date.now()}_${safe}`);
    }
  });
  return multer({
    storage,
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    fileFilter: uploadFileFilter
  });
}
