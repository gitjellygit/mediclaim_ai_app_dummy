import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { PERMISSIONS, hasPermission } from "../security/permissions.js";
import { generateSecureToken, hashPassword } from "../utils/security.js";
import {
  writeCriticalRequestAudit,
  writeRequestAudit
} from "../services/auditLog.js";

const router = express.Router();
const orgId = (req) => req.user.organizationId;

const ROLE_TEMPLATES = Object.freeze([
  "ADMIN",
  "CLAIMS_MANAGER",
  "CLAIMS_SPECIALIST",
  "DENIAL_SPECIALIST",
  "PRIOR_AUTH_SPECIALIST",
  "ACCOUNTANT",
  "CLINICAL_REVIEWER",
  "RECEPTIONIST",
  "AUDITOR",
  "PROVIDER",
  "CASHIER"
]);

const MANAGER_ROLES = new Set(["ADMIN", "CLAIMS_MANAGER"]);
const PRIORITIES = new Set(["NORMAL", "HIGH", "URGENT"]);
const CLINICAL_TYPES = new Set([
  "MISSING_DOCUMENTATION",
  "DIAGNOSIS_CLARIFICATION",
  "PROCEDURE_JUSTIFICATION",
  "MEDICAL_NECESSITY",
  "OPERATIVE_NOTE",
  "PROGRESS_NOTE",
  "SIGNATURE_ATTESTATION",
  "PRIOR_AUTH_EVIDENCE",
  "OTHER"
]);

function managerOnly(req, res, next) {
  if (!MANAGER_ROLES.has(String(req.user?.role || ""))) {
    return res.status(403).json({ error: "Manager permission required" });
  }
  next();
}

async function claimFor(req, claimId) {
  return prisma.claim.findFirst({
    where: { id: claimId, organizationId: orgId(req), deletedAt: null }
  });
}

async function userFor(req, userId) {
  if (!userId) return null;
  return prisma.user.findFirst({
    where: { id: userId, organizationId: orgId(req) },
    select: { id: true, email: true, displayName: true, role: true, status: true, teamId: true }
  });
}

async function notify(tx, req, userId, payload) {
  if (!userId || userId === req.user.id) return;
  await tx.notification.create({
    data: {
      organizationId: orgId(req),
      userId,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      claimId: payload.claimId || null
    }
  });
}

router.get("/roles", requirePermission(PERMISSIONS.USER_ADMIN), (_req, res) => {
  res.json({ items: ROLE_TEMPLATES });
});

router.get("/users", requirePermission(PERMISSIONS.USER_ADMIN), async (req, res) => {
  const items = await prisma.user.findMany({
    where: { organizationId: orgId(req) },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      teamId: true,
      lastLoginAt: true,
      createdAt: true,
      team: { select: { id: true, name: true } },
      _count: { select: { assignedClaims: true } }
    },
    orderBy: [{ status: "asc" }, { email: "asc" }]
  });
  res.json({ items });
});

router.post("/users/invite", requirePermission(PERMISSIONS.USER_ADMIN), async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    displayName: z.string().trim().min(1).max(120).nullable().optional(),
    role: z.enum(ROLE_TEMPLATES),
    teamId: z.string().trim().min(1).max(100).nullable().optional()
  }).strict();
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid user invitation" });

  const email = parsed.data.email.toLowerCase().trim();
  if (await prisma.user.findUnique({ where: { email } })) {
    return res.status(409).json({ error: "A user with this email already exists" });
  }

  if (parsed.data.teamId) {
    const team = await prisma.team.findFirst({
      where: { id: parsed.data.teamId, organizationId: orgId(req), active: true }
    });
    if (!team) return res.status(400).json({ error: "Team not found" });
  }

  const setupToken = generateSecureToken(64);
  const tokenHash = crypto.createHash("sha256").update(setupToken).digest("hex");
  const unusablePassword = generateSecureToken(48);
  const passwordHash = await hashPassword(unusablePassword);
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        organizationId: orgId(req),
        email,
        displayName: parsed.data.displayName || null,
        role: parsed.data.role,
        teamId: parsed.data.teamId || null,
        status: "INVITED",
        passwordHash
      },
      select: { id: true, email: true, displayName: true, role: true, status: true, teamId: true }
    });
    await tx.userInvite.create({
      data: { userId: created.id, tokenHash, expiresAt }
    });
    await writeCriticalRequestAudit(tx, req, {
      action: "USER_INVITED",
      entityType: "User",
      entityId: created.id,
      metadata: { operation: "invite", status: "INVITED" }
    });
    return created;
  });

  res.status(201).json({
    user,
    setupToken,
    expiresAt,
    note: "The setup token is shown once. The invited user chooses their own password."
  });
});

router.patch("/users/:id", requirePermission(PERMISSIONS.USER_ADMIN), async (req, res) => {
  const schema = z.object({
    displayName: z.string().trim().max(120).nullable().optional(),
    role: z.enum(ROLE_TEMPLATES).optional(),
    teamId: z.string().trim().min(1).max(100).nullable().optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional()
  }).strict();
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid user update" });

  const existing = await userFor(req, req.params.id);
  if (!existing) return res.status(404).json({ error: "User not found" });

  if (parsed.data.teamId) {
    const team = await prisma.team.findFirst({
      where: { id: parsed.data.teamId, organizationId: orgId(req), active: true }
    });
    if (!team) return res.status(400).json({ error: "Team not found" });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: existing.id },
      data: parsed.data,
      select: {
        id: true, email: true, displayName: true, role: true, status: true, teamId: true,
        team: { select: { id: true, name: true } }
      }
    });
    if (parsed.data.status === "SUSPENDED") {
      await tx.refreshToken.updateMany({
        where: { userId: existing.id, revoked: false },
        data: { revoked: true, revokedAt: new Date() }
      });
    }
    await writeCriticalRequestAudit(tx, req, {
      action: "USER_ADMIN_UPDATED",
      entityType: "User",
      entityId: existing.id,
      metadata: { operation: "update", status: user.status }
    });
    return user;
  });
  res.json(updated);
});

router.get("/teams", requirePermission(PERMISSIONS.CLAIM_VIEW), async (req, res) => {
  const items = await prisma.team.findMany({
    where: { organizationId: orgId(req), active: true },
    include: { _count: { select: { users: true } } },
    orderBy: { name: "asc" }
  });
  res.json({ items });
});

router.post("/teams", requirePermission(PERMISSIONS.USER_ADMIN), async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullable().optional()
  }).strict();
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid team" });
  const team = await prisma.team.create({
    data: { organizationId: orgId(req), name: parsed.data.name, description: parsed.data.description || null }
  });
  await writeCriticalRequestAudit(prisma, req, {
    action: "TEAM_CREATED", entityType: "Team", entityId: team.id, metadata: { operation: "create" }
  });
  res.status(201).json(team);
});

router.post("/claims/bulk-work", requirePermission(PERMISSIONS.CLAIM_EDIT), async (req, res) => {
  const schema = z.object({
    claimIds: z.array(z.string().min(1)).min(1).max(200),
    assignedToUserId: z.string().nullable().optional(),
    workTeam: z.string().trim().max(100).nullable().optional(),
    managerPriority: z.enum(["NORMAL", "HIGH", "URGENT"]).nullable().optional(),
    managerPriorityReason: z.string().trim().max(500).nullable().optional(),
    nextFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
    holdReason: z.string().trim().max(500).nullable().optional(),
    holdUntil: z.string().datetime({ offset: true }).nullable().optional(),
    escalated: z.boolean().optional()
  }).strict();
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid bulk work update" });

  if (parsed.data.managerPriority && parsed.data.managerPriority !== "NORMAL" && !parsed.data.managerPriorityReason) {
    return res.status(400).json({ error: "A reason is required for High or Urgent manager priority" });
  }
  if (parsed.data.managerPriority && !MANAGER_ROLES.has(String(req.user.role))) {
    return res.status(403).json({ error: "Only a claims manager or admin can override priority" });
  }

  const claims = await prisma.claim.findMany({
    where: { id: { in: parsed.data.claimIds }, organizationId: orgId(req), deletedAt: null }
  });
  if (claims.length !== new Set(parsed.data.claimIds).size) {
    return res.status(404).json({ error: "One or more claims were not found in this organization" });
  }

  const assignee = parsed.data.assignedToUserId
    ? await userFor(req, parsed.data.assignedToUserId)
    : null;
  if (parsed.data.assignedToUserId && (!assignee || assignee.status !== "ACTIVE")) {
    return res.status(400).json({ error: "Assignee must be an active user in this organization" });
  }

  await prisma.$transaction(async (tx) => {
    for (const claim of claims) {
      const data = {
        lastWorkedAt: new Date(),
        ...(Object.hasOwn(parsed.data, "assignedToUserId") ? { assignedToUserId: parsed.data.assignedToUserId } : {}),
        ...(Object.hasOwn(parsed.data, "workTeam") ? { workTeam: parsed.data.workTeam || null } : {}),
        ...(Object.hasOwn(parsed.data, "managerPriority") ? {
          managerPriority: parsed.data.managerPriority || null,
          managerPriorityReason: parsed.data.managerPriorityReason || null
        } : {}),
        ...(Object.hasOwn(parsed.data, "nextFollowUpAt") ? {
          nextFollowUpAt: parsed.data.nextFollowUpAt ? new Date(parsed.data.nextFollowUpAt) : null
        } : {}),
        ...(Object.hasOwn(parsed.data, "holdReason") ? { holdReason: parsed.data.holdReason || null } : {}),
        ...(Object.hasOwn(parsed.data, "holdUntil") ? {
          holdUntil: parsed.data.holdUntil ? new Date(parsed.data.holdUntil) : null
        } : {}),
        ...(Object.hasOwn(parsed.data, "escalated") ? {
          escalatedAt: parsed.data.escalated ? new Date() : null
        } : {})
      };
      await tx.claim.update({ where: { id: claim.id }, data });
      await tx.claimOwnershipHistory.create({
        data: {
          organizationId: orgId(req),
          claimId: claim.id,
          changedByUserId: req.user.id,
          previousAssigneeUserId: claim.assignedToUserId,
          newAssigneeUserId: Object.hasOwn(parsed.data, "assignedToUserId") ? parsed.data.assignedToUserId : claim.assignedToUserId,
          previousTeam: claim.workTeam,
          newTeam: Object.hasOwn(parsed.data, "workTeam") ? parsed.data.workTeam : claim.workTeam,
          previousPriority: claim.managerPriority,
          newPriority: Object.hasOwn(parsed.data, "managerPriority") ? parsed.data.managerPriority : claim.managerPriority,
          reason: parsed.data.managerPriorityReason || parsed.data.holdReason || null
        }
      });
      if (parsed.data.assignedToUserId) {
        await notify(tx, req, parsed.data.assignedToUserId, {
          type: "CLAIM_ASSIGNED",
          title: "Claim assigned to you",
          message: parsed.data.managerPriority === "URGENT" ? "An urgent claim was assigned to you." : "A claim was assigned to your work queue.",
          claimId: claim.id
        });
      }
    }
    await writeCriticalRequestAudit(tx, req, {
      action: "CLAIM_BULK_WORK_UPDATED",
      entityType: "Claim",
      metadata: {
        count: claims.length,
        operation: "bulk_work",
        reason: parsed.data.managerPriorityReason || parsed.data.holdReason || null
      }
    });
  });

  res.json({ updated: claims.length });
});

router.get("/claims/:id/comments", requirePermission(PERMISSIONS.CLAIM_VIEW), async (req, res) => {
  const claim = await claimFor(req, req.params.id);
  if (!claim) return res.status(404).json({ error: "Claim not found" });
  const items = await prisma.claimComment.findMany({
    where: { organizationId: orgId(req), claimId: claim.id },
    include: { authorUser: { select: { id: true, email: true, displayName: true, role: true } } },
    orderBy: { createdAt: "asc" }
  });
  res.json({ items });
});

router.post("/claims/:id/comments", requirePermission(PERMISSIONS.CLAIM_EDIT), async (req, res) => {
  const schema = z.object({
    body: z.string().trim().min(1).max(4000),
    mentionUserIds: z.array(z.string().min(1)).max(20).default([])
  }).strict();
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid comment" });
  const claim = await claimFor(req, req.params.id);
  if (!claim) return res.status(404).json({ error: "Claim not found" });

  const mentions = parsed.data.mentionUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: parsed.data.mentionUserIds }, organizationId: orgId(req), status: "ACTIVE" },
        select: { id: true }
      })
    : [];
  if (mentions.length !== new Set(parsed.data.mentionUserIds).size) {
    return res.status(400).json({ error: "All mentioned users must belong to this organization" });
  }

  const item = await prisma.$transaction(async (tx) => {
    const comment = await tx.claimComment.create({
      data: {
        organizationId: orgId(req), claimId: claim.id, authorUserId: req.user.id,
        body: parsed.data.body, mentionUserIds: parsed.data.mentionUserIds
      },
      include: { authorUser: { select: { id: true, email: true, displayName: true, role: true } } }
    });
    for (const mentioned of mentions) {
      await notify(tx, req, mentioned.id, {
        type: "MENTION",
        title: "You were mentioned on a claim",
        message: "A teammate mentioned you in an operational claim comment.",
        claimId: claim.id
      });
    }
    await writeRequestAudit(tx, req, {
      claimId: claim.id, action: "CLAIM_COMMENT_ADDED", entityType: "ClaimComment",
      entityId: comment.id, metadata: { count: parsed.data.mentionUserIds.length }
    });
    return comment;
  });
  res.status(201).json(item);
});

router.get("/clinical-requests", requirePermission(PERMISSIONS.CLINICAL_VIEW), async (req, res) => {
  const where = { organizationId: orgId(req) };
  if (req.query.mine === "true") where.assignedToUserId = req.user.id;
  if (req.query.status) where.status = String(req.query.status).toUpperCase();
  const items = await prisma.clinicalRequest.findMany({
    where,
    include: {
      claim: { select: { id: true, patientName: true, payerName: true, amount: true } },
      requestedByUser: { select: { email: true, displayName: true } },
      assignedToUser: { select: { email: true, displayName: true } }
    },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }]
  });
  res.json({ items });
});

router.post("/clinical-requests", requirePermission(PERMISSIONS.CLAIM_EDIT), async (req, res) => {
  const schema = z.object({
    claimId: z.string().min(1),
    assignedToUserId: z.string().min(1).nullable().optional(),
    requestType: z.string().refine((v) => CLINICAL_TYPES.has(v)),
    requestText: z.string().trim().min(3).max(2000),
    dueAt: z.string().datetime({ offset: true }).nullable().optional()
  }).strict();
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid clinical request" });
  const claim = await claimFor(req, parsed.data.claimId);
  if (!claim) return res.status(404).json({ error: "Claim not found" });
  const assignee = parsed.data.assignedToUserId ? await userFor(req, parsed.data.assignedToUserId) : null;
  if (parsed.data.assignedToUserId && !assignee) return res.status(400).json({ error: "Clinical assignee not found" });

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.clinicalRequest.create({
      data: {
        organizationId: orgId(req), claimId: claim.id, requestedByUserId: req.user.id,
        assignedToUserId: parsed.data.assignedToUserId || null,
        requestType: parsed.data.requestType, requestText: parsed.data.requestText,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null
      }
    });
    await notify(tx, req, parsed.data.assignedToUserId, {
      type: "CLINICAL_REQUEST",
      title: "Clinical information requested",
      message: "A claims team member needs clinical information for a claim.",
      claimId: claim.id
    });
    await writeCriticalRequestAudit(tx, req, {
      claimId: claim.id, action: "CLINICAL_REQUEST_CREATED",
      entityType: "ClinicalRequest", entityId: created.id,
      metadata: { category: parsed.data.requestType, status: "OPEN" }
    });
    return created;
  });
  res.status(201).json(item);
});

router.patch("/clinical-requests/:id/respond", requirePermission(PERMISSIONS.CLINICAL_EDIT), async (req, res) => {
  const schema = z.object({
    responseText: z.string().trim().min(1).max(4000),
    status: z.enum(["RESPONDED", "UNABLE_TO_COMPLETE"]).default("RESPONDED")
  }).strict();
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid clinical response" });
  const existing = await prisma.clinicalRequest.findFirst({
    where: { id: req.params.id, organizationId: orgId(req) }
  });
  if (!existing) return res.status(404).json({ error: "Clinical request not found" });
  if (existing.assignedToUserId && existing.assignedToUserId !== req.user.id && !MANAGER_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: "This clinical request is assigned to another user" });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.clinicalRequest.update({
      where: { id: existing.id },
      data: {
        responseText: parsed.data.responseText,
        status: parsed.data.status,
        resolvedAt: new Date()
      }
    });
    await notify(tx, req, existing.requestedByUserId, {
      type: "CLINICAL_RESPONSE",
      title: "Clinical request updated",
      message: "The clinical team responded to your request.",
      claimId: existing.claimId
    });
    await writeCriticalRequestAudit(tx, req, {
      claimId: existing.claimId, action: "CLINICAL_REQUEST_RESPONDED",
      entityType: "ClinicalRequest", entityId: existing.id,
      metadata: { status: item.status }
    });
    return item;
  });
  res.json(updated);
});

router.get("/saved-queues", requirePermission(PERMISSIONS.CLAIM_VIEW), async (req, res) => {
  const items = await prisma.savedQueue.findMany({
    where: {
      organizationId: orgId(req),
      OR: [
        { ownerUserId: req.user.id },
        { sharedWithTeam: true }
      ]
    },
    orderBy: { updatedAt: "desc" }
  });
  res.json({ items });
});

router.post("/saved-queues", requirePermission(PERMISSIONS.CLAIM_VIEW), async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(1).max(100),
    filters: z.record(z.any()),
    sharedWithTeam: z.boolean().default(false)
  }).strict();
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid saved queue" });
  const item = await prisma.savedQueue.create({
    data: { organizationId: orgId(req), ownerUserId: req.user.id, ...parsed.data }
  });
  res.status(201).json(item);
});

router.delete("/saved-queues/:id", requirePermission(PERMISSIONS.CLAIM_VIEW), async (req, res) => {
  const existing = await prisma.savedQueue.findFirst({
    where: { id: req.params.id, organizationId: orgId(req), ownerUserId: req.user.id }
  });
  if (!existing) return res.status(404).json({ error: "Saved queue not found" });
  await prisma.savedQueue.delete({ where: { id: existing.id } });
  res.json({ success: true });
});

router.get("/notifications", requirePermission(PERMISSIONS.CLAIM_VIEW), async (req, res) => {
  const items = await prisma.notification.findMany({
    where: { organizationId: orgId(req), userId: req.user.id },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  const unread = items.filter((item) => !item.readAt).length;
  res.json({ items, unread });
});

router.patch("/notifications/:id/read", requirePermission(PERMISSIONS.CLAIM_VIEW), async (req, res) => {
  const existing = await prisma.notification.findFirst({
    where: { id: req.params.id, organizationId: orgId(req), userId: req.user.id }
  });
  if (!existing) return res.status(404).json({ error: "Notification not found" });
  const item = await prisma.notification.update({
    where: { id: existing.id },
    data: { readAt: existing.readAt || new Date() }
  });
  res.json(item);
});

router.get("/approvals", managerOnly, async (req, res) => {
  const items = await prisma.approvalRequest.findMany({
    where: { organizationId: orgId(req), ...(req.query.status ? { status: String(req.query.status).toUpperCase() } : {}) },
    include: {
      claim: { select: { id: true, patientName: true, payerName: true, amount: true } },
      requestedByUser: { select: { email: true, displayName: true } },
      reviewedByUser: { select: { email: true, displayName: true } }
    },
    orderBy: { createdAt: "desc" }
  });
  res.json({ items });
});

router.post("/approvals", requirePermission(PERMISSIONS.CLAIM_EDIT), async (req, res) => {
  const schema = z.object({
    claimId: z.string().min(1),
    requestType: z.enum(["WRITE_OFF", "LARGE_ADJUSTMENT", "CLOSE_RECOVERY", "ABANDON_APPEAL", "EXCEPTION_OVERRIDE"]),
    amount: z.number().nonnegative().nullable().optional(),
    reason: z.string().trim().min(3).max(2000)
  }).strict();
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid approval request" });
  const claim = await claimFor(req, parsed.data.claimId);
  if (!claim) return res.status(404).json({ error: "Claim not found" });
  const item = await prisma.approvalRequest.create({
    data: {
      organizationId: orgId(req), claimId: claim.id, requestedByUserId: req.user.id,
      requestType: parsed.data.requestType, amount: parsed.data.amount ?? null, reason: parsed.data.reason
    }
  });
  res.status(201).json(item);
});

router.patch("/approvals/:id/decision", managerOnly, async (req, res) => {
  const schema = z.object({
    decision: z.enum(["APPROVED", "REJECTED", "RETURNED"]),
    reason: z.string().trim().max(2000).nullable().optional()
  }).strict();
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid approval decision" });
  const existing = await prisma.approvalRequest.findFirst({
    where: { id: req.params.id, organizationId: orgId(req), status: "PENDING" }
  });
  if (!existing) return res.status(404).json({ error: "Pending approval request not found" });
  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.approvalRequest.update({
      where: { id: existing.id },
      data: {
        status: parsed.data.decision,
        decisionReason: parsed.data.reason || null,
        reviewedByUserId: req.user.id,
        reviewedAt: new Date()
      }
    });
    await notify(tx, req, existing.requestedByUserId, {
      type: "APPROVAL_DECISION",
      title: "Approval request updated",
      message: `Your ${existing.requestType.toLowerCase().replaceAll("_", " ")} request was ${parsed.data.decision.toLowerCase()}.`,
      claimId: existing.claimId
    });
    await writeCriticalRequestAudit(tx, req, {
      claimId: existing.claimId, action: "APPROVAL_REQUEST_DECIDED",
      entityType: "ApprovalRequest", entityId: existing.id,
      metadata: { status: parsed.data.decision, operation: "decision" }
    });
    return item;
  });
  res.json(updated);
});

router.get("/workload", managerOnly, async (req, res) => {
  const now = new Date();
  const users = await prisma.user.findMany({
    where: { organizationId: orgId(req), status: "ACTIVE" },
    select: {
      id: true, email: true, displayName: true, role: true, team: { select: { name: true } },
      assignedClaims: {
        where: { deletedAt: null, status: { notIn: ["PAID"] } },
        select: {
          id: true, managerPriority: true, workDueAt: true, nextFollowUpAt: true,
          escalatedAt: true, status: true
        }
      }
    },
    orderBy: { email: "asc" }
  });
  const items = users.map((user) => {
    const claims = user.assignedClaims;
    const dueDate = (c) => c.nextFollowUpAt || c.workDueAt;
    return {
      id: user.id, email: user.email, displayName: user.displayName, role: user.role,
      team: user.team?.name || null,
      open: claims.length,
      overdue: claims.filter((c) => dueDate(c) && new Date(dueDate(c)) < now).length,
      urgent: claims.filter((c) => c.managerPriority === "URGENT").length,
      escalated: claims.filter((c) => Boolean(c.escalatedAt)).length
    };
  });
  res.json({ items });
});

router.get("/claims/:id/ownership-history", requirePermission(PERMISSIONS.CLAIM_VIEW), async (req, res) => {
  const claim = await claimFor(req, req.params.id);
  if (!claim) return res.status(404).json({ error: "Claim not found" });
  const items = await prisma.claimOwnershipHistory.findMany({
    where: { organizationId: orgId(req), claimId: claim.id },
    include: { changedByUser: { select: { email: true, displayName: true } } },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  res.json({ items });
});

export default router;
