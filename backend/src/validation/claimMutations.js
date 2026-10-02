import { z } from "zod";

const optionalDateString = z.string().trim().max(64).nullish();
const optionalMoneyInput = z.union([z.string().trim().max(40), z.number().finite()]).nullish();

export const serviceLineInputSchema = z.object({
  cptHcpcsCode: z.string().trim().min(1).max(20),
  modifiers: z.array(z.string().trim().min(1).max(4)).max(4).optional(),
  units: z.union([z.string().trim().max(20), z.number().finite()]).nullish(),
  charge: optionalMoneyInput,
  diagnosisPointers: z.array(z.string().trim().min(1).max(20)).max(12).optional(),
  placeOfService: z.string().trim().max(4).nullish(),
  serviceDateFrom: optionalDateString,
  serviceDateTo: optionalDateString,
  revenueCode: z.string().trim().max(8).nullish(),
  poaIndicator: z.string().trim().max(2).nullish()
}).strict();

export const emptyMutationSchema = z.object({}).strict();

export const claimUpdateSchema = z.object({
  patientName: z.string().trim().min(1).max(250),
  payerName: z.string().trim().min(1).max(250),
  policyNo: z.string().trim().max(100).nullish(),
  memberId: z.string().trim().max(100).nullish(),
  medicalRecordNumber: z.string().trim().max(100).nullish(),
  planAdministratorName: z.string().trim().max(250).nullish(),
  groupNumber: z.string().trim().max(100).nullish(),
  subscriberId: z.string().trim().max(100).nullish(),
  subscriberName: z.string().trim().max(250).nullish(),
  subscriberRelationship: z.enum(["SELF", "SPOUSE", "CHILD", "OTHER"]).nullish(),
  coordinationOfBenefits: z.enum(["PRIMARY", "SECONDARY", "TERTIARY"]).nullish(),
  payerEdiId: z.string().trim().max(100).nullish(),
  coverageLimit: optionalMoneyInput,
  remainingCoverageLimit: optionalMoneyInput,
  payerReferenceNo: z.string().trim().max(100).nullish(),
  patientDob: optionalDateString,
  hospitalName: z.string().trim().max(250).nullish(),
  billingProviderNpi: z.string().trim().max(10).nullish(),
  renderingProviderNpi: z.string().trim().max(10).nullish(),
  referringProviderNpi: z.string().trim().max(10).nullish(),
  providerTin: z.string().trim().max(20).nullish(),
  providerTaxonomyCode: z.string().trim().max(20).nullish(),
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
  inpatientProcedureCodes: z.array(z.string().trim().max(20)).max(100).optional(),
  typeOfBill: z.string().trim().max(10).nullish(),
  drgCode: z.string().trim().max(10).nullish(),
  claimFrequencyCode: z.enum(["ORIGINAL", "CORRECTED", "VOID"]).optional(),
  timelyFilingDeadline: optionalDateString,
  amount: optionalMoneyInput,
  totalBilledAmount: optionalMoneyInput,
  serviceLines: z.array(serviceLineInputSchema).max(500).optional()
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
