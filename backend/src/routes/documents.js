import express from "express";
import { requireRoles } from "../middleware/auth.js";
import multer from "multer";
import { MAX_UPLOAD_BYTES, uploadFileFilter, verifyUploadSignature } from "../middleware/uploadSafety.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  getDerivedFieldsFromDocument,
  mergeDerivedFields,
  recomputeDerivedClaimPatch
} from "../services/claimDocumentProvenance.js";
import {
  documentProvenance,
  mergeProvenance,
  removeProvenanceFields
} from "../services/claimFieldProvenance.js";
import { markReadinessChecksStale } from "../services/readinessHistory.js";
import { parseClaimDate } from "../utils/claimDate.js";
import { resolveStoredDocument } from "../services/storedDocumentPath.js";
import { serveStoredDocument } from "../services/documentResponse.js";
import { deleteStoredDocument } from "../services/documentDeletion.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function calculateMatchScore(extracted, existingClaim) {
  let score = 0;
  
  const memberId = extracted.memberId || null;
  const policyNo = extracted.policyNo || null;
  const dateOfBirth = extracted.dateOfBirth || null;
  const patientName = extracted.patientName || null;
  const dateOfService = extracted.dateOfService || null;
  const admissionDate = extracted.admissionDate || null;
  const dischargeDate = extracted.dischargeDate || null;
  const hospitalName = extracted.hospitalName || null;
  
  if (memberId && existingClaim.memberId && memberId === existingClaim.memberId) {
    score += 40;
  }
  
  if (policyNo && existingClaim.policyNo && policyNo === existingClaim.policyNo) {
    score += 35;
  }
  
  if (dateOfBirth && existingClaim.patientDob && dateOfBirth === existingClaim.patientDob) {
    score += 25;
  }
  
  if (patientName && existingClaim.patientName) {
    const normalizedName1 = patientName.toLowerCase().replace(/\s+/g, '');
    const normalizedName2 = existingClaim.patientName.toLowerCase().replace(/\s+/g, '');
    if (normalizedName1 === normalizedName2) {
      score += 10;
    }
  }
  
  const docDate = dateOfService || admissionDate;
  if (docDate && existingClaim.dateOfService) {
    const daysDiff = Math.abs(new Date(docDate) - new Date(existingClaim.dateOfService)) / (1000 * 60 * 60 * 24);
    if (daysDiff <= 3) {
      score += 15;
    } else if (daysDiff <= 7) {
      score += 10;
    }
  }
  
  if (hospitalName && existingClaim.hospitalName) {
    const normalizedHospital1 = hospitalName.toLowerCase().replace(/\s+/g, '');
    const normalizedHospital2 = existingClaim.hospitalName.toLowerCase().replace(/\s+/g, '');
    if (normalizedHospital1 === normalizedHospital2) {
      score += 5;
    }
  }
  
  return Math.min(100, score);
}

export function documentsRouter(prisma, uploadDir) {
  const router = express.Router();

  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const resolveStoredFile = (storedPath) => resolveStoredDocument(storedPath, uploadDir);

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      cb(null, `${Date.now()}_${safe}`);
    }
  });

  const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 }, fileFilter: uploadFileFilter });

  router.post("/smart-upload", upload.single("file"), verifyUploadSignature, async (req, res) => {
    let uploadedFilePath = null;
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: "file is required" });
      }

      uploadedFilePath = req.file.path;
      
      if (!fs.existsSync(uploadedFilePath)) {
        return res.status(400).json({ 
          error: "File not found",
          message: "Uploaded file could not be located on server"
        });
      }

      const { analyzeDocument, getFileHash } = await import("../services/docIntel.js");

      const fileHash = getFileHash(uploadedFilePath);

      const intel = await analyzeDocument({
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        path: uploadedFilePath
      });

      const extracted = intel.extracted || {};
      const patientName = extracted.patientName || "Unknown Patient";
      const parsedAmount = extracted.amount != null ? Number(extracted.amount) : null;
      const amount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : null;
      const payerName = extracted.payerName || "Insurance";

      let claim = null;
      let matchStatus = "NEW";
      let matchScore = 0;
      let candidateClaim = null;

      const recentClaims = await prisma.claim.findMany({
        where: {
          patientName: {
            equals: patientName,
            mode: "insensitive"
          },
          status: { in: ["DRAFT", "READY", "NEEDS_REVIEW"] }
        },
        orderBy: { createdAt: "desc" },
        take: 10
      });

      let bestMatch = null;
      let bestScore = 0;

      for (const existingClaim of recentClaims) {
        const score = calculateMatchScore(extracted, existingClaim);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = existingClaim;
        }
      }

      // Never merge an unidentified document into an "Unknown Patient"
      // claim, even when contextual dates or facility details look similar.
      // Automated merging requires positive identity corroboration.
      const hasReliableIdentity =
        Boolean(extracted.patientName && extracted.patientName.trim()) &&
        Boolean(
          (extracted.memberId && bestMatch?.memberId &&
            extracted.memberId === bestMatch.memberId) ||
          (extracted.policyNo && bestMatch?.policyNo &&
            extracted.policyNo === bestMatch.policyNo) ||
          (extracted.dateOfBirth && bestMatch?.patientDob &&
            !Number.isNaN(new Date(extracted.dateOfBirth).getTime()) &&
            new Date(extracted.dateOfBirth).toISOString().slice(0, 10) ===
              new Date(bestMatch.patientDob).toISOString().slice(0, 10))
        );
      if (bestMatch && bestScore >= 90 && hasReliableIdentity) {
        claim = bestMatch;
        matchStatus = "MERGED";
        matchScore = bestScore;
      } else if (bestMatch && bestScore >= 70) {
        candidateClaim = bestMatch;
        matchStatus = "REVIEW";
        matchScore = bestScore;
      }

      if (!claim) {
        const claimData = {
          patientName,
          payerName,
          amount,
          totalBilledAmount:
            intel.suggestedType === "FINAL_BILL" && amount
              ? amount
              : null,
          policyNo: extracted.policyNo || null,
          hospitalName: extracted.hospitalName || null,
          doctorName: extracted.doctorName || null,
          diagnosisText: extracted.diagnosisText || null,
          memberId: extracted.memberId || null,
          documentDerivedFields: getDerivedFieldsFromDocument(
            extracted,
            intel.suggestedType || "OTHER"
          ),
          fieldProvenance: documentProvenance({
            fields: getDerivedFieldsFromDocument(
              extracted,
              intel.suggestedType || "OTHER"
            ),
            confidence: intel.confidence,
            fileName: req.file.originalname,
            documentType: intel.suggestedType || "OTHER"
          }),
          status: "DRAFT"
        };

        if (extracted.dateOfBirth) {
          try {
            claimData.patientDob = parseClaimDate(extracted.dateOfBirth) || undefined;
          } catch (e) {
            // Invalid date, skip
          }
        }

        if (extracted.dateOfService) {
          try {
            claimData.dateOfService = parseClaimDate(extracted.dateOfService) || undefined;
          } catch (e) {
            // Invalid date, skip
          }
        }

        if (extracted.admissionDate) {
          try {
            claimData.admissionDate = parseClaimDate(extracted.admissionDate) || undefined;
          } catch (e) {
            // Invalid date, skip
          }
        }

        if (extracted.dischargeDate) {
          try {
            claimData.dischargeDate = parseClaimDate(extracted.dischargeDate) || undefined;
          } catch (e) {
            // Invalid date, skip
          }
        }

        if (extracted.authorizationNo) {
          claimData.authorizationNo = extracted.authorizationNo;
        }

        if (extracted.icd10Codes && extracted.icd10Codes.length > 0) {
          claimData.icd10Codes = extracted.icd10Codes;
        }

        claim = await prisma.claim.create({
          data: claimData
        });
      } else {
        const updatePayload = {};

        if (intel.suggestedType === "FINAL_BILL" && amount) {
          if (!claim.amount || Number(claim.amount) <= 0) {
            updatePayload.amount = amount;
          }
          if (!claim.totalBilledAmount || Number(claim.totalBilledAmount) <= 0) {
            updatePayload.totalBilledAmount = amount;
          }
        }

        if (!claim.policyNo && extracted.policyNo) {
          updatePayload.policyNo = extracted.policyNo;
        }

        if (!claim.memberId && extracted.memberId) {
          updatePayload.memberId = extracted.memberId;
        }

        if (!claim.hospitalName && extracted.hospitalName) {
          updatePayload.hospitalName = extracted.hospitalName;
        }

        if (!claim.doctorName && extracted.doctorName) {
          updatePayload.doctorName = extracted.doctorName;
        }

        if (!claim.diagnosisText && extracted.diagnosisText) {
          updatePayload.diagnosisText = extracted.diagnosisText;
        }

        if (!claim.authorizationNo && extracted.authorizationNo) {
          updatePayload.authorizationNo = extracted.authorizationNo;
        }

        if (!claim.patientDob && extracted.dateOfBirth) {
          try {
            updatePayload.patientDob = parseClaimDate(extracted.dateOfBirth) || undefined;
          } catch (e) {
            // Invalid date, skip
          }
        }

        if (!claim.dateOfService && extracted.dateOfService) {
          try {
            updatePayload.dateOfService = parseClaimDate(extracted.dateOfService) || undefined;
          } catch (e) {
            // Invalid date, skip
          }
        }

        if (!claim.admissionDate && extracted.admissionDate) {
          try {
            updatePayload.admissionDate = parseClaimDate(extracted.admissionDate) || undefined;
          } catch (e) {
            // Invalid date, skip
          }
        }

        if (!claim.dischargeDate && extracted.dischargeDate) {
          try {
            updatePayload.dischargeDate = parseClaimDate(extracted.dischargeDate) || undefined;
          } catch (e) {
            // Invalid date, skip
          }
        }

        if (extracted.icd10Codes && extracted.icd10Codes.length > 0 && (!claim.icd10Codes || claim.icd10Codes.length === 0)) {
          updatePayload.icd10Codes = extracted.icd10Codes;
        }

        if (Object.keys(updatePayload).length > 0) {
          claim = await prisma.claim.update({
            where: { id: claim.id },
            data: {
              ...updatePayload,
              documentDerivedFields: mergeDerivedFields(
                claim.documentDerivedFields,
                Object.keys(updatePayload)
              ),
              fieldProvenance: mergeProvenance(
                claim.fieldProvenance,
                documentProvenance({
                  fields: Object.keys(updatePayload),
                  confidence: intel.confidence,
                  fileName: req.file.originalname,
                  documentType: intel.suggestedType || "OTHER"
                })
              )
            }
          });
        }
      }

      const duplicateInClaim = await prisma.document.findFirst({
        where: { claimId: claim.id, fileHash },
        select: { id: true }
      });
      if (duplicateInClaim) {
        if (uploadedFilePath && fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
        return res.status(409).json({
          error: "Duplicate document",
          message: "This document is already attached to this claim.",
          code: "DOCUMENT_DUPLICATE"
        });
      }

      const doc = await prisma.document.create({
        data: {
          claimId: claim.id,
          type: intel.suggestedType || "OTHER",
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          path: req.file.filename,
          fileHash,
          suggestedType: intel.suggestedType,
          confidence: intel.confidence,
          extracted,
          rawText: intel.rawExtractedText || null,
          ocrProvider: intel.ocrProvider || intel.extractionSource || null,
          status: "PROCESSED"
        }
      });

      const documentFields = getDerivedFieldsFromDocument(
        extracted,
        intel.suggestedType || "OTHER"
      );
      const persistedClaim = await prisma.claim.findUnique({
        where: { id: claim.id },
        select: { fieldProvenance: true }
      });

      await prisma.claim.update({
        where: { id: claim.id },
        data: {
          fieldProvenance: mergeProvenance(
            persistedClaim?.fieldProvenance,
            documentProvenance({
              fields: documentFields,
              confidence: intel.confidence,
              documentId: doc.id,
              fileName: req.file.originalname,
              documentType: intel.suggestedType || "OTHER"
            })
          )
        }
      });

      await prisma.$transaction([
        prisma.check.updateMany({
          where: { claimId: claim.id, isStale: false },
          data: {
            isStale: true,
            staleAt: new Date(),
            staleReason: "Supporting document uploaded"
          }
        }),
        prisma.claim.update({
          where: { id: claim.id },
          data: { status: "DRAFT" }
        })
      ]);

      const updatedClaim = await prisma.claim.findUnique({
        where: { id: claim.id },
        include: {
          documents: {
            orderBy: { createdAt: "desc" }
          },
          checks: {
            orderBy: { createdAt: "desc" }
          }
        }
      });

      let message;
      if (matchStatus === "MERGED") {
        message = `Document processed and merged into ${patientName}'s existing claim.`;
      } else if (matchStatus === "REVIEW") {
        message = `Document processed. A possible matching claim was found and needs review.`;
      } else {
        message = `Document processed. New claim created for ${patientName}.`;
      }

      res.status(201).json({
        message,
        duplicate: false,
        matchStatus,
        matchScore,
        candidateClaim,
        claim: updatedClaim,
        document: doc
      });
    } catch (error) {
      if (error.code === "P2002") {
        if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
          fs.unlinkSync(uploadedFilePath);
        }

        return res.status(409).json({
          error: "Duplicate document",
          message: "This same document is already uploaded."
        });
      }

      if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
        try {
          fs.unlinkSync(uploadedFilePath);
        } catch {
          // Best-effort cleanup. Do not expose filesystem details.
        }
      }

      // Never expose Prisma/schema/database internals to the browser. These can
      // contain implementation details and make investor/demo UX look broken.
      console.error("[smart-upload] document processing failed", {
        name: error?.name || "Error",
        code: error?.code || null,
        message: error?.message || "Unknown error"
      });

      res.status(500).json({
        error: "Document processing failed",
        message:
          "The document could not be processed because the backend data model is not ready. Please retry after the server has been updated."
      });
    }
  });

  // Upload document
  router.post("/upload", upload.single("file"), verifyUploadSignature, async (req, res) => {
    const { claimId, type } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: "file is required" });
    }

    if (!claimId) {
      if (req.file?.path) fs.rmSync(req.file.path, { force: true });
      return res.status(400).json({ error: "claimId is required" });
    }

    const claim = await prisma.claim.findUnique({
      where: { id: claimId }
    });

    if (!claim) {
      if (req.file?.path) fs.rmSync(req.file.path, { force: true });
      return res.status(404).json({ error: "Claim not found" });
    }

    if (claim.claimSubmissionDate || ["SUBMITTED", "DENIED", "PAID"].includes(claim.status)) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(409).json({
        error: "Submitted claims are locked. Documents cannot be added."
      });
    }

    const uploadedFilePath = req.file.path;
    
    if (!fs.existsSync(uploadedFilePath)) {
      return res.status(400).json({ 
        error: "File not found",
        message: "Uploaded file could not be located on server"
      });
    }

    // Call AI analysis service
    const { analyzeDocument } = await import("../services/docIntel.js");
    const intel = await analyzeDocument({
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      path: uploadedFilePath
    });

    const doc = await prisma.document.create({
      data: {
        claimId: claimId,
        type: type || intel.suggestedType,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        path: req.file.filename,
        suggestedType: intel.suggestedType,
        confidence: intel.confidence,
        extracted: intel.extracted,
        status: "PROCESSED"
      }
    });

    await prisma.$transaction([
      prisma.check.updateMany({
        where: { claimId, isStale: false },
        data: {
          isStale: true,
          staleAt: new Date(),
          staleReason: "Supporting document uploaded"
        }
      }),
      prisma.claim.update({
        where: { id: claimId },
        data: { status: "DRAFT" }
      })
    ]);

    res.status(201).json(doc);
  });

  // List docs for a claim
  router.get("/claim/:claimId", async (req, res) => {
    const docs = await prisma.document.findMany({
      where: { claimId: req.params.claimId },
      orderBy: { createdAt: "desc" }
    });
    res.json(docs);
  });

  // Current document URLs and legacy claim URLs share safe file serving.
  router.get("/:id/download", (req, res) =>
    serveStoredDocument(prisma, req, res, { download: true, uploadDir })
  );
  router.get("/:id/preview", (req, res) =>
    serveStoredDocument(prisma, req, res, { uploadDir })
  );

  // DELETE doc
  router.delete("/:id", requireRoles(["ADMIN", "CASHIER"]), (req, res) =>
    deleteStoredDocument(prisma, req, res, { uploadDir })
  );

  // Process document with AI
  router.post("/:id/process", async (req, res) => {
    try {
      const doc = await prisma.document.findUnique({
        where: { id: req.params.id },
        include: { claim: true }
      });
      
      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }

      // A terminal claim must never be reset to DRAFT by document reprocessing.
      // Changes after transmission require a controlled amendment workflow.
      if (
        doc.claim?.claimSubmissionDate ||
        ["SUBMITTED", "DENIED", "PAID"].includes(doc.claim?.status)
      ) {
        return res.status(409).json({
          error: "Transmitted claims are locked. Amend the claim before reprocessing documents."
        });
      }

      // Build correct file path - doc.path should be just filename
      const filePath = resolveStoredFile(doc.path);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          error: "File not found on server",
        });
      }

      // Call the AI analysis service
      const { analyzeDocument } = await import("../services/docIntel.js");
      const analysis = await analyzeDocument({
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        path: filePath
      });

      // Update document with AI results
      const updated = await prisma.document.update({
        where: { id: doc.id },
        data: {
          suggestedType: analysis.suggestedType,
          confidence: analysis.confidence,
          extracted: analysis.extracted,
          status: "PROCESSED"
        }
      });

      await prisma.$transaction([
        prisma.check.updateMany({
          where: { claimId: doc.claimId, isStale: false },
          data: {
            isStale: true,
            staleAt: new Date(),
            staleReason: "Supporting document reprocessed"
          }
        }),
        prisma.claim.update({
          where: { id: doc.claimId },
          data: { status: "DRAFT" }
        })
      ]);

      res.json(updated);
    } catch (error) {
      return res.status(500).json({
        error: "Failed to process document"
      });
    }
  });

  return router;
}
