-- AlterTable
ALTER TABLE "Check" ADD COLUMN     "aiSummary" JSONB,
ADD COLUMN     "riskFactors" JSONB,
ADD COLUMN     "riskLevel" TEXT,
ADD COLUMN     "riskScore" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "confidence" INTEGER,
ADD COLUMN     "extracted" JSONB,
ADD COLUMN     "suggestedType" TEXT;
