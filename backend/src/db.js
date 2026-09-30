import { Prisma, PrismaClient } from "@prisma/client";

// Keep the existing numeric JSON API contract while the database gains exact
// Decimal(14,2) storage. Arithmetic must use integer cents (utils/money.js),
// never the floating-point values produced for UI serialization.
Prisma.Decimal.prototype.toJSON = function toJSON() {
  return Number(this.toFixed(2));
};

// One connection pool per backend process. Import this module in routers/services.
export const prisma = new PrismaClient();

export async function disconnectDatabase() {
  await prisma.$disconnect();
}
