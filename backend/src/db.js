import { Prisma, PrismaClient } from "@prisma/client";

// Keep the existing numeric JSON API contract while the database gains exact
// Decimal(14,2) storage. Arithmetic must use integer cents (utils/money.js),
// never the floating-point values produced for UI serialization.
Prisma.Decimal.prototype.toJSON = function toJSON() {
  return Number(this.toFixed(2));
};

// One connection pool per backend process. Import this module in routers/services.
export const prisma = new PrismaClient();

export function assertGeneratedPrismaClientCurrent() {
  const missing = ["patientBalance", "patientPayment"].filter((delegate) => !prisma[delegate]);
  if (missing.length) {
    const error = new Error(
      "Generated Prisma client is stale. Missing models: " +
      missing.join(", ") +
      ". Run 'npm run db:prepare' in backend and restart the server."
    );
    error.code = "PRISMA_CLIENT_STALE";
    throw error;
  }
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}
