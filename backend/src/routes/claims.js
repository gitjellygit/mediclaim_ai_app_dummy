import express from "express";
import multer from "multer";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { analyzeDocument } from "../services/docIntel.js";
import { predictRejectionRisk } from "../services/riskModel.js";

const router = express.Router();
const prisma = new PrismaClient();
const upload = multer({ dest: "uploads/" });

function cleanValue(value) {
  if (!value) return null;
  return String(value).trim();
}

function getExtractedPatientName(extracted) {
  return (
    cleanValue(extracted?.patientName) ||
    cleanValue(extracted?.patient_name) ||
    cleanValue(extracted?.name)
  );
}

function getExtractedAmount(extracted) {
  const raw =
    extracted?.amount ||
    extracted?.claimAmount ||
    extracted?.claim_amount ||
    extracted?.totalAmount ||
    extracted?.total_amount;

  if (!raw) return null;

  const amount = Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null;
}

async function invalidateClaimReadiness(claimId) {
  await prisma.$transaction([
    prisma.check.deleteMany({ where: { claimId } }),
    prisma.claim.update({
      where: { id: claimId },
      data: { status: "DRAFT" }
    })
  ]);
}

router.get("/debug", async (req, res) => {
  try {
    const claims = await prisma.claim.findMany();
    const documents = await prisma.document.findMany();

    res.json({
      claims: claims.length,
      documents: documents.length,
      sampleClaim: claims[0],
      sampleDocument: documents[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const claims = await prisma.claim.findMany({
      include: {
        documents: {
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: { createdAt: "desc" }
    });

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
    const existing = await prisma.claim.findUnique({
      where: { id: req.params.id }
    });

    if (!existing) {
      return res.status(404).json({ error: "Claim not found" });
    }

    if (existing.status === "SUBMITTED") {
      return res.status(409).json({
        error: "Submitted claims are locked. Reopen or amend the claim before editing."
      });
    }

    const payload = {
      patientName: req.body.patientName,
      payerName: req.body.payerName,
      policyNo: req.body.policyNo || null,
      hospitalName: req.body.hospitalName || null,
      diagnosisText: req.body.diagnosisText || null,
      claimType: req.body.claimType,
      icd10Codes: Array.isArray(req.body.icd10Codes)
        ? req.body.icd10Codes
        : [],
      amount: req.body.amount != null && req.body.amount !== ""
        ? Number(req.body.amount)
        : null,
      totalBilledAmount:
        req.body.totalBilledAmount != null &&
        req.body.totalBilledAmount !== ""
          ? Number(req.body.totalBilledAmount)
          : null
    };

    if (!payload.patientName) {
      return res.status(400).json({ error: "Patient name is required" });
    }

    if (!payload.payerName) {
      return res.status(400).json({ error: "Insurance company is required" });
    }

    if (
      payload.amount != null &&
      (!Number.isFinite(payload.amount) || payload.amount <= 0)
    ) {
      return res.status(400).json({
        error: "Claimed amount must be a valid number greater than 0"
      });
    }

    await prisma.$transaction([
      prisma.check.deleteMany({ where: { claimId: req.params.id } }),
      prisma.claim.update({
        where: { id: req.params.id },
        data: {
          ...payload,
          status: "DRAFT"
        }
      })
    ]);

    const updated = await prisma.claim.findUnique({
      where: { id: req.params.id },
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

    const claim = await prisma.claim.findUnique({ where: { id } });
    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    if (claim.status === "SUBMITTED") {
      return res.status(409).json({
        error: "Submitted claims are locked and cannot be permanently deleted."
      });
    }

    const documents = await prisma.document.findMany({
      where: { claimId: id }
    });

    for (const doc of documents) {
      if (doc.path && fs.existsSync(doc.path)) {
        fs.unlinkSync(doc.path);
      }
    }

    await prisma.document.deleteMany({ where: { claimId: id } });
    await prisma.check.deleteMany({ where: { claimId: id } });
    await prisma.claim.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    console.error("Delete claim error:", error);
    res.status(400).json({ error: "Unable to delete claim" });
  }
});

router.post("/documents", upload.single("file"), async (req, res) => {
  try {
    const { claimId, type } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "File is required" });
    }

    const claim = await prisma.claim.findUnique({
      where: { id: claimId }
    });

    if (!claim) {
      return res.status(400).json({
        error: "Invalid claimId",
        message: `Claim with ID ${claimId} does not exist`
      });
    }

    if (claim.status === "SUBMITTED") {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(409).json({
        error: "Submitted claims are locked. Documents cannot be added."
      });
    }

    const intel = await analyzeDocument({
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      path: req.file.path
    });

    const doc = await prisma.document.create({
      data: {
        claimId,
        type: type || intel.suggestedType || "OTHER",
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        path: req.file.path,
        suggestedType: intel.suggestedType,
        confidence: intel.confidence,
        extracted: intel.extracted,
        status: "PROCESSED"
      }
    });

    const extractedPatientName = getExtractedPatientName(intel.extracted);
    const extractedAmount = getExtractedAmount(intel.extracted);

    const updatePayload = {};

    if (
      extractedPatientName &&
      (!claim.patientName ||
        claim.patientName === "Unknown Patient" ||
        claim.patientName.trim() === "")
    ) {
      updatePayload.patientName = extractedPatientName;
    }

    if (extractedAmount && (!claim.amount || Number(claim.amount) <= 0)) {
      updatePayload.amount = extractedAmount;
      if ((type || intel.suggestedType) === "FINAL_BILL") {
        updatePayload.totalBilledAmount = extractedAmount;
      }
    }

    let updatedClaim = claim;

    if (Object.keys(updatePayload).length > 0) {
      updatedClaim = await prisma.claim.update({
        where: { id: claimId },
        data: updatePayload,
        include: {
          documents: {
            orderBy: { createdAt: "desc" }
          }
        }
      });
    }

    await invalidateClaimReadiness(claimId);

    updatedClaim = await prisma.claim.findUnique({
      where: { id: claimId },
      include: {
        documents: { orderBy: { createdAt: "desc" } },
        checks: { orderBy: { createdAt: "desc" } }
      }
    });

    res.json({
      ...doc,
      claim: updatedClaim
    });
  } catch (e) {
    console.error("Document upload error:", e);
    res.status(400).json({ error: e.message });
  }
});

router.get("/:id/preview", async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id }
    });

    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (!fs.existsSync(doc.path)) {
      return res.status(404).json({ error: "File not found on server" });
    }

    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${doc.fileName}"`);

    fs.createReadStream(doc.path).pipe(res);
  } catch (error) {
    console.error("Preview error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id/download", async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id }
    });

    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (!fs.existsSync(doc.path)) {
      return res.status(404).json({ error: "File not found on server" });
    }

    res.download(doc.path, doc.fileName);
  } catch (error) {
    console.error("Download error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.delete("/documents/:id", async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: { claim: true }
    });

    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (doc.claim?.status === "SUBMITTED") {
      return res.status(409).json({
        error: "Submitted claims are locked. Documents cannot be deleted."
      });
    }

    if (doc.path && fs.existsSync(doc.path)) {
      fs.unlinkSync(doc.path);
    }

    await prisma.$transaction([
      prisma.document.delete({ where: { id: req.params.id } }),
      prisma.check.deleteMany({ where: { claimId: doc.claimId } }),
      prisma.claim.update({
        where: { id: doc.claimId },
        data: { status: "DRAFT" }
      })
    ]);

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

    if (claim.status === "SUBMITTED") {
      return res.status(409).json({
        error: "Submitted claims are locked. Reopen the claim before running a new AI check."
      });
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

    if (!claim.amount || Number(claim.amount) <= 0) {
      issues.push({
        severity: "BLOCK",
        message: "Claimed amount missing or invalid"
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

router.post("/documents/bulk-delete", async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids array required" });
    }

    const docs = await prisma.document.findMany({
      where: { id: { in: ids } },
      include: { claim: true }
    });

    if (docs.some((doc) => doc.claim?.status === "SUBMITTED")) {
      return res.status(409).json({
        error: "Submitted claims are locked. Their documents cannot be deleted."
      });
    }

    const claimIds = [...new Set(docs.map((doc) => doc.claimId))];

    for (const doc of docs) {
      if (doc.path && fs.existsSync(doc.path)) {
        fs.unlinkSync(doc.path);
      }
    }

    await prisma.$transaction([
      prisma.document.deleteMany({ where: { id: { in: ids } } }),
      prisma.check.deleteMany({ where: { claimId: { in: claimIds } } }),
      prisma.claim.updateMany({
        where: { id: { in: claimIds } },
        data: { status: "DRAFT" }
      })
    ]);

    res.json({ success: true, deleted: docs.length });
  } catch (e) {
    console.error("Bulk delete error:", e);
    res.status(500).json({ error: e.message });
  }
});

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

    const issues = Array.isArray(latestCheck.issues)
      ? latestCheck.issues
      : [];

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
        status: "SUBMITTED",
        claimSubmissionDate: new Date()
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