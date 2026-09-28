/*
  Warnings:

  - A unique constraint covering the columns `[fileHash]` on the table `Document` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "dateOfService" TIMESTAMP(3),
ADD COLUMN     "memberId" TEXT,
ADD COLUMN     "patientDob" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "fileHash" TEXT,
ADD COLUMN     "ocrProvider" TEXT,
ADD COLUMN     "rawText" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE UNIQUE INDEX "Document_fileHash_key" ON "Document"("fileHash");
