import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

export function documentsRouter(prisma, uploadDir) {
  const router = express.Router();

  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  // Test route
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

  // Upload document
  router.post("/upload", upload.single("file"), async (req, res) => {
    const { claimId, type } = req.body;
    if (!claimId || !type) {
      return res.status(400).json({ error: "claimId and type are required" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "file is required" });
    }

    const doc = await prisma.document.create({
      data: {
        claimId,
        type,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        path: req.file.filename
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
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: "Doc not found" });

    const fullPath = path.join(uploadDir, doc.path);
    res.download(fullPath, doc.fileName);
  });

  // DELETE doc
  router.delete("/:id", async (req, res) => {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: "Doc not found" });

    const fullPath = path.join(uploadDir, doc.path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

    await prisma.document.delete({ where: { id: doc.id } });

    res.json({ ok: true });
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

      // Call the AI analysis service
      const { analyzeDocument } = await import("../services/docIntel.js");
      const analysis = await analyzeDocument({
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        path: path.join(uploadDir, doc.path)
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
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
