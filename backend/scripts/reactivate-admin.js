#!/usr/bin/env node
/**
 * Local-only recovery helper for an administrator accidentally suspended during testing.
 * Usage: npm run admin:reactivate -- <email>
 */
import "dotenv/config";
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

async function reactivateAdmin(email) {
  if (!isLocalDatabaseUrl(process.env.DATABASE_URL || "")) {
    throw new Error("Refusing to reactivate an admin against a non-local database.");
  }

  const normalizedEmail = String(email || "").toLowerCase().trim();
  if (!normalizedEmail) throw new Error("Admin email is required.");

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) throw new Error("User not found.");
  if (user.role !== "ADMIN") throw new Error("Recovery command only reactivates existing ADMIN users.");

  await prisma.user.update({
    where: { id: user.id },
    data: {
      status: "ACTIVE",
      failedLoginAttempts: 0,
      lockedUntil: null
    }
  });

  console.log(`✓ Reactivated administrator: ${normalizedEmail}`);
  console.log("✓ Existing revoked sessions remain revoked; sign in again to create a new session.");
}

const email = process.argv[2];
if (!email) {
  console.log("Usage: npm run admin:reactivate -- <email>");
  process.exit(1);
}

reactivateAdmin(email)
  .catch((error) => {
    console.error("Admin recovery failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
