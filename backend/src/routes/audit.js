import express from "express";
import { prisma } from "../db.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize || 25)));

  const where = {
    organizationId: req.user.organizationId
  };

  if (req.query.action) where.action = String(req.query.action);
  if (req.query.outcome) where.outcome = String(req.query.outcome);
  if (req.query.entityType) where.entityType = String(req.query.entityType);
  if (req.query.claimId) where.claimId = String(req.query.claimId);
  if (req.query.actorUserId) where.actorUserId = String(req.query.actorUserId);

  const [items, total] = await prisma.$transaction([
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        actorUser: {
          select: { id: true, email: true, role: true }
        }
      }
    }),
    prisma.auditEvent.count({ where })
  ]);

  res.json({
    items: items.map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      actor: item.actorUser,
      action: item.action,
      entityType: item.entityType,
      entityId: item.entityId,
      claimId: item.claimId,
      outcome: item.outcome,
      metadata: item.metadata || {}
    })),
    page,
    pageSize,
    total
  });
});

export default router;
