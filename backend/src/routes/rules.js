import express from "express";
import { prisma } from "../db.js";

const router = express.Router();

/**
 * Get all rules
 */
router.get("/", async (req, res) => {
  const rules = await prisma.rule.findMany({
    orderBy: { createdAt: "desc" }
  });
  res.json(rules);
});

/**
 * Get single rule
 */
router.get("/:id", async (req, res) => {
  const rule = await prisma.rule.findUnique({
    where: { id: req.params.id }
  });
  if (!rule) {
    return res.status(404).json({ error: "Rule not found" });
  }
  res.json(rule);
});

/**
 * Create rule
 */
router.post("/", async (req, res) => {
  const { code, name, severity } = req.body;

  if (!code || !name) {
    return res.status(400).json({ error: "code and name required" });
  }

  try {
    const rule = await prisma.rule.create({
      data: {
        code,
        name,
        severity: severity || "WARN"
      }
    });
    res.json(rule);
  } catch (e) {
    res.status(400).json({ error: "Rule already exists" });
  }
});

/**
 * Update rule
 */
router.patch("/:id", async (req, res) => {
  const { enabled, severity, name, code } = req.body;

  const data = {};
  if (enabled !== undefined) data.enabled = enabled;
  if (severity !== undefined) data.severity = severity;
  if (name !== undefined) data.name = name;
  if (code !== undefined) data.code = code;

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "No fields to update" });
  }

  try {
    const rule = await prisma.rule.update({
      where: { id: req.params.id },
      data
    });
    res.json(rule);
  } catch (e) {
    res.status(e?.code === "P2025" ? 404 : e?.code === "P2002" ? 409 : 500).json({ error: e?.code === "P2025" ? "Rule not found" : e?.code === "P2002" ? "Rule already exists" : "Unable to update rule" });
  }
});

/**
 * Delete rule
 */
router.delete("/:id", async (req, res) => {
  await prisma.rule.delete({
    where: { id: req.params.id }
  });

  res.json({ success: true });
});

export default router;
