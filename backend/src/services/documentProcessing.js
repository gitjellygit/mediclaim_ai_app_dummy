import { analyzeDocument, getFileHash } from "./docIntel.js";
import { EXTRACTION_ENGINE_VERSION } from "./extractionEngineV2.js";

function processingError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export async function inspectUploadedDocument(
  file,
  { prisma = null, organizationId = null } = {}
) {
  if (!file?.path) {
    throw processingError("Uploaded file is missing", 400, "UPLOAD_FILE_MISSING");
  }

  const fileHash = getFileHash(file.path);

  if (prisma && organizationId) {
    const cached = await prisma.extractionCache.findUnique({
      where: {
        organizationId_fileHash_engineVersion: {
          organizationId,
          fileHash,
          engineVersion: EXTRACTION_ENGINE_VERSION
        }
      }
    });
    if (cached?.result && typeof cached.result === "object") {
      return {
        fileHash,
        intel: {
          ...cached.result,
          extractionCacheHit: true
        },
        extracted: cached.result.extracted || {},
        cacheHit: true
      };
    }
  }

  const intel = await analyzeDocument({
    fileName: file.originalname,
    mimeType: file.mimetype,
    path: file.path
  });

  if (prisma && organizationId && intel?.ocrStatus !== "FAILED") {
    await prisma.extractionCache.upsert({
      where: {
        organizationId_fileHash_engineVersion: {
          organizationId,
          fileHash,
          engineVersion: EXTRACTION_ENGINE_VERSION
        }
      },
      create: {
        organizationId,
        fileHash,
        engineVersion: EXTRACTION_ENGINE_VERSION,
        result: intel,
        sourceProvider: intel.ocrProvider || intel.extractionSource || null
      },
      update: {
        result: intel,
        sourceProvider: intel.ocrProvider || intel.extractionSource || null
      }
    });
  }

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
  type = null,
  identityValidation = null
}) {
  const identityReview =
    identityValidation?.status === "REVIEW" ||
    identityValidation?.status === "UNVERIFIED"
      ? {
          status: identityValidation.status,
          conflicts: identityValidation.conflicts || [],
          matches: identityValidation.matches || [],
          tolerantMatches: identityValidation.tolerantMatches || [],
          warnings: identityValidation.warnings || [],
          reviewed: false,
          reviewedAt: null
        }
      : null;

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
    extracted: {
      ...(intel.extracted || {}),
      ...(identityReview ? { _identityReview: identityReview } : {})
    },
    rawText: intel.rawExtractedText || null,
    ocrProvider: intel.ocrProvider || intel.extractionSource || null,
    status: "PROCESSED"
  };
}
