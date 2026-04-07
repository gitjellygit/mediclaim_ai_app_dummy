import express from "express";
import { runChecks } from "../services/checkEngine.js";

export function checksRouter(prisma) {
  const router = express.Router();

  router.post("/run/:claimId", async (req, res) => {
    const claimId = req.params.claimId;

    const claim = await prisma.claim.findUnique({ where: { id: claimId } });
    if (!claim) return res.status(404).json({ error: "Claim not found" });

    const documents = await prisma.document.findMany({ where: { claimId } });
    const rules = await prisma.rule.findMany();

    const result = await runChecks({ claim, documents, rules });

    const saved = await prisma.check.create({
      data: { claimId, score: result.score, issues: result.issues }
    });

    res.json(saved);
  });

  return router;
}
