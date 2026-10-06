import { pipeline } from "node:stream/promises";
import { openStoredDocument } from "./documentStorage.js";
import { safeDownloadName } from "./storedDocumentPath.js";

/**
 * Shared authenticated document response for current and legacy URLs.
 * Routers remain responsible for requiring authentication and tenant scoping.
 */
export async function serveStoredDocument(prisma, req, res, {
  download = false,
  uploadDir = process.env.UPLOAD_DIR || "uploads"
} = {}) {
  const doc = await prisma.document.findFirst({
    where: {
      id: req.params.id,
      claim: { organizationId: req.user.organizationId, deletedAt: null }
    }
  });
  if (!doc) return res.status(404).json({ error: "Document not found" });

  const stored = await openStoredDocument(doc.path, { uploadDir });
  if (!stored) {
    return res.status(404).json({ error: "Document file not found" });
  }

  const fileName = safeDownloadName(doc.fileName);
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox");
  if (stored.sizeBytes != null) {
    res.setHeader("Content-Length", String(stored.sizeBytes));
  }

  res.type(doc.mimeType || stored.contentType || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${download ? "attachment" : "inline"}; filename="${fileName}"`
  );

  try {
    await pipeline(stored.stream, res);
    return res;
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ error: "Document delivery failed" });
    }
    throw error;
  }
}
