import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function documentsRouter(prisma, uploadDir) {
  const router = express.Router();

  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  // Public test route (no auth required)
  router.get("/public-test", (req, res) => {
    res.json({ message: "Documents router is working without auth!" });
  });

  // Test route (with auth)
  router.get("/test", (req, res) => {
    res.json({ message: "Documents router is working!" });
  });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      cb(null, `${Date.now()}_${safe}`);
    }
  });

  const upload = multer({ storage });

  router.post("/smart-upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "file is required" });
    }

    const { analyzeDocument, getFileHash } = await import("../services/docIntel.js");

    const fullPath = path.join(uploadDir, doc.path);
    const fileHash = getFileHash(fullPath);

    const duplicate = await prisma.document.findFirst({
      where: { fileHash },
      include: { claim: true }
    });

    if (duplicate) {
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

      return res.status(409).json({
        error: "Duplicate document",
        message: "This same document is already uploaded.",
        existingDocumentId: duplicate.id,
        existingClaimId: duplicate.claimId,
        patientName: duplicate.claim?.patientName
      });
    }

    const intel = await analyzeDocument({
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      path: fullPath
    });

    const extracted = intel.extracted || {};
    const patientName = extracted.patientName || "Unknown Patient";
    const amount = Number(extracted.amount || 1);
    const payerName = extracted.payerName || "Insurance";

    let claim = null;

    if (patientName && patientName !== "Unknown Patient") {
      claim = await prisma.claim.findFirst({
        where: {
          patientName: {
            equals: patientName,
            mode: "insensitive"
          }
        },
        orderBy: { createdAt: "desc" }
      });
    }

    if (!claim) {
      claim = await prisma.claim.create({
        data: {
          patientName,
          payerName,
          amount: Number.isFinite(amount) && amount > 0 ? amount : 1,
          totalBilledAmount: Number.isFinite(amount) && amount > 0 ? amount : null,
          policyNo: extracted.policyNo || null,
          hospitalName: extracted.hospitalName || null,
          doctorName: extracted.doctorName || null,
          diagnosisText: extracted.diagnosisText || null,
          status: "DRAFT"
        }
      });
    } else {
      const updatePayload = {};

      if ((!claim.amount || claim.amount === 1) && amount > 1) {
        updatePayload.amount = amount;
        updatePayload.totalBilledAmount = amount;
      }

      if (!claim.policyNo && extracted.policyNo) {
        updatePayload.policyNo = extracted.policyNo;
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

      if (Object.keys(updatePayload).length > 0) {
        claim = await prisma.claim.update({
          where: { id: claim.id },
          data: updatePayload
        });
      }
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

    const updatedClaim = await prisma.claim.findUnique({
      where: { id: claim.id },
      include: {
        documents: {
          orderBy: { createdAt: "desc" }
        }
      }
    });

    res.status(201).json({
      message: "Document processed successfully",
      duplicate: false,
      claim: updatedClaim,
      document: doc
    });
  } catch (error) {
    console.error("Smart upload error:", error);
    res.status(500).json({
      error: "Document processing failed",
      message: error.message
    });
  }
});

  // Upload document
  router.post("/upload", upload.single("file"), async (req, res) => {
    const { claimId, type } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: "file is required" });
    }

    // Call AI analysis service
    const { analyzeDocument } = await import("../services/docIntel.js");
    const intel = await analyzeDocument({
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      path: req.file.filename
    });

    const doc = await prisma.document.create({
      data: {
        claimId: claimId || null, // Make claimId optional
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

  // Download doc
  router.get("/:id/download", async (req, res) => {
    try {
      const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
      if (!doc) return res.status(404).json({ error: "Doc not found" });

      console.log("Document from DB:", doc);
      
      // Safe file path resolution
      const baseUploadsPath = path.join(__dirname, "../uploads");
      const cleanPath = doc.path.includes("uploads")
        ? doc.path.replace(/^.*uploads[\\/]/, "")
        : doc.path;
      const filePath = path.join(baseUploadsPath, cleanPath);
      
      console.log("Resolved file path:", filePath);
      
      if (!fs.existsSync(filePath)) {
        console.error("File NOT found at:", filePath);
        return res.status(404).json({
          error: "File not found",
          path: filePath
        });
      }

      return res.download(filePath, doc.fileName);
    } catch (err) {
      console.error("Download error:", err);
      return res.status(500).json({
        error: "Failed to download document",
        details: err.message
      });
    }
  });

  // Preview doc
  router.get("/:id/preview", async (req, res) => {
    try {
      const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
      if (!doc) return res.status(404).json({ error: "Doc not found" });

      console.log("Document from DB:", doc);
      
      // Safe file path resolution
      const baseUploadsPath = path.join(__dirname, "../uploads");
      const cleanPath = doc.path.includes("uploads")
        ? doc.path.replace(/^.*uploads[\\/]/, "")
        : doc.path;
      const filePath = path.join(baseUploadsPath, cleanPath);
      
      console.log("Resolved file path:", filePath);
      
      if (!fs.existsSync(filePath)) {
        console.error("File NOT found at:", filePath);
        return res.status(404).json({
          error: "File not found",
          path: filePath
        });
      }

      // Set appropriate headers for inline preview
      res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${doc.fileName}"`);
      res.setHeader('Cache-Control', 'public, max-age=3600');

      // Use sendFile safely
      return res.sendFile(filePath);
    } catch (err) {
      console.error("Preview error:", err);
      return res.status(500).json({
        error: "Failed to preview document",
        details: err.message
      });
    }
  });

  // DELETE doc
  router.delete("/:id", async (req, res) => {
    try {
      const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
      if (!doc) return res.status(404).json({ error: "Doc not found" });

      console.log("Document from DB:", doc);
      
      // Build correct file path - doc.path should be just filename
      const filePath = path.join(__dirname, "../uploads", doc.path);
      console.log("Delete file path:", filePath);
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      await prisma.document.delete({ where: { id: doc.id } });

      res.json({ ok: true });
    } catch (err) {
      console.error("Delete error:", err);
      return res.status(500).json({
        error: "Failed to delete document"
      });
    }
  });

  // List all documents for user
  router.get("/list", async (req, res) => {
    try {
      const docs = await prisma.document.findMany({
        where: { claimId: { not: null } }, // Get documents for any claim, not just specific one
        orderBy: { createdAt: "desc" }
      });
      res.json(docs);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Process document with AI
  router.post("/:id/process", async (req, res) => {
    try {
      const doc = await prisma.document.findUnique({
        where: { id: req.params.id }
      });
      
      if (!doc) {
        return res.status(404).json({ error: "Document not found" });
      }

      console.log("Document from DB:", doc);
      
      // Build correct file path - doc.path should be just filename
      const filePath = path.join(__dirname, "../uploads", doc.path);
      console.log("Process file path:", filePath);
      
      if (!fs.existsSync(filePath)) {
        console.error("File not found for processing:", filePath);
        return res.status(404).json({
          error: "File not found on server",
          path: filePath
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

      res.json(updated);
    } catch (error) {
      console.error("Process error:", error);
      return res.status(500).json({
        error: "Failed to process document"
      });
    }
  });

  return router;
}
