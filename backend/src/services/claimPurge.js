import fs from "node:fs";
import { resolveStoredDocument } from "./storedDocumentPath.js";

export function resolveClaimDocumentFiles(documents = [], uploadDir = process.env.UPLOAD_DIR || "uploads") {
  return documents
    .map((doc) => ({
      id: doc.id,
      path: resolveStoredDocument(doc.path, uploadDir)
    }))
    .filter((item) => Boolean(item.path));
}

export function deletePurgedClaimFiles(files = []) {
  const failures = [];
  let deleted = 0;

  for (const file of files) {
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
        deleted += 1;
      }
    } catch (error) {
      failures.push({
        documentId: file.id,
        code: error?.code || "FILE_DELETE_FAILED"
      });
    }
  }

  return { deleted, failures };
}
