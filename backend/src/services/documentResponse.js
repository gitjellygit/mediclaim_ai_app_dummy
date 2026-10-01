import fs from "node:fs";
import { resolveStoredDocument, safeDownloadName } from "./storedDocumentPath.js";

/**
 * Shared authenticated document response for the current and legacy URLs.
 * Routers remain responsible for requiring authentication.
 */
export async function serveStoredDocument(prisma, req, res, {
  download = false,
  uploadDir = process.env.UPLOAD_DIR || "uploads"
} = {}) {
  const doc = await prisma.document.findFirst({
    where: { id: req.params.id, claim: { organizationId: req.user.organizationId } }
  });
  if (!doc) return res.status(404).json({ error: "Document not found" });

  const filePath = resolveStoredDocument(doc.path, uploadDir);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Document file not found" });
  }

  const fileName = safeDownloadName(doc.fileName);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (download) return res.download(filePath, fileName);

  res.type(doc.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
  return res.sendFile(filePath);
}
