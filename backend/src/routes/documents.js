import express from "express";
import { requireRoles } from "../middleware/auth.js";
import { verifyUploadSignature } from "../middleware/uploadSafety.js";
import { createDocumentUpload } from "../services/documentUpload.js";
import { publicClaimDocuments, publicDocument } from "../services/documentPublicView.js";
import fs from "fs";
import { randomUUID } from "crypto";
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
import { selectSmartUploadMatch } from "../services/smartUploadMatch.js";
import {
  deleteStoredObject,
  materializeStoredDocument,
  persistUploadedDocument
} from "../services/documentStorage.js";
import { serveStoredDocument } from "../services/documentResponse.js";
import { analyzeDocument, DOC_TYPES } from "../services/docIntel.js";
import {
  documentCreateData,
  findDuplicateDocument,
  inspectUploadedDocument
} from "../services/documentProcessing.js";
import { deleteStoredDocument } from "../services/documentDeletion.js";
import { isClaimLocked } from "../services/claimLock.js";
import { writeRequestAudit } from "../services/auditLog.js";
import {
  getExtractedPatientName,
  getExtractedAmount,
  validateDocumentIdentityAgainstClaim
} from "../services/documentIdentity.js";
import {
  applyCodingSuggestionToClaim,
  syncDocumentCodingSuggestions,
  validateCodingCode
} from "../services/codingSuggestions.js";


function assignParsedDate(target, field, value) {
  if (!value) return;
  const parsed = parseClaimDate(value);
  if (parsed) target[field] = parsed;
}

function firstExtractedText(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function canonicalDocumentFields(extracted = {}, documentType = "OTHER") {
  const amount = getExtractedAmount(extracted);
  const fields = {
    patientName: getExtractedPatientName(extracted),
    payerName: firstExtractedText(extracted.payerName, extracted.payer_name),
    policyNo: firstExtractedText(
      extracted.policyNo,
      extracted.policyNumber,
      extracted.policy_number
    ),
    memberId: firstExtractedText(extracted.memberId, extracted.member_id),
    groupNumber: firstExtractedText(extracted.groupNumber, extracted.group_number),
    subscriberId: firstExtractedText(
      extracted.subscriberId,
      extracted.subscriber_id,
      extracted.memberId,
      extracted.member_id
    ),
    subscriberName: firstExtractedText(
      extracted.subscriberName,
      extracted.subscriber_name,
      extracted.policyHolder
    ),
    payerEdiId: firstExtractedText(extracted.payerEdiId, extracted.payer_edi_id),
    medicalRecordNumber: firstExtractedText(
      extracted.medicalRecordNumber,
      extracted.mrn
    ),
    patientMobile: firstExtractedText(
      extracted.patientMobile,
      extracted.phone,
      extracted.mobile
    ),
    insurerClaimNo: firstExtractedText(
      extracted.claimNo,
      extracted.claimNumber,
      extracted.claim_number
    ),
    hospitalName: firstExtractedText(extracted.hospitalName, extracted.hospital_name),
    doctorName: firstExtractedText(extracted.doctorName, extracted.doctor_name),
    diagnosisText: firstExtractedText(extracted.diagnosisText, extracted.diagnosis),
    authorizationNo: firstExtractedText(
      extracted.authorizationNo,
      extracted.authorization_number
    ),
    amount: amount || null,
    totalBilledAmount:
      documentType === "FINAL_BILL" && amount ? amount : null
  };

  for (const [field, value] of [
    ["patientDob", extracted.dateOfBirth || extracted.patientDob || extracted.dob],
    ["dateOfService", extracted.dateOfService || extracted.serviceDate],
    ["admissionDate", extracted.admissionDate],
    ["dischargeDate", extracted.dischargeDate]
  ]) {
    const parsed = value ? parseClaimDate(value) : null;
    if (parsed) fields[field] = parsed;
  }

  return fields;
}

function buildMissingClaimAutofill(claim = {}, extracted = {}, documentType = "OTHER") {
  const values = canonicalDocumentFields(extracted, documentType);
  const patch = {};

  for (const [field, value] of Object.entries(values)) {
    if (value == null || value === "") continue;

    if (field === "patientName") {
      const current = String(claim.patientName || "").trim().toLowerCase();
      if (!current || current === "unknown patient") patch.patientName = value;
      continue;
    }

    if (field === "payerName") {
      const current = String(claim.payerName || "").trim().toLowerCase();
      if (!current || ["insurance", "unknown", "unknown payer", "payer"].includes(current)) {
        patch.payerName = value;
      }
      continue;
    }

    if (field === "amount" || field === "totalBilledAmount") {
      if (!claim[field] || Number(claim[field]) <= 0) patch[field] = value;
      continue;
    }

    const current = claim[field];
    if (
      current == null ||
      current === "" ||
      (Array.isArray(current) && current.length === 0)
    ) {
      patch[field] = value;
    }
  }

  return patch;
}

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
  
  if (dateOfBirth && existingClaim.patientDob && parseClaimDate(dateOfBirth)?.toISOString().slice(0, 10) === existingClaim.patientDob.toISOString().slice(0, 10)) {
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
    const parsedDocDate = parseClaimDate(docDate);
    const parsedClaimDate = parseClaimDate(existingClaim.dateOfService);
    const daysDiff =
      parsedDocDate && parsedClaimDate
        ? Math.abs(parsedDocDate - parsedClaimDate) / (1000 * 60 * 60 * 24)
        : Number.POSITIVE_INFINITY;
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

async function auditDocumentEvent(
  prismaClient,
  req,
  { claimId, documentId = null, action, outcome = "SUCCESS", metadata = {} }
) {
  return writeRequestAudit(prismaClient, req, {
    claimId,
    action,
    entityType: "Document",
    entityId: documentId,
    outcome,
    metadata
  });
}

async function invalidateClaimReadiness(
  prisma,
  claimId,
  reason = "Claim data changed"
) {
  await markReadinessChecksStale(prisma, claimId, reason);

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    select: { status: true }
  });

  if (claim?.status === "READY") {
    await prisma.claim.update({
      where: { id: claimId },
      data: { status: "DRAFT" }
    });
  }
}


export function documentsRouter(prisma, uploadDir) {
  const router = express.Router();

  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const upload = createDocumentUpload(uploadDir);

  router.post("/smart-upload", upload.single("file"), verifyUploadSignature, async (req, res) => {
    let uploadedFilePath = null;
    let storedDocumentPath = null;
    
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

      const { fileHash, intel, extracted } =
        await inspectUploadedDocument(req.file);
      const patientName = extracted.patientName || "Unknown Patient";
      const parsedAmount = extracted.amount != null ? Number(extracted.amount) : null;
      const amount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : null;
      const payerName = extracted.payerName || "Insurance";

      let claim = null;
      let pendingNewClaimData = null;
      let pendingNewClaimId = null;
      let matchStatus = "NEW";
      let matchScore = 0;
      let candidateClaim = null;

      const recentClaims = await prisma.claim.findMany({
        where: {
          organizationId: req.user.organizationId,
          deletedAt: null,
          patientName: {
            equals: patientName,
            mode: "insensitive"
          },
          status: { in: ["DRAFT", "READY", "NEEDS_REVIEW"] }
        },
        orderBy: { createdAt: "desc" },
        take: 10
      });

      const selected = selectSmartUploadMatch(extracted, recentClaims, calculateMatchScore);
      claim = selected.claim;
      candidateClaim = selected.candidateClaim;
      matchScore = selected.matchScore;
      matchStatus = selected.matchStatus;

      // Duplicate detection must happen before smart-upload mutates an existing
      // claim, otherwise a duplicate file can still change claim data.
      if (claim) {
        const duplicateInClaim = await findDuplicateDocument(
          prisma,
          claim.id,
          fileHash
        );
        if (duplicateInClaim) {
          if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
            fs.unlinkSync(uploadedFilePath);
          }
          return res.status(409).json({
            error: "Duplicate document",
            message: "This document is already attached to this claim.",
            code: "DOCUMENT_DUPLICATE"
          });
        }
      }

      if (!claim) {
        const documentType = intel.suggestedType || "OTHER";
        const extractedClaimFields = canonicalDocumentFields(extracted, documentType);
        const claimData = {
          organizationId: req.user.organizationId,
          createdById: req.user.id,
          ...extractedClaimFields,
          patientName: extractedClaimFields.patientName || patientName,
          payerName: extractedClaimFields.payerName || payerName,
          documentDerivedFields: getDerivedFieldsFromDocument(
            extracted,
            documentType
          ),
          fieldProvenance: documentProvenance({
            fields: getDerivedFieldsFromDocument(extracted, documentType),
            confidence: intel.confidence,
            fileName: req.file.originalname,
            documentType
          }),
          status: "DRAFT"
        };


        pendingNewClaimId = randomUUID();
        pendingNewClaimData = claimData;
        claim = {
          id: pendingNewClaimId,
          ...claimData
        };
      } else {
        const updatePayload = buildMissingClaimAutofill(
          claim,
          extracted,
          intel.suggestedType || "OTHER"
        );

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

      storedDocumentPath = await persistUploadedDocument(req.file, {
        organizationId: req.user.organizationId,
        claimId: claim.id,
        uploadDir
      });
      req.file.storagePath = storedDocumentPath;

      const doc = await prisma.$transaction(async (tx) => {
        if (pendingNewClaimData) {
          claim = await tx.claim.create({
            data: {
              id: pendingNewClaimId,
              ...pendingNewClaimData
            }
          });
        }

        const created = await tx.document.create({
          data: documentCreateData({
            claimId: claim.id,
            file: req.file,
            fileHash,
            intel
          })
        });

        await syncDocumentCodingSuggestions(tx, {
          claimId: claim.id,
          documentId: created.id,
          extracted,
          rawText: intel.rawExtractedText || "",
          confidence: intel.confidence
        });

        const documentFields = getDerivedFieldsFromDocument(
          extracted,
          intel.suggestedType || "OTHER"
        );
        const persistedClaim = await tx.claim.findUnique({
          where: { id: claim.id },
          select: { fieldProvenance: true }
        });

        await tx.claim.update({
          where: { id: claim.id },
          data: {
            fieldProvenance: mergeProvenance(
              persistedClaim?.fieldProvenance,
              documentProvenance({
                fields: documentFields,
                confidence: intel.confidence,
                documentId: created.id,
                fileName: req.file.originalname,
                documentType: intel.suggestedType || "OTHER"
              })
            ),
            status: "DRAFT"
          }
        });

        await tx.check.updateMany({
          where: { claimId: claim.id, isStale: false },
          data: {
            isStale: true,
            staleAt: new Date(),
            staleReason: "Supporting document uploaded"
          }
        });

        return created;
      });

      await auditDocumentEvent(prisma, req, {
        claimId: claim.id,
        documentId: doc.id,
        action: "DOCUMENT_UPLOADED",
        metadata: {
          uploadMode: "SMART",
          documentType: doc.type,
          ocrProvider: doc.ocrProvider || null
        }
      });

      const updatedClaim = await prisma.claim.findUnique({
        where: { id: claim.id },
        include: {
          documents: {
            orderBy: { createdAt: "desc" }
          },
          serviceLines: {
            orderBy: { createdAt: "asc" }
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
        claim: publicClaimDocuments(updatedClaim),
        document: publicDocument(doc)
      });
    } catch (error) {
      if (storedDocumentPath) {
        try {
          await deleteStoredObject(storedDocumentPath, { uploadDir });
        } catch (cleanupError) {
          console.error("[smart-upload] stored object rollback failed", {
            code: cleanupError?.code || null
          });
        }
      }

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

      res.status(error?.status || 500).json({
        error: error?.code === "OCR_UNAVAILABLE" ? "OCR unavailable" : "Document processing failed",
        message: error?.status
          ? error.message
          : "The document could not be processed. Please retry or contact support if the problem continues.",
        code: error?.code || "DOCUMENT_PROCESSING_FAILED"
      });
    }
  });

  // Upload document
  async function handleClaimDocumentUpload(req, res) {
  let storedDocumentPath = null;
  try {
    const { claimId, type } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "File is required" });
    }

    const requestedType = type ? String(type).toUpperCase() : null;
    if (requestedType && !DOC_TYPES.includes(requestedType)) {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: "Invalid document type",
        message: "Document type is not supported",
        code: "INVALID_DOCUMENT_TYPE"
      });
    }

    const claim = await prisma.claim.findFirst({
      where: { id: claimId, organizationId: req.user.organizationId, deletedAt: null }
    });

    if (!claim) {
      return res.status(400).json({
        error: "Invalid claimId",
        message: `Claim with ID ${claimId} does not exist`
      });
    }

    if (isClaimLocked(claim)) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(409).json({
        error: "Submitted claims are locked. Documents cannot be added."
      });
    }

    const { fileHash, intel } = await inspectUploadedDocument(req.file);

    const duplicateInClaim = await findDuplicateDocument(prisma, claimId, fileHash);

    if (duplicateInClaim) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      return res.status(409).json({
        error: "Duplicate document",
        message: "This document is already attached to this claim.",
        code: "DOCUMENT_DUPLICATE"
      });
    }

    // Validate patient/member identity BEFORE persisting the document.
    // This prevents a John Smith document from being attached to Alice's claim.
    const identityValidation = validateDocumentIdentityAgainstClaim(
      claim,
      intel.extracted
    );

    if (identityValidation.status === "MISMATCH") {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      console.warn("[claim-document] identity mismatch blocked", {
        claimId,
        conflictFields: identityValidation.conflicts
      });

      const conflictLabels = {
        patientName: "patient name",
        memberId: "member ID",
        policyNo: "policy number",
        patientDob: "date of birth"
      };
      const conflictingDetails = identityValidation.conflicts
        .map((field) => conflictLabels[field] || field)
        .join(", ");

      return res.status(409).json({
        error: "Patient identity mismatch",
        message:
          identityValidation.conflicts.includes("patientName")
            ? `The document patient name does not match this claim. Document: ${identityValidation.extractedPatientName || "Unknown"}; Claim: ${claim.patientName || "Unknown"}.`
            : `The patient name matches, but the document conflicts with this claim on: ${conflictingDetails}. The document was not uploaded.`,
        code: "DOCUMENT_PATIENT_MISMATCH",
        identityValidation
      });
    }

    storedDocumentPath = await persistUploadedDocument(req.file, {
      organizationId: req.user.organizationId,
      claimId,
      uploadDir
    });
    req.file.storagePath = storedDocumentPath;

    const { doc, updatedClaim } = await prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: documentCreateData({
          claimId,
          file: req.file,
          fileHash,
          intel,
          type: requestedType,
          identityValidation
        })
      });

      await syncDocumentCodingSuggestions(tx, {
        claimId,
        documentId: created.id,
        extracted: intel.extracted || {},
        rawText: intel.rawExtractedText || "",
        confidence: intel.confidence
      });

      const updatePayload = buildMissingClaimAutofill(
        claim,
        intel.extracted || {},
        type || intel.suggestedType || "OTHER"
      );

      if (Object.keys(updatePayload).length > 0) {
        const derivedFromThisDocument = Object.keys(updatePayload);
        await tx.claim.update({
          where: { id: claimId },
          data: {
            ...updatePayload,
            documentDerivedFields: mergeDerivedFields(
              claim.documentDerivedFields,
              derivedFromThisDocument
            ),
            fieldProvenance: mergeProvenance(
              claim.fieldProvenance,
              documentProvenance({
                fields: derivedFromThisDocument,
                confidence: intel.confidence,
                documentId: created.id,
                fileName: req.file.originalname,
                documentType: type || intel.suggestedType || "OTHER"
              })
            )
          }
        });
      }

      await invalidateClaimReadiness(tx, claimId);

      const refreshed = await tx.claim.findUnique({
        where: { id: claimId },
        include: {
          documents: { orderBy: { createdAt: "desc" } },
          serviceLines: { orderBy: { createdAt: "asc" } },
          checks: { orderBy: { createdAt: "desc" } }
        }
      });

      return { doc: created, updatedClaim: refreshed };
    });

    await auditDocumentEvent(prisma, req, {
      claimId,
      documentId: doc.id,
      action: "DOCUMENT_UPLOADED",
      metadata: {
        uploadMode: "MANUAL",
        documentType: doc.type,
        ocrProvider: doc.ocrProvider || null
      }
    });

    res.status(req.baseUrl === "/api/claims/documents" ? 200 : 201).json({
      ...publicDocument(doc),
      claim: publicClaimDocuments(updatedClaim),
      identityValidation,
      message:
        identityValidation.status === "REVIEW"
          ? "Document uploaded. Patient identity mostly matches, but one extracted identifier needs review."
          : identityValidation.status === "UNVERIFIED"
          ? "Document uploaded, but patient identity could not be verified from the extracted document data."
          : "Document uploaded and patient identity matched the current claim."
    });
  } catch (e) {
    if (storedDocumentPath) {
      try {
        await deleteStoredObject(storedDocumentPath, { uploadDir });
      } catch (cleanupError) {
        console.error("[claim-document] stored object rollback failed", {
          claimId: req.body?.claimId || null,
          code: cleanupError?.code || null
        });
      }
    }

    if (req.file?.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // Best-effort cleanup; do not expose filesystem details to the client.
      }
    }

    if (e?.code === "P2002") {
      return res.status(409).json({
        error: "Duplicate document",
        message: "This document is already attached to this claim.",
        code: "DOCUMENT_DUPLICATE"
      });
    }

    console.error("[claim-document] upload failed", {
      claimId: req.body?.claimId || null,
      name: e?.name || "Error",
      message: e?.message || "Unknown error"
    });

    res.status(e?.status || 500).json({
      error: e?.code === "OCR_UNAVAILABLE" ? "OCR unavailable" : "Document upload failed",
      message: e?.status ? e.message : undefined,
      code: e?.code || "DOCUMENT_UPLOAD_FAILED"
    });
  }
  }

  router.post("/upload", upload.single("file"), verifyUploadSignature, handleClaimDocumentUpload);
  // Compatibility for callers using POST /api/claims/documents.
  router.post("/", upload.single("file"), verifyUploadSignature, handleClaimDocumentUpload);

  // List documents for the current organization without bloating the claims list.
  router.get("/", async (req, res) => {
    const claimId = String(req.query?.claimId || "").trim();
    const docs = await prisma.document.findMany({
      where: {
        claim: {
          organizationId: req.user.organizationId,
          deletedAt: null,
          ...(claimId ? { id: claimId } : {})
        }
      },
      select: {
        id: true,
        fileName: true,
        type: true,
        confidence: true,
        claim: {
          select: {
            id: true,
            patientName: true
          }
        },
        codingSuggestions: {
          select: {
            status: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    const items = docs.map(({ claim, codingSuggestions, ...doc }) => ({
      ...doc,
      claimId: claim.id,
      patientName: claim.patientName || "Unknown Patient",
      codingSummary: {
        total: codingSuggestions.length,
        pending: codingSuggestions.filter((item) => item.status === "PENDING").length
      }
    }));

    await writeRequestAudit(prisma, req, {
      claimId: claimId || null,
      action: "DOCUMENT_LIST_VIEWED",
      entityType: claimId ? "Claim" : "Document",
      entityId: claimId || null,
      metadata: { count: items.length, scoped: Boolean(claimId) }
    });

    res.json(items);
  });

  // List docs for a claim
  router.get("/claim/:claimId", async (req, res) => {
    const docs = await prisma.document.findMany({
      where: { claimId: req.params.claimId, claim: { organizationId: req.user.organizationId, deletedAt: null } },
      orderBy: { createdAt: "desc" }
    });
    await writeRequestAudit(prisma, req, {
      claimId: req.params.claimId,
      action: "DOCUMENT_LIST_VIEWED",
      entityType: "Claim",
      entityId: req.params.claimId,
      metadata: { count: docs.length }
    });
    res.json(docs.map(publicDocument));
  });

  // Current document URLs and legacy claim URLs share safe file serving.
  async function serveAuditedDocument(req, res, download = false) {
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, claim: { organizationId: req.user.organizationId, deletedAt: null } },
      select: { id: true, claimId: true }
    });
    if (!doc) {
      await writeRequestAudit(prisma, req, {
        action: download ? "DOCUMENT_DOWNLOAD_DENIED" : "DOCUMENT_PREVIEW_DENIED",
        entityType: "Document",
        entityId: req.params.id,
        outcome: "DENIED"
      });
      return res.status(404).json({ error: "Document not found" });
    }
    await auditDocumentEvent(prisma, req, {
      claimId: doc.claimId,
      documentId: doc.id,
      action: download ? "DOCUMENT_DOWNLOADED" : "DOCUMENT_PREVIEWED"
    });
    return serveStoredDocument(prisma, req, res, { download, uploadDir });
  }

  router.get("/:id/download", (req, res) => serveAuditedDocument(req, res, true));
  router.get("/:id/preview", (req, res) => serveAuditedDocument(req, res, false));

  // DELETE doc
  router.delete("/:id", requireRoles(["ADMIN", "CASHIER"]), (req, res) =>
    deleteStoredDocument(prisma, req, res, { uploadDir })
  );

  // Process document with AI
  router.post("/:id/process", async (req, res) => {
    try {
      const doc = await prisma.document.findFirst({
        where: { id: req.params.id, claim: { organizationId: req.user.organizationId, deletedAt: null } },
        include: { claim: true }
      });
      
      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }

      // A terminal claim must never be reset to DRAFT by document reprocessing.
      // Changes after transmission require a controlled amendment workflow.
      if (
        isClaimLocked(doc.claim)
      ) {
        return res.status(409).json({
          error: "Transmitted claims are locked. Amend the claim before reprocessing documents."
        });
      }

      const materialized = await materializeStoredDocument(doc.path, { uploadDir });
      if (!materialized) {
        return res.status(404).json({
          error: "File not found on server"
        });
      }

      let analysis;
      try {
        analysis = await analyzeDocument({
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          path: materialized.path
        });
      } finally {
        await materialized.cleanup();
      }

      if (analysis.ocrStatus === "FAILED") {
        await prisma.document.update({ where: { id: doc.id }, data: { status: "FAILED" } });
        return res.status(503).json({ error: "OCR unavailable", message: "Text extraction failed. Retry document processing later.", code: "OCR_UNAVAILABLE" });
      }

      // Update document with AI results
      const updated = await prisma.document.update({
        where: { id: doc.id },
        data: {
          suggestedType: analysis.suggestedType,
          confidence: analysis.confidence,
          extracted: analysis.extracted,
          rawText: analysis.rawExtractedText || null,
          ocrProvider: analysis.ocrProvider || analysis.extractionSource || null,
          status: "PROCESSED"
        }
      });

      await syncDocumentCodingSuggestions(prisma, {
        claimId: doc.claimId,
        documentId: doc.id,
        extracted: analysis.extracted || {},
        rawText: analysis.rawExtractedText || "",
        confidence: analysis.confidence
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

      await auditDocumentEvent(prisma, req, {
        claimId: doc.claimId,
        documentId: doc.id,
        action: "DOCUMENT_REPROCESSED",
        metadata: {
          suggestedType: updated.suggestedType,
          confidence: updated.confidence,
          ocrProvider: updated.ocrProvider || null
        }
      });

      res.json(publicDocument(updated));
    } catch (error) {
      return res.status(500).json({
        error: "Failed to process document"
      });
    }
  });

  router.get("/:id/coding-suggestions", async (req, res) => {
    const doc = await prisma.document.findFirst({
      where: {
        id: req.params.id,
        claim: {
          organizationId: req.user.organizationId,
          deletedAt: null
        }
      },
      select: { id: true }
    });

    if (!doc) return res.status(404).json({ error: "Document not found" });

    const suggestions = await prisma.codingSuggestion.findMany({
      where: { documentId: doc.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        system: true,
        suggestedCode: true,
        confidence: true,
        evidenceText: true,
        status: true,
        finalCode: true,
        reviewedAt: true,
        reviewedBy: {
          select: { id: true, email: true }
        }
      }
    });

    res.json({ items: suggestions });
  });

  router.patch("/coding-suggestions/:suggestionId", async (req, res) => {
    const action = String(req.body?.action || "").trim().toUpperCase();
    if (!["ACCEPT", "CHANGE", "REJECT"].includes(action)) {
      return res.status(400).json({
        error: "Action must be ACCEPT, CHANGE, or REJECT"
      });
    }

    const suggestion = await prisma.codingSuggestion.findFirst({
      where: {
        id: req.params.suggestionId,
        claim: {
          organizationId: req.user.organizationId,
          deletedAt: null
        }
      },
      include: {
        claim: true,
        document: {
          select: { id: true }
        }
      }
    });

    if (!suggestion) {
      return res.status(404).json({ error: "Coding suggestion not found" });
    }

    if (isClaimLocked(suggestion.claim)) {
      return res.status(409).json({
        error: "Submitted claims are locked. Coding suggestions cannot be changed."
      });
    }

    if (suggestion.status !== "PENDING") {
      return res.status(409).json({
        error: "This coding suggestion has already been reviewed"
      });
    }

    let finalCode = null;
    let nextStatus = "REJECTED";

    if (action !== "REJECT") {
      const candidate =
        action === "ACCEPT"
          ? suggestion.suggestedCode
          : req.body?.code;

      const validated = validateCodingCode(suggestion.system, candidate);
      if (validated.error) {
        return res.status(400).json({ error: validated.error });
      }

      finalCode = validated.code;
      nextStatus = action === "CHANGE" ? "CHANGED" : "ACCEPTED";
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (action !== "REJECT") {
        await applyCodingSuggestionToClaim(tx, suggestion, finalCode);
      }

      const reviewedAt = new Date();
      const reviewed = await tx.codingSuggestion.update({
        where: { id: suggestion.id },
        data: {
          status: nextStatus,
          finalCode,
          reviewedAt,
          reviewedById: req.user.id
        },
        include: {
          reviewedBy: {
            select: { id: true, email: true }
          }
        }
      });

      await tx.codingSuggestion.updateMany({
        where: {
          claimId: suggestion.claimId,
          id: { not: suggestion.id },
          system: suggestion.system,
          suggestedCode: suggestion.suggestedCode,
          status: "PENDING"
        },
        data: {
          status: nextStatus,
          finalCode,
          reviewedAt,
          reviewedById: req.user.id
        }
      });

      await tx.check.updateMany({
        where: { claimId: suggestion.claimId, isStale: false },
        data: {
          isStale: true,
          staleAt: new Date(),
          staleReason: "Coding review changed claim coding"
        }
      });

      if (suggestion.claim.status === "READY") {
        await tx.claim.update({
          where: { id: suggestion.claimId },
          data: { status: "DRAFT" }
        });
      }

      return reviewed;
    });

    await writeRequestAudit(prisma, req, {
      claimId: suggestion.claimId,
      action: `CODING_SUGGESTION_${nextStatus}`,
      entityType: "CodingSuggestion",
      entityId: suggestion.id,
      outcome: "SUCCESS",
      statusCode: 200,
      metadata: {
        codingSystem: suggestion.system,
        suggestionStatus: nextStatus
      }
    });

    res.json(updated);
  });

  // Manual document type override remains available until claim transmission.
  router.patch("/:id/type", requireRoles(["ADMIN", "CASHIER"]), async (req, res) => {
    try {
      const nextType = String(req.body?.type || "").trim().toUpperCase();
      if (!DOC_TYPES.includes(nextType)) {
        return res.status(400).json({
          error: "Invalid document type",
          code: "INVALID_DOCUMENT_TYPE"
        });
      }

      const doc = await prisma.document.findFirst({
        where: {
          id: req.params.id,
          claim: { organizationId: req.user.organizationId, deletedAt: null }
        },
        include: { claim: true }
      });

      if (!doc) return res.status(404).json({ error: "Document not found" });

      if (isClaimLocked(doc.claim)) {
        return res.status(409).json({
          error: "Submitted claims are locked. Document type cannot be changed."
        });
      }

      if (doc.type === nextType) {
        return res.json({
          ...doc,
          unchanged: true,
          message: "Document type is already set to this value"
        });
      }

      const updated = await prisma.$transaction(async (tx) => {
        const changed = await tx.document.update({
          where: { id: doc.id },
          data: { type: nextType }
        });

        await tx.check.updateMany({
          where: { claimId: doc.claimId, isStale: false },
          data: {
            isStale: true,
            staleAt: new Date(),
            staleReason: "Document type changed manually"
          }
        });

        if (doc.claim?.status === "READY") {
          await tx.claim.update({
            where: { id: doc.claimId },
            data: { status: "DRAFT" }
          });
        }

        return changed;
      });

      await auditDocumentEvent(prisma, req, {
        claimId: doc.claimId,
        documentId: doc.id,
        action: "DOCUMENT_TYPE_CHANGED",
        metadata: {
          previousType: doc.type,
          newType: nextType,
          changeSource: "MANUAL"
        }
      });

      return res.json({
        ...updated,
        message: `Document type changed to ${nextType.replaceAll("_", " ")}`
      });
    } catch (error) {
      console.error("[claim-document] manual type update failed", {
        documentId: req.params.id,
        code: error?.code || null
      });
      return res.status(500).json({
        error: "Unable to change document type"
      });
    }
  });

  router.patch("/:id/identity-review", requireRoles(["ADMIN", "CASHIER"]), async (req, res) => {
    try {
      const decision = String(req.body?.decision || "CONFIRMED").trim().toUpperCase();
      if (!["CONFIRMED"].includes(decision)) {
        return res.status(400).json({
          error: "Invalid identity review decision",
          code: "INVALID_IDENTITY_REVIEW_DECISION"
        });
      }

      const doc = await prisma.document.findFirst({
        where: {
          id: req.params.id,
          claim: { organizationId: req.user.organizationId, deletedAt: null }
        },
        include: { claim: true }
      });

      if (!doc) return res.status(404).json({ error: "Document not found" });
      if (isClaimLocked(doc.claim)) {
        return res.status(409).json({
          error: "Submitted claims are locked. Identity review cannot be changed."
        });
      }

      const extracted =
        doc.extracted && typeof doc.extracted === "object" && !Array.isArray(doc.extracted)
          ? doc.extracted
          : {};
      const review =
        extracted._identityReview && typeof extracted._identityReview === "object"
          ? extracted._identityReview
          : null;

      if (!review) {
        return res.json({
          ...doc,
          unchanged: true,
          message: "This document has no pending identity review"
        });
      }

      if (review.reviewed === true) {
        return res.json({
          ...doc,
          unchanged: true,
          message: "Document identity has already been reviewed"
        });
      }

      const nextExtracted = {
        ...extracted,
        _identityReview: {
          ...review,
          reviewed: true,
          reviewedAt: new Date().toISOString(),
          reviewedByUserId: req.user?.id || null,
          decision
        }
      };

      const updated = await prisma.$transaction(async (tx) => {
        const changed = await tx.document.update({
          where: { id: doc.id },
          data: { extracted: nextExtracted }
        });

        await tx.check.updateMany({
          where: { claimId: doc.claimId, isStale: false },
          data: {
            isStale: true,
            staleAt: new Date(),
            staleReason: "Document identity review resolved"
          }
        });

        if (doc.claim?.status === "READY") {
          await tx.claim.update({
            where: { id: doc.claimId },
            data: { status: "DRAFT" }
          });
        }

        return changed;
      });

      await auditDocumentEvent(prisma, req, {
        claimId: doc.claimId,
        documentId: doc.id,
        action: "DOCUMENT_IDENTITY_REVIEWED",
        metadata: {
          decision,
          conflicts: Array.isArray(review.conflicts) ? review.conflicts : [],
          previousStatus: review.status || null
        }
      });

      return res.json({
        ...updated,
        message: "Document identity review completed"
      });
    } catch (error) {
      console.error("[claim-document] identity review update failed", {
        documentId: req.params.id,
        code: error?.code || null
      });
      return res.status(500).json({
        error: "Unable to complete document identity review"
      });
    }
  });

  // Canonical document operations; legacy /api/claims/documents URLs share this router.
  router.post("/:id/apply-suggestion", async (req, res) => {
  try {
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, claim: { organizationId: req.user.organizationId, deletedAt: null } },
      include: { claim: true }
    });

    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (isClaimLocked(doc.claim)) {
      return res.status(409).json({
        error: "Submitted claims are locked. Document type cannot be changed."
      });
    }

    if (!doc.suggestedType) {
      return res.status(409).json({
        error: "No AI document type suggestion is available"
      });
    }

    if (doc.type === doc.suggestedType) {
      return res.json({
        ...doc,
        unchanged: true,
        message: "Document type already matches the AI suggestion"
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.document.update({
        where: { id: doc.id },
        data: { type: doc.suggestedType }
      });

      await tx.check.updateMany({
        where: { claimId: doc.claimId, isStale: false },
        data: {
          isStale: true,
          staleAt: new Date(),
          staleReason: "Document type changed"
        }
      });

      if (doc.claim?.status === "READY") {
        await tx.claim.update({
          where: { id: doc.claimId },
          data: { status: "DRAFT" }
        });
      }

      return changed;
    });

    res.json({
      ...updated,
      message: `Document type changed to ${updated.type.replaceAll("_", " ")}`
    });
  } catch (error) {
    console.error("[claim-document] apply suggestion failed", {
      documentId: req.params.id,
      code: error?.code || null,
      message: error?.message || "Unknown error"
    });

    res.status(500).json({
      error: "Unable to apply AI document type suggestion"
    });
  }
});

  router.post("/bulk-delete", requireRoles(["ADMIN", "CASHIER"]), async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids array required" });
    }

    const requestedIds = [...new Set(ids.map((id) => String(id)))];
    const docs = await prisma.document.findMany({
      where: {
        id: { in: requestedIds },
        claim: { organizationId: req.user.organizationId, deletedAt: null }
      },
      include: { claim: true }
    });

    // Treat the request atomically: if any requested ID is outside this
    // organization (or missing), delete nothing and reveal no tenant detail.
    if (docs.length !== requestedIds.length) {
      return res.status(404).json({
        error: "One or more documents were not found"
      });
    }

    if (docs.some((doc) => isClaimLocked(doc.claim))) {
      return res.status(409).json({
        error: "Submitted claims are locked. Their documents cannot be deleted."
      });
    }

    const authorizedDocumentIds = docs.map((doc) => doc.id);
    const claimIds = [...new Set(docs.map((doc) => doc.claimId))];
    const deletingIds = new Set(authorizedDocumentIds);

    const claims = await prisma.claim.findMany({
      where: { id: { in: claimIds }, organizationId: req.user.organizationId, deletedAt: null },
      select: {
        id: true,
        documentDerivedFields: true,
        fieldProvenance: true
      }
    });

    const claimUpdates = [];
    for (const claim of claims) {
      const remainingDocuments = await prisma.document.findMany({
        where: { claimId: claim.id },
        orderBy: { createdAt: "desc" }
      });

      const keptDocuments = remainingDocuments.filter(
        (document) => !deletingIds.has(document.id)
      );

      const patch = recomputeDerivedClaimPatch(
        keptDocuments,
        claim.documentDerivedFields
      );

      claimUpdates.push({
        claimId: claim.id,
        patch,
        fieldProvenance: removeProvenanceFields(
          claim.fieldProvenance,
          Object.keys(patch)
        )
      });
    }

    await prisma.$transaction([
      prisma.document.deleteMany({ where: { id: { in: authorizedDocumentIds } } }),
      prisma.check.updateMany({
        where: { claimId: { in: claimIds }, isStale: false },
        data: {
          isStale: true,
          staleAt: new Date(),
          staleReason: "Supporting documents deleted"
        }
      }),
      ...claimUpdates.map(({ claimId, patch, fieldProvenance }) =>
        prisma.claim.update({
          where: { id: claimId },
          data: {
            ...patch,
            fieldProvenance,
            status: "DRAFT"
          }
        })
      )
    ]);

    for (const doc of docs) {
      await auditDocumentEvent(prisma, req, {
        claimId: doc.claimId,
        documentId: doc.id,
        action: "DOCUMENT_DELETED",
        metadata: { bulk: true, documentType: doc.type }
      });
    }

    for (const doc of docs) {
      try {
        await deleteStoredObject(doc.path, { uploadDir });
      } catch (fileError) {
        console.error("[claim-document] bulk stored object cleanup failed", {
          claimId: doc.claimId,
          documentId: doc.id,
          code: fileError?.code || null
        });
      }
    }

    res.json({ success: true, deleted: docs.length });
  } catch (e) {
    console.error("Bulk delete error:", e);
    res.status(500).json({ error: "Bulk deletion failed", code: "DOCUMENT_BULK_DELETE_FAILED" });
  }
});

  return router;
}
