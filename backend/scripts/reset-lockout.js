#!/usr/bin/env node
/**
 * Local development helper to reset account lockout and DB-backed login rate limits.
 * Usage: node scripts/reset-lockout.js <email>
 */

import "dotenv/config";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function isLocalDatabaseUrl(raw) {
  try {
    const url = new URL(raw);
    return ["localhost", "127.0.0.1", "::1"].includes(String(url.hostname || "").toLowerCase());
  } catch {
    return false;
  }
}

function emailRateKey(email) {
  const hash = crypto
    .createHash("sha256")
    .update(String(email).toLowerCase().trim())
    .digest("hex");
  return `login-email:${hash}`;
}

async function resetLockout(email) {
  if (!isLocalDatabaseUrl(process.env.DATABASE_URL || "")) {
    throw new Error("Refusing to reset lockout against a non-local database.");
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  console.log(`Resetting local lockout for: ${normalizedEmail}`);

  await prisma.authRateLimit.deleteMany({
    where: {
      OR: [
        { key: emailRateKey(normalizedEmail) },
        { key: { startsWith: "login-ip:" } }
      ]
    }
  });
  console.log("✓ DB-backed login rate limits cleared");

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail }
  });

  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null
      }
    });
    console.log(`✓ Account unlocked for: ${normalizedEmail}`);
  } else {
    console.log("✓ Rate limit cleared (account was not present)");
  }
}

const email = process.argv[2];
if (!email) {
  console.log("Usage: node scripts/reset-lockout.js <email>");
  console.log("Example: node scripts/reset-lockout.js admin@hospital.com");
  process.exit(1);
}

resetLockout(email)
  .catch((error) => {
    console.error("Reset failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
