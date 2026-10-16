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
  customRuleField
} from "../services/ruleCatalog.js";

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
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional()
}).strict();

const definitionSchema = z.object({
  field: z.string().min(1).max(100),
  operator: z.enum(OPERATOR_IDS),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
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

function validateDefinition(definition) {
  const field = customRuleField(definition.field);
  if (!field) {
    return { ok: false, error: "Unsupported rule field" };
  }
  if (definition.operator !== "REQUIRED" && definition.value === undefined) {
    return { ok: false, error: "This operator requires an expected value" };
  }
  if (definition.appliesWhen) {
    if (!customRuleField(definition.appliesWhen.field)) {
      return { ok: false, error: "Unsupported applies-when field" };
    }
    if (
      definition.appliesWhen.operator !== "REQUIRED" &&
      definition.appliesWhen.value === undefined
    ) {
      return { ok: false, error: "Applies-when operator requires a value" };
    }
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
      changedFields: metadata.changedFields || []
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

router.get("/:id", async (req, res) => {
  const rule = await prisma.rule.findFirst({
    where: { id: req.params.id, organizationId: orgId(req), deletedAt: null }
  });
  if (!rule) return res.status(404).json({ error: "Rule not found" });
  res.json(publicRule(rule));
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
    const rule = await prisma.rule.create({
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
        effectiveFrom,
        effectiveTo
      }
    });
    await auditRule(req, rule, "RULE_CREATED", {
      changedFields: ["code", "definition", "scope", "severity"]
    });
    res.status(201).json(publicRule(rule));
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

    const updated = await prisma.rule.update({
      where: { id: existing.id },
      data: {
        enabled:
          typeof req.body?.enabled === "boolean" ? req.body.enabled : undefined,
        severity: severity || undefined
      }
    });
    await auditRule(req, updated, "RULE_UPDATED", {
      changedFields: requestedKeys
    });
    return res.json(publicRule(updated));
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

  const updated = await prisma.rule.update({
    where: { id: existing.id },
    data
  });
  await auditRule(req, updated, "RULE_UPDATED", { changedFields });
  res.json(publicRule(updated));
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

  const deleted = await prisma.rule.update({
    where: { id: existing.id },
    data: { deletedAt: new Date(), enabled: false }
  });
  await auditRule(req, deleted, "RULE_DELETED", {
    changedFields: ["deletedAt", "enabled"]
  });
  res.json({ success: true });
});

export default router;
