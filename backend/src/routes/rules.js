import express from "express";
import { prisma } from "../db.js";

const router = express.Router();

function orgId(req) {
  return req.user.organizationId;
}

/**
 * Get all rules - scoped to caller's organization
 */
router.get("/", async (req, res) => {
  const rules = await prisma.rule.findMany({
    where: { organizationId: orgId(req) },
    orderBy: { createdAt: "desc" }
  });
  res.json(rules);
});

/**
 * Get single rule - scoped to caller's organization
 */
router.get("/:id", async (req, res) => {
  const rule = await prisma.rule.findFirst({
    where: { id: req.params.id, organizationId: orgId(req) }
  });
  if (!rule) {
    return res.status(404).json({ error: "Rule not found" });
  }
  res.json(rule);
});

/**
 * Create rule - scoped to caller's organization
 */
router.post("/", async (req, res) => {
  const { code, name, severity } = req.body;

  if (!code || !name) {
    return res.status(400).json({ error: "code and name required" });
  }

  try {
    const rule = await prisma.rule.create({
      data: {
        organizationId: orgId(req),
        code,
        name,
        severity: severity || "WARN"
      }
    });
    res.json(rule);
  } catch (e) {
    if (e?.code === "P2002") {
      return res.status(409).json({ error: "Rule code already exists in your organization" });
    }
    res.status(400).json({ error: "Failed to create rule" });
  }
});

/**
 * Update rule - scoped to caller's organization
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

  const existing = await prisma.rule.findFirst({
    where: { id: req.params.id, organizationId: orgId(req) }
  });

  if (!existing) {
    return res.status(404).json({ error: "Rule not found" });
  }

  try {
    const rule = await prisma.rule.update({
      where: { id: existing.id },
      data
    });
    res.json(rule);
  } catch (e) {
    if (e?.code === "P2002") {
      return res.status(409).json({ error: "Rule code already exists in your organization" });
    }
    res.status(500).json({ error: "Unable to update rule" });
  }
});

/**
 * Delete rule - scoped to caller's organization
 */
router.delete("/:id", async (req, res) => {
  try {
    const deleted = await prisma.rule.deleteMany({
      where: { id: req.params.id, organizationId: orgId(req) }
    });
    if (deleted.count === 0) {
      return res.status(404).json({ error: "Rule not found" });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Unable to delete rule" });
  }
});

export default router;
