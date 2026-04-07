#!/usr/bin/env node
/**
 * Development script to reset account lockout and rate limits
 * Usage: node scripts/reset-lockout.js <email>
 */

import { PrismaClient } from "@prisma/client";
import { clearRateLimit } from "../src/utils/security.js";

const prisma = new PrismaClient();

async function resetLockout(email) {
  try {
    console.log(`Resetting lockout for: ${email}`);

    // Clear rate limit
    clearRateLimit(`login:${email}`);
    console.log("✓ Rate limit cleared");

    // Unlock account in database
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() }
    });

    if (!user) {
      console.log(`⚠ User not found: ${email}`);
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null
      }
    });

    console.log(`✓ Account unlocked for: ${email}`);
    console.log("✓ You can now login");
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2];
if (!email) {
  console.log("Usage: node scripts/reset-lockout.js <email>");
  console.log("Example: node scripts/reset-lockout.js admin@hospital.com");
  process.exit(1);
}

resetLockout(email);
