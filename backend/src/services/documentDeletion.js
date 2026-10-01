import fs from "node:fs";
import { recomputeDerivedClaimPatch } from "./claimDocumentProvenance.js";
import { removeProvenanceFields } from "./claimFieldProvenance.js";
import { resolveStoredDocument } from "./storedDocumentPath.js";

/** One deletion implementation shared by the current and legacy document APIs. */
export async function deleteStoredDocument(prisma, req, res, {
  legacy = false,
  uploadDir = process.env.UPLOAD_DIR || "uploads"
} = {}) {
  try {
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, claim: { organizationId: req.user.organizationId, deletedAt: null } },
      include: { claim: true }
    });
    if (!doc) return res.status(404).json({ error: "Document not found" });

    if (doc.claim?.status === "SUBMITTED" || doc.claim?.claimSubmissionDate) {
      return res.status(409).json({
        error: "Submitted claims are locked. Documents cannot be deleted."
      });
    }

    const remainingDocuments = await prisma.document.findMany({
      where: { claimId: doc.claimId, id: { not: doc.id } },
      orderBy: { createdAt: "desc" }
    });
    const derivedPatch = recomputeDerivedClaimPatch(
      remainingDocuments,
      doc.claim?.documentDerivedFields || []
    );
    const recomputedFields = Object.keys(derivedPatch);
    const fieldProvenance = removeProvenanceFields(
      doc.claim?.fieldProvenance,
      recomputedFields
    );

    await prisma.$transaction([
      prisma.document.delete({ where: { id: doc.id } }),
      prisma.check.updateMany({
        where: { claimId: doc.claimId, isStale: false },
        data: {
          isStale: true,
          staleAt: new Date(),
          staleReason: "Supporting document deleted"
        }
      }),
      prisma.claim.update({
        where: { id: doc.claimId },
        data: { ...derivedPatch, fieldProvenance, status: "DRAFT" }
      })
    ]);

    // Never use a database-stored path directly for filesystem operations.
    const filePath = resolveStoredDocument(doc.path, uploadDir);
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        console.error("[documents] file cleanup failed", {
          claimId: doc.claimId,
          documentId: doc.id,
          code: error?.code || null
        });
      }
    }

    return res.json({
      [legacy ? "success" : "ok"]: true,
      remainingDocuments: remainingDocuments.length,
      recomputedFields
    });
  } catch (error) {
    console.error("[documents] deletion failed", {
      documentId: req.params.id,
      code: error?.code || null,
      name: error?.name || "Error"
    });
    return res.status(500).json({
      error: legacy ? "Document deletion failed" : "Failed to delete document"
    });
  }
}
