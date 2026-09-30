import path from "node:path";

/**
 * Resolve both legacy relative paths (uploads/filename.pdf) and new basenames.
 * Never trust stored paths as filesystem paths; all requests stay in UPLOAD_DIR.
 */
export function resolveStoredDocument(storedPath, uploadDir = process.env.UPLOAD_DIR || "uploads") {
  if (!storedPath || typeof storedPath !== "string") return null;
  const root = path.resolve(uploadDir);
  const basename = path.basename(storedPath);
  if (!basename || basename === "." || basename === "..") return null;
  const resolved = path.resolve(root, basename);
  return resolved.startsWith(root + path.sep) ? resolved : null;
}

export function safeDownloadName(originalName) {
  return path.basename(String(originalName || "document"))
    .replace(/[\r\n"\\]/g, "_")
    .slice(0, 180) || "document";
}
