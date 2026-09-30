import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

if (process.env.NODE_ENV === "production") {
  throw new Error("Demo seed is disabled in production");
}

const prisma = new PrismaClient();

// Existing demo accounts are NEVER overwritten; administrators can rotate
// passwords through the approved account flow. Set DEV_* variables to control
// first-time passwords. Generated passwords are intentionally not logged.
async function seedUser(email, role, envKey) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { email, created: false };

  const password = process.env[envKey] || (
    process.env.NODE_ENV === "test"
      ? { DEV_ADMIN_PASSWORD: "admin123", DEV_CASHIER_PASSWORD: "cashier123", DEV_RECEPTION_PASSWORD: "recep123" }[envKey]
      : crypto.randomBytes(24).toString("base64url")
  );
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({ data: { email, role, passwordHash } });
  return { email, created: true, generated: !process.env[envKey] && process.env.NODE_ENV !== "test" };
}

async function main() {
  const results = [];
  results.push(await seedUser("admin@hospital.com", "ADMIN", "DEV_ADMIN_PASSWORD"));
  results.push(await seedUser("cashier@hospital.com", "CASHIER", "DEV_CASHIER_PASSWORD"));
  results.push(await seedUser("reception@hospital.com", "RECEPTIONIST", "DEV_RECEPTION_PASSWORD"));
  for (const item of results) {
    console.log(`Demo seed: ${item.email} - ${item.created ? "created" : "already exists"}${item.generated ? " (random password: set DEV_* env to choose a known initial password)" : ""}`);
  }
}

main().finally(async () => prisma.$disconnect());
