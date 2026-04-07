/*
  Warnings:

  - You are about to drop the column `patientId` on the `Claim` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Claim` table. All the data in the column will be lost.
  - You are about to drop the column `config` on the `Rule` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Check" DROP CONSTRAINT "Check_claimId_fkey";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_claimId_fkey";

-- AlterTable
ALTER TABLE "Claim" DROP COLUMN "patientId",
DROP COLUMN "updatedAt";

-- AlterTable
ALTER TABLE "Rule" DROP COLUMN "config",
ALTER COLUMN "severity" SET DEFAULT 'WARN';

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'billing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
