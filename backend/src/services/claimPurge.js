import { deleteStoredObject, storageKindForPath } from "./documentStorage.js";
import { resolveStoredDocument } from "./storedDocumentPath.js";

export function resolveClaimDocumentFiles(
  documents = [],
  uploadDir = process.env.UPLOAD_DIR || "uploads"
) {
  return documents
    .map((doc) => ({
      id: doc.id,
      path:
        storageKindForPath(doc.path) === "s3"
          ? doc.path
          : resolveStoredDocument(doc.path, uploadDir)
    }))
    .filter((item) => Boolean(item.path));
}

export async function deletePurgedClaimFiles(
  files = [],
  { uploadDir = process.env.UPLOAD_DIR || "uploads" } = {}
) {
  const failures = [];
  let deleted = 0;

  for (const file of files) {
    try {
      const result = await deleteStoredObject(file.path, { uploadDir });
      if (result.deleted) deleted += 1;
    } catch (error) {
      failures.push({
        documentId: file.id,
        code: error?.code || "FILE_DELETE_FAILED"
      });
    }
  }

  return { deleted, failures };
}
