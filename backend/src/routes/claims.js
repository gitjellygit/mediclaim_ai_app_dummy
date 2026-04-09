import express from "express";
import multer from "multer";
import { PrismaClient } from "@prisma/client";
import { analyzeDocument } from "../services/docIntel.js";
import { predictRejectionRisk } from "../services/riskModel.js";

const router = express.Router();
const prisma = new PrismaClient();
const upload = multer({ dest: "uploads/" });

// Debug endpoint to check database (no auth required)
router.get("/debug", async (req, res) => {
  try {
    console.log("=== DATABASE DEBUG ===");
    
    const claims = await prisma.claim.findMany();
    console.log("All claims:", claims.length);
    
    const documents = await prisma.document.findMany();
    console.log("All documents:", documents.length);
    
    const documentsWithClaimId = await prisma.document.findMany({
      where: { claimId: { not: null } }
    });
    console.log("Documents with claimId:", documentsWithClaimId.length);
    
    // Check specific claim
    if (claims.length > 0) {
      const firstClaim = await prisma.claim.findUnique({
        where: { id: claims[0].id },
        include: { documents: true }
      });
      console.log("First claim with documents:", firstClaim.documents.length);
    }
    
    res.json({
      claims: claims.length,
      documents: documents.length,
      documentsWithClaimId: documentsWithClaimId.length,
      sampleClaim: claims[0],
      sampleDocument: documents[0]
    });
  } catch (error) {
    console.error("Debug error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/", async (req, res) => {
  try {
    console.log("=== CLAIMS GET DEBUG ===");
    
    const claims = await prisma.claim.findMany({
      include: {
        documents: {
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: { createdAt: "desc" }
    });
    
    console.log("Raw claims from DB:", claims.length);
    
    // Log each claim with documents
    claims.forEach((claim, index) => {
      console.log(`Claim ${index + 1}:`, {
        id: claim.id,
        patientName: claim.patientName,
        documentsCount: claim.documents?.length || 0,
        documents: claim.documents
      });
    });
    
    console.log("=== END DEBUG ===");
    
    res.json(claims);
  } catch (error) {
    console.error("Error fetching claims:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id", async (req, res) => {
  const claim = await prisma.claim.findUnique({
    where: { id: req.params.id },
    include: {
      documents: true,
      checks: { orderBy: { createdAt: "desc" } }
    }
  });

  if (!claim) {
    return res.status(404).json({ error: "Claim not found" });
  }

  res.json(claim);
});

router.post("/", async (req, res) => {
  try {
    if (!req.body.patientName || !req.body.payerName) {
      return res.status(400).json({
        error: "patientName and payerName are required"
      });
    }

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: "amount must be a valid number greater than 0"
      });
    }

    const claim = await prisma.claim.create({
      data: {
        ...req.body,
        amount,
        totalBilledAmount: req.body.totalBilledAmount
          ? Number(req.body.totalBilledAmount)
          : null,
        status: "DRAFT"
      }
    });

    res.json(claim);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const payload = {
      patientName: req.body.patientName,
      payerName: req.body.payerName,
      policyNo: req.body.policyNo || null,
      hospitalName: req.body.hospitalName || null,
      diagnosisText: req.body.diagnosisText || null,
      claimType: req.body.claimType,
      icd10Codes: Array.isArray(req.body.icd10Codes) ? req.body.icd10Codes : [],
      amount: req.body.amount != null ? Number(req.body.amount) : undefined,
      totalBilledAmount:
        req.body.totalBilledAmount != null && req.body.totalBilledAmount !== ""
          ? Number(req.body.totalBilledAmount)
          : null
    };

    if (!payload.patientName) {
      return res.status(400).json({ error: "Patient name is required" });
    }

    if (!payload.payerName) {
      return res.status(400).json({ error: "Insurance company is required" });
    }

    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      return res.status(400).json({
        error: "Claimed amount must be a valid number greater than 0"
      });
    }

    if (
      payload.totalBilledAmount != null &&
      (!Number.isFinite(payload.totalBilledAmount) ||
        payload.amount > payload.totalBilledAmount)
    ) {
      return res.status(400).json({
        error: "Claimed amount cannot exceed billed amount"
      });
    }

    const updated = await prisma.claim.update({
      where: { id: req.params.id },
      data: payload,
      include: {
        documents: true,
        checks: { orderBy: { createdAt: "desc" } }
      }
    });

    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;

    await prisma.document.deleteMany({ where: { claimId: id } });
    await prisma.check.deleteMany({ where: { claimId: id } });
    await prisma.claim.delete({ where: { id } });

    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "Unable to delete claim" });
  }
});

router.post("/documents", upload.single("file"), async (req, res) => {
  try {
    const { claimId, type } = req.body;
    
    console.log("=== DOCUMENT UPLOAD DEBUG ===");
    console.log("req.body:", req.body);
    console.log("req.body.claimId:", req.body.claimId);
    console.log("claimId variable:", claimId);
    console.log("typeof claimId:", typeof claimId);
    console.log("type:", type);
    console.log("file:", req.file?.originalname);

    // Validate claim exists
    const claim = await prisma.claim.findUnique({
      where: { id: claimId }
    });
    
    console.log("Found claim:", claim);
    
    if (!claim) {
      console.log("ERROR: Claim not found!");
      return res.status(400).json({ 
        error: "Invalid claimId",
        message: `Claim with ID ${claimId} does not exist`
      });
    }

    const intel = await analyzeDocument({
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      path: req.file.path
    });

    console.log("Analysis result:", intel);

    // Create document linked to claim
    const doc = await prisma.document.create({
      data: {
        claimId: claimId,  // Ensure claimId is properly passed
        type,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        path: req.file.path,
        suggestedType: intel.suggestedType,
        confidence: intel.confidence,
        extracted: intel.extracted
      }
    });

    console.log("Created document with claimId:", doc.claimId);
    console.log("Full document object:", doc);
    console.log("=== END DEBUG ===");
    
    res.json(doc);
  } catch (e) {
    console.error("Document upload error:", e);
    res.status(400).json({ error: e.message });
  }
});

// Preview document
router.get("/:id/preview", async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id }
    });

    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Check if file exists and send it for preview
    const fs = require('fs');
    const filePath = doc.path;
    
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', doc.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${doc.fileName}"`);
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } else {
      res.status(404).json({ error: "File not found on server" });
    }
  } catch (error) {
    console.error("Preview error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Download document
router.get("/:id/download", async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id }
    });

    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Check if file exists and send it for download
    const fs = require('fs');
    const filePath = doc.path;
    
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', doc.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${doc.fileName}"`);
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } else {
      res.status(404).json({ error: "File not found on server" });
    }
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.delete("/documents/:id", async (req, res) => {
  try {
    await prisma.document.delete({
      where: { id: req.params.id }
    });

    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/:id/check", async (req, res) => {
  try {
    const claim = await prisma.claim.findUnique({
      where: { id: req.params.id },
      include: { documents: true }
    });

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    const issues = [];

    if (!claim.policyNo) {
      issues.push({
        severity: "BLOCK",
        message: "Policy number missing"
      });
    }

    if (!claim.icd10Codes?.length) {
      issues.push({
        severity: "WARN",
        message: "ICD-10 codes missing"
      });
    }

    if (!claim.documents?.length) {
      issues.push({
        severity: "BLOCK",
        message: "No supporting documents uploaded"
      });
    }

    let riskScore = 0;
    const riskFactors = [];

    if (!claim.policyNo) {
      riskScore += 0.25;
      riskFactors.push(
        "Claims without policy number historically show elevated rejection trends"
      );
    }

    if (!claim.icd10Codes?.length) {
      riskScore += 0.15;
      riskFactors.push(
        "Unstructured diagnosis increases manual review probability"
      );
    }

    if (
      claim.totalBilledAmount &&
      claim.amount &&
      Number(claim.amount) > Number(claim.totalBilledAmount)
    ) {
      riskScore += 0.3;
      riskFactors.push(
        "Claimed amount exceeds billed amount, increasing audit likelihood"
      );
    }

    if (issues.some((i) => i.severity === "BLOCK")) {
      riskScore += 0.1;
      riskFactors.push("Blocking compliance failures present");
    }

    riskScore = Math.min(riskScore, 0.95);

    const riskLevel =
      riskScore >= 0.6 ? "HIGH" : riskScore >= 0.3 ? "MED" : "LOW";

    let readinessScore = 100;
    issues.forEach((issue) => {
      if (issue.severity === "BLOCK") readinessScore -= 30;
      if (issue.severity === "WARN") readinessScore -= 10;
    });
    readinessScore = Math.max(readinessScore, 0);

    const hasBlock = issues.some((i) => i.severity === "BLOCK");

    const check = await prisma.check.create({
      data: {
        claimId: claim.id,
        score: readinessScore,
        riskScore,
        riskLevel,
        riskFactors,
        issues
      }
    });

    await prisma.claim.update({
      where: { id: claim.id },
      data: {
        status: !hasBlock && readinessScore >= 80 ? "READY" : "DRAFT"
      }
    });

    res.json(check);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * ✅ NEW: Submit claim
 * Rules:
 * - latest AI check must exist
 * - no BLOCK issues
 * - score >= 80
 * - status becomes SUBMITTED
 */
router.post("/:id/submit", async (req, res) => {
  try {
    const claim = await prisma.claim.findUnique({
      where: { id: req.params.id },
      include: {
        checks: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    });

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    const latestCheck = claim.checks?.[0];

    if (!latestCheck) {
      return res.status(400).json({
        error: "Run AI Check before submitting the claim"
      });
    }

    const issues = Array.isArray(latestCheck.issues) ? latestCheck.issues : [];
    const hasBlock = issues.some((i) => i.severity === "BLOCK");

    if (hasBlock) {
      return res.status(400).json({
        error: "Claim has blocking issues. Fix them before submission"
      });
    }

    if (latestCheck.score < 80) {
      return res.status(400).json({
        error: "Claim readiness score must be at least 80 to submit"
      });
    }

    if (claim.status === "SUBMITTED") {
      return res.status(400).json({
        error: "Claim is already submitted"
      });
    }

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        status: "SUBMITTED"
      },
      include: {
        documents: true,
        checks: { orderBy: { createdAt: "desc" } }
      }
    });

    res.json({
      success: true,
      message: "Claim submitted successfully",
      claim: updated
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;