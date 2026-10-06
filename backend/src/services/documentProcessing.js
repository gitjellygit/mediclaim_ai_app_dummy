import { analyzeDocument, getFileHash } from "./docIntel.js";

function processingError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export async function inspectUploadedDocument(file) {
  if (!file?.path) {
    throw processingError("Uploaded file is missing", 400, "UPLOAD_FILE_MISSING");
  }

  const fileHash = getFileHash(file.path);
  const intel = await analyzeDocument({
    fileName: file.originalname,
    mimeType: file.mimetype,
    path: file.path
  });

  if (intel.ocrStatus === "FAILED") {
    throw processingError(
      "Text extraction failed. Retry this upload later.",
      503,
      "OCR_UNAVAILABLE"
    );
  }

  return {
    fileHash,
    intel,
    extracted: intel.extracted || {}
  };
}

export async function findDuplicateDocument(prisma, claimId, fileHash) {
  if (!claimId || !fileHash) return null;
  return prisma.document.findFirst({
    where: { claimId, fileHash },
    select: { id: true }
  });
}

export function documentCreateData({
  claimId,
  file,
  fileHash,
  intel,
  type = null
}) {
  return {
    claimId,
    type: type || intel.suggestedType || "OTHER",
    fileName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    path: file.storagePath || file.filename,
    fileHash,
    suggestedType: intel.suggestedType || null,
    confidence: intel.confidence ?? null,
    extracted: intel.extracted || {},
    rawText: intel.rawExtractedText || null,
    ocrProvider: intel.ocrProvider || intel.extractionSource || null,
    status: "PROCESSED"
  };
}
