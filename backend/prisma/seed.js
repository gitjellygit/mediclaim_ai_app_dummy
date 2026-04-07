import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminPass = await bcrypt.hash("admin123", 10);
  const cashierPass = await bcrypt.hash("cashier123", 10);
  const recepPass = await bcrypt.hash("recep123", 10);

  await prisma.user.upsert({
    where: { email: "admin@hospital.com" },
    update: { role: "ADMIN", passwordHash: adminPass },
    create: { email: "admin@hospital.com", role: "ADMIN", passwordHash: adminPass }
  });

  await prisma.user.upsert({
    where: { email: "cashier@hospital.com" },
    update: { role: "CASHIER", passwordHash: cashierPass },
    create: { email: "cashier@hospital.com", role: "CASHIER", passwordHash: cashierPass }
  });

  await prisma.user.upsert({
    where: { email: "reception@hospital.com" },
    update: { role: "RECEPTIONIST", passwordHash: recepPass },
    create: { email: "reception@hospital.com", role: "RECEPTIONIST", passwordHash: recepPass }
  });

  console.log("Seeded users: admin/cashier/reception");
}

main().finally(async () => prisma.$disconnect());
