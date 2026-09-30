import { PrismaClient } from "@prisma/client";

// One connection pool per backend process. Import this module in routers/services.
export const prisma = new PrismaClient();

export async function disconnectDatabase() {
  await prisma.$disconnect();
}
