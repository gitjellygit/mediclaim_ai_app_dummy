import { z } from "zod";

const upper = (value) => String(value ?? "").trim().toUpperCase();
const digits = (value) => String(value ?? "").replace(/\D/g, "");

export function normalizeIcd10Cm(value) {
  const raw = upper(value).replace(/\s+/g, "");
  if (!raw) return "";
  if (raw.includes(".")) return raw;
  return raw.length > 3 ? `${raw.slice(0, 3)}.${raw.slice(3)}` : raw;
}

export function normalizeIcd10Pcs(value) {
  return upper(value).replace(/\./g, "").replace(/\s+/g, "");
}

export function normalizeProcedureCode(value) {
  return upper(value).replace(/\s+/g, "");
}

export function normalizeNpi(value) {
  return digits(value);
}

export function normalizeTin(value) {
  return digits(value);
}

export function normalizeTaxonomy(value) {
  return upper(value).replace(/\s+/g, "");
}

export function normalizeTypeOfBill(value) {
  const raw = upper(value).replace(/\s+/g, "");
  if (!raw) return "";
  return raw.length === 3 ? `0${raw}` : raw;
}

export const npiSchema = z.string().trim()
  .transform(normalizeNpi)
  .refine((value) => /^\d{10}$/.test(value), "NPI must contain exactly 10 digits");

export const tinSchema = z.string().trim()
  .refine((value) => /^(?:\d{9}|\d{2}-\d{7})$/.test(value), "Provider TIN/EIN must contain 9 digits")
  .transform(normalizeTin);

export const taxonomySchema = z.string().trim()
  .transform(normalizeTaxonomy)
  .refine((value) => /^[A-Z0-9]{10}$/.test(value), "Provider taxonomy code must be exactly 10 letters/numbers");

export const icd10CmSchema = z.string().trim()
  .transform(normalizeIcd10Cm)
  .refine(
    (value) => /^[A-Z][0-9][A-Z0-9](?:\.[A-Z0-9]{1,4})?$/.test(value),
    "ICD-10-CM must be 3-7 characters; a decimal may follow the first 3 characters"
  );

export const icd10PcsSchema = z.string().trim()
  .transform(normalizeIcd10Pcs)
  .refine(
    (value) => /^[0-9A-HJ-NP-Z]{7}$/.test(value),
    "ICD-10-PCS must be exactly 7 characters and cannot use I or O"
  );

export const cptHcpcsSchema = z.string().trim()
  .transform(normalizeProcedureCode)
  .refine(
    (value) => /^(?:\d{5}|\d{4}[FT]|[A-Z]\d{4})$/.test(value),
    "CPT/HCPCS must be 5 characters (for example 99213 or J1234)"
  );

export const modifierSchema = z.string().trim()
  .transform(normalizeProcedureCode)
  .refine((value) => /^[A-Z0-9]{2}$/.test(value), "Modifier must be exactly 2 letters/numbers");

export const CMS_POS_CODES = new Set([
  "01","02","03","04","05","06","07","08","09","10","11","12","13","14","15","16","17","18","19","20",
  "21","22","23","24","25","26","27","31","32","33","34","41","42","49","50","51","52","53","54","55","56",
  "57","58","60","61","62","65","66","71","72","81","99"
]);

export const placeOfServiceSchema = z.string().trim()
  .refine(
    (value) => CMS_POS_CODES.has(value),
    "Place of Service must be an assigned CMS 2-digit code"
  );

export const revenueCodeSchema = z.string().trim()
  .refine((value) => /^\d{4}$/.test(value), "Revenue Code must contain exactly 4 digits");

export const poaIndicatorSchema = z.string().trim()
  .transform(upper)
  .refine((value) => ["Y", "N", "U", "W", "1"].includes(value), "POA Indicator must be Y, N, U, W, or 1");

export const typeOfBillSchema = z.string().trim()
  .transform(normalizeTypeOfBill)
  .refine((value) => /^0[1-9][0-9A-Z][0-9A-Z]$/.test(value), "Type of Bill must be a valid 4-character UB-04 format such as 0131");

export const drgSchema = z.string().trim()
  .refine((value) => /^\d{3}$/.test(value), "DRG must contain exactly 3 digits");

export function optional(schema) {
  return z.preprocess(
    (value) => value == null || String(value).trim() === "" ? null : value,
    schema.nullable()
  );
}

export function firstZodMessage(error, fallback) {
  return error?.issues?.[0]?.message || fallback;
}
