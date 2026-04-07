import express from "express";
import multer from "multer";
import { PrismaClient } from "@prisma/client";
import { analyzeDocument } from "../services/docIntel.js";
import { predictRejectionRisk } from "../services/riskModel.js";

const router = express.Router();
const prisma = new PrismaClient();
const upload = multer({ dest: "uploads/" });

router.get("/", async (req, res) => {
  const claims = await prisma.claim.findMany({
    orderBy: { createdAt: "desc" }
  });
  res.json(claims);
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

    const intel = await analyzeDocument({
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      path: req.file.path
    });

    const doc = await prisma.document.create({
      data: {
        claimId: claimId || null, // Make claimId optional
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

    res.json(doc);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/documents/:id/apply-suggestion", async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({
      where: { id: req.params.id }
    });

    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (!doc.suggestedType) {
      return res.status(400).json({ error: "No suggested type available" });
    }

    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: { type: doc.suggestedType }
    });

    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
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