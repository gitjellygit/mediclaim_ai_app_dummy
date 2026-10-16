import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { US_READINESS_RULE_DEFAULTS } from "../src/services/usReadinessRules.js";
import { SYSTEM_RULE_CATALOG } from "../src/services/ruleCatalog.js";

if (process.env.NODE_ENV === "production") {
  throw new Error("Demo seed is disabled in production");
}

const prisma = new PrismaClient();

// Existing demo accounts are NEVER overwritten; administrators can rotate
// passwords through the approved account flow. Set DEV_* variables to control
// first-time passwords. Generated passwords are intentionally not logged.
async function seedUser(email, role, envKey, organizationId) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { email, created: false };

  const password = process.env[envKey] || (
    process.env.NODE_ENV === "test"
      ? { DEV_ADMIN_PASSWORD: "admin123", DEV_CASHIER_PASSWORD: "cashier123", DEV_RECEPTION_PASSWORD: "recep123" }[envKey]
      : crypto.randomBytes(24).toString("base64url")
  );
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({ data: { email, role, passwordHash, organizationId } });
  return { email, created: true, generated: !process.env[envKey] && process.env.NODE_ENV !== "test" };
}

async function main() {
  const demoSubmissionProfile = {
    stediSubmitterName: "Demo Hospital",
    stediSubmitterId: "DEMO-SUBMITTER",
    stediSubmitterPhone: "3035550100",
    stediBillingProviderName: "Demo Hospital",
    stediBillingAddress1: "500 Provider Ave",
    stediBillingAddress2: null,
    stediBillingCity: "Denver",
    stediBillingState: "CO",
    stediBillingPostalCode: "80203",
    stediProfessionalSignatureIndicator: "Y",
    stediProfessionalPlanParticipationCode: "A",
    stediInstitutionalPlanParticipationCode: "C",
    stediBenefitsAssignmentIndicator: "Y",
    stediReleaseInformationCode: "Y",
    stediDefaultProfessionalPlaceOfService: "11",
    stediDefaultInstitutionalPlaceOfService: "21"
  };

  const organization = await prisma.organization.upsert({
    where: { slug: "demo-hospital" },
    update: demoSubmissionProfile,
    create: { name: "Demo Hospital", slug: "demo-hospital", ...demoSubmissionProfile }
  });
  const results = [];

  for (const catalogRule of SYSTEM_RULE_CATALOG) {
    const rule = {
      ...catalogRule,
      enabled: true,
      ruleType: "SYSTEM",
      systemManaged: true,
      scope: "ORGANIZATION",
      source: "SYSTEM",
      version: "built-in"
    };
    await prisma.rule.upsert({
      where: {
        organizationId_code: {
          organizationId: organization.id,
          code: rule.code
        }
      },
      update: {
        name: rule.name,
        description: rule.description,
        category: rule.category,
        severity: rule.severity,
        ruleType: rule.ruleType,
        systemManaged: rule.systemManaged,
        mandatory: rule.mandatory,
        scope: rule.scope,
        source: rule.source,
        version: rule.version,
        deletedAt: null
      },
      create: {
        ...rule,
        organizationId: organization.id
      }
    });
  }

  results.push(await seedUser("admin@hospital.com", "ADMIN", "DEV_ADMIN_PASSWORD", organization.id));
  results.push(await seedUser("cashier@hospital.com", "CASHIER", "DEV_CASHIER_PASSWORD", organization.id));
  results.push(await seedUser("reception@hospital.com", "RECEPTIONIST", "DEV_RECEPTION_PASSWORD", organization.id));
  for (const item of results) {
    console.log(`Demo seed: ${item.email} - ${item.created ? "created" : "already exists"}${item.generated ? " (random password: set DEV_* env to choose a known initial password)" : ""}`);
  }
}

main().finally(async () => prisma.$disconnect());
