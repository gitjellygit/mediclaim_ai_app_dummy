import { z } from "zod";

const optionalDateString = z.string().trim().max(64).nullish();
const optionalMoneyInput = z.union([z.string().trim().max(40), z.number().finite()]).nullish();

export const emptyMutationSchema = z.object({}).strict();

export const claimUpdateSchema = z.object({
  patientName: z.string().trim().min(1).max(250),
  payerName: z.string().trim().min(1).max(250),
  policyNo: z.string().trim().max(100).nullish(),
  memberId: z.string().trim().max(100).nullish(),
  medicalRecordNumber: z.string().trim().max(100).nullish(),
  planAdministratorName: z.string().trim().max(250).nullish(),
  coverageLimit: optionalMoneyInput,
  remainingCoverageLimit: optionalMoneyInput,
  payerReferenceNo: z.string().trim().max(100).nullish(),
  patientDob: optionalDateString,
  hospitalName: z.string().trim().max(250).nullish(),
  diagnosisText: z.string().max(6000).nullish(),
  claimType: z.enum(["PROVIDER_BILLED", "MEMBER_REIMBURSEMENT"]).optional(),
  dateOfService: optionalDateString,
  admissionDate: optionalDateString,
  dischargeDate: optionalDateString,
  admissionType: z.enum(["PLANNED", "EMERGENCY"]).nullish(),
  roomCategory: z.enum(["GENERAL", "SEMI_PRIVATE", "PRIVATE", "ICU"]).nullish(),
  icuDays: z.union([z.coerce.number().int().nonnegative(), z.literal(""), z.null()]).optional(),
  procedureText: z.string().max(6000).nullish(),
  procedureDate: optionalDateString,
  icd10Codes: z.array(z.string().trim().max(20)).max(100).optional(),
  amount: optionalMoneyInput,
  totalBilledAmount: optionalMoneyInput
}).strict();

export const priorAuthEvaluationSchema = z.object({
  required: z.boolean().nullish(),
  authorizationNo: z.string().trim().max(100).nullish(),
  expiry: optionalDateString
}).strict();

export const payerClaimStatusSchema = z.object({
  payerClaimStatus: z.preprocess(
    (value) => typeof value === "string" ? value.toUpperCase() : value,
    z.enum(["ACKNOWLEDGED", "IN_REVIEW", "APPROVED", "PARTIALLY_APPROVED", "DENIED", "PAID"])
  )
}).strict();

export const remittanceMutationSchema = z.object({
  remittanceStatus: z.preprocess(
    (value) => typeof value === "string" ? value.toUpperCase() : value,
    z.enum(["AWAITING", "RECEIVED", "POSTED"])
  ),
  allowedAmount: optionalMoneyInput,
  patientResponsibility: optionalMoneyInput,
  paidAmount: optionalMoneyInput,
  paymentReference: z.string().trim().max(250).nullish()
}).strict();

export const payerConnectSchema = z.object({
  payerCode: z.string().trim().min(1).max(100).transform((value) => value.toUpperCase())
}).strict();

export const payerPriorAuthSchema = z.object({
  authorizationNo: z.string().trim().max(100).nullish()
}).strict();

export function parseMutation(schema, body) {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return { ok: true, data: parsed.data };

  return {
    ok: false,
    response: {
      error: "Invalid request input",
      message: "Only supported fields with valid values are accepted",
      code: "INVALID_REQUEST_INPUT"
    }
  };
}
