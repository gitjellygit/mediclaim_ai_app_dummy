-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "AdmissionType" AS ENUM ('PLANNED', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('CASHLESS', 'REIMBURSEMENT');

-- CreateEnum
CREATE TYPE "ClaimStage" AS ENUM ('INITIAL', 'ENHANCEMENT', 'FINAL');

-- CreateEnum
CREATE TYPE "RoomCategory" AS ENUM ('GENERAL', 'SEMI_PRIVATE', 'PRIVATE', 'ICU');

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "admissionDate" TIMESTAMP(3),
ADD COLUMN     "admissionType" "AdmissionType",
ADD COLUMN     "approvedAmount" INTEGER,
ADD COLUMN     "authorizationNo" TEXT,
ADD COLUMN     "balanceSumInsured" INTEGER,
ADD COLUMN     "claimStage" "ClaimStage" NOT NULL DEFAULT 'INITIAL',
ADD COLUMN     "claimSubmissionDate" TIMESTAMP(3),
ADD COLUMN     "claimType" "ClaimType" NOT NULL DEFAULT 'REIMBURSEMENT',
ADD COLUMN     "copayAmount" INTEGER,
ADD COLUMN     "deductionAmount" INTEGER,
ADD COLUMN     "diagnosisText" TEXT,
ADD COLUMN     "dischargeDate" TIMESTAMP(3),
ADD COLUMN     "doctorName" TEXT,
ADD COLUMN     "doctorRegNo" TEXT,
ADD COLUMN     "hospitalAddress" TEXT,
ADD COLUMN     "hospitalName" TEXT,
ADD COLUMN     "hospitalRegNo" TEXT,
ADD COLUMN     "icd10Codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "icuDays" INTEGER,
ADD COLUMN     "insurerClaimNo" TEXT,
ADD COLUMN     "patientAge" INTEGER,
ADD COLUMN     "patientGender" "Gender",
ADD COLUMN     "patientMobile" TEXT,
ADD COLUMN     "policyEndDate" TIMESTAMP(3),
ADD COLUMN     "policyStartDate" TIMESTAMP(3),
ADD COLUMN     "procedureDate" TIMESTAMP(3),
ADD COLUMN     "procedureText" TEXT,
ADD COLUMN     "productType" TEXT,
ADD COLUMN     "roomCategory" "RoomCategory",
ADD COLUMN     "sumInsured" INTEGER,
ADD COLUMN     "totalBilledAmount" INTEGER,
ADD COLUMN     "tpaName" TEXT,
ADD COLUMN     "tpaReferenceNo" TEXT,
ADD COLUMN     "uhid" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "isMandatory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;
