import { z } from "zod";
import {
  cptHcpcsSchema,
  drgSchema,
  firstZodMessage,
  icd10CmSchema,
  icd10PcsSchema,
  modifierSchema,
  npiSchema,
  optional,
  placeOfServiceSchema,
  poaIndicatorSchema,
  revenueCodeSchema,
  taxonomySchema,
  tinSchema,
  typeOfBillSchema
} from "./usClaimValidation.js";

const optionalDateString = z.string().trim().max(64).nullish();
const optionalMoneyInput = z.union([z.string().trim().max(40), z.number().finite()]).nullish();

export const serviceLineInputSchema = z.object({
  cptHcpcsCode: cptHcpcsSchema,
  modifiers: z.array(modifierSchema).max(4).optional(),
  units: z.union([z.string().trim().max(20), z.number().finite()]).nullish(),
  charge: optionalMoneyInput,
  diagnosisPointers: z.array(icd10CmSchema).max(12).optional(),
  placeOfService: optional(placeOfServiceSchema),
  serviceDateFrom: optionalDateString,
  serviceDateTo: optionalDateString,
  revenueCode: optional(revenueCodeSchema),
  poaIndicator: optional(poaIndicatorSchema)
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
  billingProviderNpi: optional(npiSchema),
  renderingProviderNpi: optional(npiSchema),
  referringProviderNpi: optional(npiSchema),
  providerTin: optional(tinSchema),
  providerTaxonomyCode: optional(taxonomySchema),
  diagnosisText: z.string().max(6000).nullish(),
  claimType: z.enum(["PROVIDER_BILLED", "MEMBER_REIMBURSEMENT"]).optional(),
  claimForm: z.enum(["PROFESSIONAL", "INSTITUTIONAL"]).nullish(),
  dateOfService: optionalDateString,
  admissionDate: optionalDateString,
  dischargeDate: optionalDateString,
  admissionType: z.enum(["PLANNED", "EMERGENCY"]).nullish(),
  roomCategory: z.enum(["GENERAL", "SEMI_PRIVATE", "PRIVATE", "ICU"]).nullish(),
  icuDays: z.union([z.coerce.number().int().nonnegative(), z.literal(""), z.null()]).optional(),
  procedureText: z.string().max(6000).nullish(),
  procedureDate: optionalDateString,
  icd10Codes: z.array(icd10CmSchema).max(100).optional(),
  inpatientProcedureCodes: z.array(icd10PcsSchema).max(100).optional(),
  typeOfBill: optional(typeOfBillSchema),
  drgCode: optional(drgSchema),
  claimFrequencyCode: z.enum(["ORIGINAL", "CORRECTED", "VOID"]).optional(),
  timelyFilingDeadline: optionalDateString,
  amount: optionalMoneyInput,
  totalBilledAmount: optionalMoneyInput,
  serviceLines: z.array(serviceLineInputSchema).max(500).optional()
}).strict().partial();

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
      message: firstZodMessage(parsed.error, "Only supported fields with valid values are accepted"),
      code: "INVALID_REQUEST_INPUT"
    }
  };
}
