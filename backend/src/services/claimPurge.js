import { deleteStoredObject } from "./documentStorage.js";

export function resolveClaimDocumentFiles(documents = []) {
  return documents
    .map((doc) => ({ id: doc.id, path: doc.path }))
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
