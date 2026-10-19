import express from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { writeCriticalRequestAudit } from "../services/auditLog.js";
import {
  CUSTOM_RULE_FIELDS,
  CUSTOM_RULE_OPERATORS,
  EXTERNAL_RULE_SOURCE_CATALOG,
  RULE_CATEGORIES,
  SYSTEM_RULE_CATALOG,
  customRuleField,
  operatorsForField
} from "../services/ruleCatalog.js";
import { evaluateConfiguredRules } from "../services/configurableRuleEngine.js";
import {
  bumpRulesetAndInvalidate,
  writeRuleVersion
} from "../services/ruleLifecycle.js";

const router = express.Router();

const SEVERITIES = ["INFO", "WARN", "BLOCK"];
const SCOPES = ["ORGANIZATION", "PAYER"];
const CATEGORY_IDS = RULE_CATEGORIES.map((item) => item.id);
const OPERATOR_IDS = CUSTOM_RULE_OPERATORS.map((item) => item.id);

function orgId(req) {
  return req.user.organizationId;
}

const predicateSchema = z.object({
  field: z.string().min(1).max(100),
  operator: z.enum(OPERATOR_IDS),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number(), z.boolean()]))
  ]).optional()
}).strict();

const definitionSchema = z.object({
  field: z.string().min(1).max(100),
  operator: z.enum(OPERATOR_IDS),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number(), z.boolean()]))
  ]).optional(),
  appliesWhen: predicateSchema.optional()
}).strict();

const createRuleSchema = z.object({
  code: z.string().trim().min(3).max(80).regex(/^[A-Z][A-Z0-9_]*$/),
  name: z.string().trim().min(3).max(200),
  description: z.string().trim().max(1000).optional().nullable(),
  category: z.enum(CATEGORY_IDS),
  severity: z.enum(SEVERITIES).default("WARN"),
  enabled: z.boolean().default(true),
  scope: z.enum(SCOPES).default("ORGANIZATION"),
  payerName: z.string().trim().max(200).optional().nullable(),
  payerEdiId: z.string().trim().max(100).optional().nullable(),
  definition: definitionSchema,
  version: z.string().trim().min(1).max(50).default("1.0"),
  effectiveFrom: z.string().datetime().optional().nullable(),
  effectiveTo: z.string().datetime().optional().nullable()
}).strict();

const updateRuleSchema = createRuleSchema.partial().omit({
  code: true
}).extend({
  code: z.never().optional()
}).strict();

function validatePredicate(predicate, label = "Rule") {
  const field = customRuleField(predicate.field);
  if (!field) return { ok: false, error: `${label}: unsupported rule field` };

  const allowed = operatorsForField(predicate.field);
  if (!allowed.includes(predicate.operator)) {
    return {
      ok: false,
      error: `${label}: operator ${predicate.operator} is not valid for ${field.type} field ${predicate.field}`
    };
  }

  if (predicate.operator !== "REQUIRED" && predicate.value === undefined) {
    return { ok: false, error: `${label}: this operator requires an expected value` };
  }

  const value = predicate.value;
  if (["GREATER_THAN", "GREATER_OR_EQUAL", "LESS_THAN", "LESS_OR_EQUAL", "LENGTH_EQUALS"].includes(predicate.operator)) {
    if (!Number.isFinite(Number(value))) {
      return { ok: false, error: `${label}: expected value must be numeric` };
    }
  }
  if (predicate.operator === "LENGTH_BETWEEN") {
    const parts = Array.isArray(value) ? value : String(value || "").split(",");
    if (parts.length !== 2 || parts.some((part) => !Number.isFinite(Number(part)))) {
      return { ok: false, error: `${label}: length range must contain minimum and maximum values` };
    }
  }
  if (field.type === "boolean" && predicate.operator !== "REQUIRED" && typeof value !== "boolean") {
    return { ok: false, error: `${label}: expected value must be true or false` };
  }
  if (field.type === "date" && predicate.operator !== "REQUIRED") {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      return { ok: false, error: `${label}: expected value must be a valid date` };
    }
  }
  return { ok: true };
}

function validateDefinition(definition) {
  const primary = validatePredicate(definition);
  if (!primary.ok) return primary;
  if (definition.appliesWhen) {
    const condition = validatePredicate(definition.appliesWhen, "Applies-when condition");
    if (!condition.ok) return condition;
  }
  return { ok: true };
}

function dateValue(value) {
  return value ? new Date(value) : null;
}

function publicRule(rule) {
  return {
    ...rule,
    definition: rule.definition || null
  };
}

async function auditRule(req, rule, action, metadata = {}) {
  await writeCriticalRequestAudit(prisma, req, {
    action,
    entityType: "Rule",
    entityId: rule?.id || null,
    outcome: "SUCCESS",
    metadata: {
      operation: action.toLowerCase(),
      category: rule?.category || null,
      source: rule?.source || null,
      changedFields: metadata.changedFields || [],
      ...metadata
    }
  });
}

router.get("/meta", async (_req, res) => {
  res.json({
    categories: RULE_CATEGORIES,
    fields: CUSTOM_RULE_FIELDS,
    operators: CUSTOM_RULE_OPERATORS,
    systemCatalog: SYSTEM_RULE_CATALOG,
    externalSources: EXTERNAL_RULE_SOURCE_CATALOG,
    severities: SEVERITIES,
    scopes: SCOPES,
    guidance: {
      customRules:
        "Custom rules use controlled fields/operators and never execute arbitrary code.",
      ncci:
        "NCCI/PTP and MUE content must be loaded as versioned external rule sources; confidential/proprietary content is not bundled.",
      mandatory:
        "Mandatory system submission safeguards cannot be disabled, deleted or downgraded."
    }
  });
});

router.get("/", async (req, res) => {
  const rules = await prisma.rule.findMany({
    where: { organizationId: orgId(req), deletedAt: null },
    orderBy: [{ systemManaged: "desc" }, { category: "asc" }, { name: "asc" }]
  });

  const configuredSystemCodes = new Set(
    rules.filter((rule) => rule.systemManaged).map((rule) => rule.code)
  );

  const unconfiguredSystemRules = SYSTEM_RULE_CATALOG
    .filter((item) => !configuredSystemCodes.has(item.code))
    .map((item) => ({
      ...item,
      id: null,
      configured: false,
      enabled: true,
      systemManaged: true,
      ruleType: "SYSTEM",
      scope: "ORGANIZATION",
      version: "built-in"
    }));

  res.json({
    items: rules.map((rule) => ({ ...publicRule(rule), configured: true })),
    unconfiguredSystemRules
  });
});

router.post("/simulate", async (req, res) => {
  const parsed = createRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid rule configuration",
      message: parsed.error.issues[0]?.message || "Rule input is invalid"
    });
  }
  const input = parsed.data;
  const validation = validateDefinition(input.definition);
  if (!validation.ok) return res.status(400).json({ error: validation.error });
  if (input.scope === "PAYER" && !String(input.payerName || "").trim() && !String(input.payerEdiId || "").trim()) {
    return res.status(400).json({ error: "Payer-scoped rules require payer name or payer EDI ID" });
  }

  const rule = {
    ...input,
    systemManaged: false,
    ruleType: "CUSTOM",
    mandatory: false,
    source: "ORGANIZATION",
    revision: 1,
    effectiveFrom: dateValue(input.effectiveFrom),
    effectiveTo: dateValue(input.effectiveTo)
  };

  const where = {
    organizationId: orgId(req),
    deletedAt: null,
    status: { in: ["DRAFT", "NEEDS_REVIEW", "READY"] }
  };
  const [totalClaims, claims] = await Promise.all([
    prisma.claim.count({ where }),
    prisma.claim.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 1000,
      include: {
        documents: { select: { id: true } },
        serviceLines: { select: { cptHcpcsCode: true, units: true, charge: true, verified: true } }
      }
    })
  ]);

  const affected = [];
  for (const claim of claims) {
    const issues = evaluateConfiguredRules(claim, [rule]);
    if (issues.length) {
      affected.push({
        claimId: claim.id,
        status: claim.status,
        payerName: claim.payerName,
        payerEdiId: claim.payerEdiId,
        severity: issues[0].severity,
        message: issues[0].message
      });
    }
  }

  res.json({
    testedClaims: claims.length,
    totalInProcessClaims: totalClaims,
    truncated: totalClaims > claims.length,
    affectedClaims: affected.length,
    blockCount: affected.filter((item) => item.severity === "BLOCK").length,
    warnCount: affected.filter((item) => item.severity === "WARN").length,
    infoCount: affected.filter((item) => item.severity === "INFO").length,
    samples: affected.slice(0, 10)
  });
});

router.get("/:id", async (req, res) => {
  const rule = await prisma.rule.findFirst({
    where: { id: req.params.id, organizationId: orgId(req), deletedAt: null }
  });
  if (!rule) return res.status(404).json({ error: "Rule not found" });
  res.json(publicRule(rule));
});

router.get("/:id/versions", async (req, res) => {
  const rule = await prisma.rule.findFirst({
    where: { id: req.params.id, organizationId: orgId(req) },
    select: { id: true }
  });
  if (!rule) return res.status(404).json({ error: "Rule not found" });
  const versions = await prisma.ruleVersion.findMany({
    where: { ruleId: rule.id, organizationId: orgId(req) },
    orderBy: { revision: "desc" }
  });
  res.json({ items: versions });
});

router.post("/", async (req, res) => {
  const parsed = createRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid rule configuration",
      message: parsed.error.issues[0]?.message || "Rule input is invalid"
    });
  }

  const input = parsed.data;
  if (SYSTEM_RULE_CATALOG.some((item) => item.code === input.code)) {
    return res.status(409).json({
      error: "This rule code is reserved for a system-managed safeguard"
    });
  }
  const priorIdentity = await prisma.rule.findFirst({
    where: { organizationId: orgId(req), code: input.code }
  });
  if (priorIdentity) {
    return res.status(409).json({
      error: priorIdentity.deletedAt
        ? "This rule code belongs to an archived rule. Rule codes are immutable identities; use the archived rule history rather than reusing the code."
        : "Rule code already exists in your organization"
    });
  }
  const definitionCheck = validateDefinition(input.definition);
  if (!definitionCheck.ok) {
    return res.status(400).json({ error: definitionCheck.error });
  }

  if (
    input.scope === "PAYER" &&
    !String(input.payerName || "").trim() &&
    !String(input.payerEdiId || "").trim()
  ) {
    return res.status(400).json({
      error: "Payer-scoped rules require payer name or payer EDI ID"
    });
  }

  const effectiveFrom = dateValue(input.effectiveFrom);
  const effectiveTo = dateValue(input.effectiveTo);
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
    return res.status(400).json({
      error: "Effective-to date must be on or after effective-from date"
    });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const rule = await tx.rule.create({
        data: {
          organizationId: orgId(req),
          code: input.code,
          name: input.name,
          description: input.description || null,
          category: input.category,
          severity: input.severity,
          enabled: input.enabled,
          ruleType: "CUSTOM",
          systemManaged: false,
          mandatory: false,
          scope: input.scope,
          payerName: input.scope === "PAYER" ? (input.payerName || null) : null,
          payerEdiId: input.scope === "PAYER" ? (input.payerEdiId || null) : null,
          definition: input.definition,
          source: "ORGANIZATION",
          version: input.version,
          revision: 1,
          effectiveFrom,
          effectiveTo
        }
      });
      await writeRuleVersion(tx, rule, "CREATED", req.user?.id || null);
      const invalidation = await bumpRulesetAndInvalidate(
        tx,
        orgId(req),
        rule,
        `Readiness rules changed: ${rule.code} created`
      );
      return { rule, invalidation };
    });
    await auditRule(req, result.rule, "RULE_CREATED", {
      changedFields: ["code", "definition", "scope", "severity"],
      ruleCode: result.rule.code,
      ruleRevision: result.rule.revision,
      newVersion: result.rule.version,
      newSeverity: result.rule.severity,
      newEnabled: result.rule.enabled,
      newScope: result.rule.scope,
      ...result.invalidation
    });
    res.status(201).json({ ...publicRule(result.rule), invalidation: result.invalidation });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({
        error: "Rule code already exists in your organization"
      });
    }
    throw error;
  }
});

router.patch("/:id", async (req, res) => {
  const existing = await prisma.rule.findFirst({
    where: { id: req.params.id, organizationId: orgId(req), deletedAt: null }
  });
  if (!existing) return res.status(404).json({ error: "Rule not found" });

  if (existing.systemManaged) {
    const allowedKeys = existing.mandatory ? [] : ["enabled", "severity"];
    const requestedKeys = Object.keys(req.body || {});
    const disallowed = requestedKeys.filter((key) => !allowedKeys.includes(key));
    if (existing.mandatory || disallowed.length > 0) {
      return res.status(409).json({
        error: existing.mandatory
          ? "Mandatory system rules cannot be changed"
          : "System rules only allow enabled/severity overrides"
      });
    }

    const severity = req.body?.severity;
    if (severity !== undefined && !SEVERITIES.includes(severity)) {
      return res.status(400).json({ error: "Invalid severity" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.rule.update({
        where: { id: existing.id },
        data: {
          enabled:
            typeof req.body?.enabled === "boolean" ? req.body.enabled : undefined,
          severity: severity || undefined,
          revision: { increment: 1 }
        }
      });
      await writeRuleVersion(tx, updated, "UPDATED", req.user?.id || null);
      const invalidation = await bumpRulesetAndInvalidate(
        tx,
        orgId(req),
        updated,
        `Readiness rules changed: ${updated.code} updated`,
        existing
      );
      return { updated, invalidation };
    });
    await auditRule(req, result.updated, "RULE_UPDATED", {
      changedFields: requestedKeys,
      ruleCode: result.updated.code,
      ruleRevision: result.updated.revision,
      previousVersion: existing.version,
      newVersion: result.updated.version,
      previousSeverity: existing.severity,
      newSeverity: result.updated.severity,
      previousEnabled: existing.enabled,
      newEnabled: result.updated.enabled,
      previousScope: existing.scope,
      newScope: result.updated.scope,
      ...result.invalidation
    });
    return res.json({ ...publicRule(result.updated), invalidation: result.invalidation });
  }

  const parsed = updateRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid rule configuration",
      message: parsed.error.issues[0]?.message || "Rule input is invalid"
    });
  }

  const input = parsed.data;
  if (input.definition) {
    const definitionCheck = validateDefinition(input.definition);
    if (!definitionCheck.ok) {
      return res.status(400).json({ error: definitionCheck.error });
    }
  }

  const nextScope = input.scope || existing.scope;
  const nextPayerName =
    input.payerName !== undefined ? input.payerName : existing.payerName;
  const nextPayerEdiId =
    input.payerEdiId !== undefined ? input.payerEdiId : existing.payerEdiId;

  if (
    nextScope === "PAYER" &&
    !String(nextPayerName || "").trim() &&
    !String(nextPayerEdiId || "").trim()
  ) {
    return res.status(400).json({
      error: "Payer-scoped rules require payer name or payer EDI ID"
    });
  }

  const effectiveFrom =
    input.effectiveFrom !== undefined
      ? dateValue(input.effectiveFrom)
      : existing.effectiveFrom;
  const effectiveTo =
    input.effectiveTo !== undefined
      ? dateValue(input.effectiveTo)
      : existing.effectiveTo;

  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
    return res.status(400).json({
      error: "Effective-to date must be on or after effective-from date"
    });
  }

  const data = {
    ...input,
    description:
      input.description !== undefined ? input.description || null : undefined,
    payerName:
      nextScope === "PAYER"
        ? input.payerName !== undefined
          ? input.payerName || null
          : undefined
        : null,
    payerEdiId:
      nextScope === "PAYER"
        ? input.payerEdiId !== undefined
          ? input.payerEdiId || null
          : undefined
        : null,
    effectiveFrom:
      input.effectiveFrom !== undefined ? effectiveFrom : undefined,
    effectiveTo: input.effectiveTo !== undefined ? effectiveTo : undefined
  };
  delete data.code;

  const changedFields = Object.keys(data).filter(
    (key) => data[key] !== undefined
  );

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.rule.update({
      where: { id: existing.id },
      data: { ...data, revision: { increment: 1 } }
    });
    await writeRuleVersion(tx, updated, "UPDATED", req.user?.id || null);
    const invalidation = await bumpRulesetAndInvalidate(
      tx,
      orgId(req),
      updated,
      `Readiness rules changed: ${updated.code} updated`,
      existing
    );
    return { updated, invalidation };
  });
  await auditRule(req, result.updated, "RULE_UPDATED", {
    changedFields,
    ruleCode: result.updated.code,
    ruleRevision: result.updated.revision,
    previousVersion: existing.version,
    newVersion: result.updated.version,
    previousSeverity: existing.severity,
    newSeverity: result.updated.severity,
    previousEnabled: existing.enabled,
    newEnabled: result.updated.enabled,
    previousScope: existing.scope,
    newScope: result.updated.scope,
    ...result.invalidation
  });
  res.json({ ...publicRule(result.updated), invalidation: result.invalidation });
});

router.delete("/:id", async (req, res) => {
  const existing = await prisma.rule.findFirst({
    where: { id: req.params.id, organizationId: orgId(req), deletedAt: null }
  });
  if (!existing) return res.status(404).json({ error: "Rule not found" });
  if (existing.systemManaged) {
    return res.status(409).json({
      error: "System-managed rules cannot be deleted"
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const deleted = await tx.rule.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), enabled: false, revision: { increment: 1 } }
    });
    await writeRuleVersion(tx, deleted, "ARCHIVED", req.user?.id || null);
    const invalidation = await bumpRulesetAndInvalidate(
      tx,
      orgId(req),
      existing,
      `Readiness rules changed: ${existing.code} archived`
    );
    return { deleted, invalidation };
  });
  await auditRule(req, result.deleted, "RULE_DELETED", {
    changedFields: ["deletedAt", "enabled"],
    ruleCode: result.deleted.code,
    ruleRevision: result.deleted.revision,
    previousVersion: existing.version,
    newVersion: result.deleted.version,
    previousEnabled: existing.enabled,
    newEnabled: result.deleted.enabled,
    previousScope: existing.scope,
    newScope: result.deleted.scope,
    ...result.invalidation
  });
  res.json({ success: true, invalidation: result.invalidation });
});

export default router;
