export const POS_OPTIONS = [
  ["01","Pharmacy"],["02","Telehealth (not in patient's home)"],["03","School"],["04","Homeless Shelter"],
  ["05","IHS Free-standing Facility"],["06","IHS Provider-based Facility"],["07","Tribal 638 Free-standing Facility"],
  ["08","Tribal 638 Provider-based Facility"],["09","Prison / Correctional Facility"],["10","Telehealth in Patient's Home"],
  ["11","Office"],["12","Home"],["13","Assisted Living Facility"],["14","Group Home"],["15","Mobile Unit"],
  ["16","Temporary Lodging"],["17","Walk-in Retail Health Clinic"],["18","Place of Employment / Worksite"],
  ["19","Off Campus-Outpatient Hospital"],["20","Urgent Care Facility"],["21","Inpatient Hospital"],
  ["22","On Campus-Outpatient Hospital"],["23","Emergency Room - Hospital"],["24","Ambulatory Surgical Center"],
  ["25","Birthing Center"],["26","Military Treatment Facility"],["27","Outreach Site / Street"],
  ["31","Skilled Nursing Facility"],["32","Nursing Facility"],["33","Custodial Care Facility"],["34","Hospice"],
  ["41","Ambulance - Land"],["42","Ambulance - Air or Water"],["49","Independent Clinic"],
  ["50","Federally Qualified Health Center"],["51","Inpatient Psychiatric Facility"],
  ["52","Psychiatric Facility - Partial Hospitalization"],["53","Community Mental Health Center"],
  ["54","Intermediate Care Facility / Individuals with Intellectual Disabilities"],
  ["55","Residential Substance Abuse Treatment Facility"],["56","Psychiatric Residential Treatment Center"],
  ["57","Non-residential Substance Abuse Treatment Facility"],["58","Non-residential Opioid Treatment Facility"],
  ["60","Mass Immunization Center"],["61","Comprehensive Inpatient Rehabilitation Facility"],
  ["62","Comprehensive Outpatient Rehabilitation Facility"],["65","End-Stage Renal Disease Treatment Facility"],
  ["66","PACE Center"],["71","Public Health Clinic"],["72","Rural Health Clinic"],["81","Independent Laboratory"],
  ["99","Other Place of Service"]
].map(([value,label]) => ({ value, label }));

export const TYPE_OF_BILL_BASE_OPTIONS = [
  ["011","Hospital inpatient (Part A)"],["012","Hospital inpatient (Part B)"],["013","Hospital outpatient"],
  ["014","Hospital other Part B"],["018","Hospital swing bed"],["021","SNF inpatient"],["022","SNF inpatient Part B"],
  ["023","SNF outpatient"],["028","SNF swing bed"],["032","Home health"],["033","Home health"],
  ["034","Home health Part B only"],["041","Religious nonmedical health care institution"],
  ["071","Rural Health Clinic"],["072","ESRD clinic"],["073","Federally Qualified Health Center"],
  ["074","Other rehabilitation facility"],["075","Comprehensive outpatient rehabilitation facility"],
  ["076","Community mental health center"],["081","Hospice - nonhospital based"],["082","Hospice - hospital based"],
  ["083","Hospital outpatient ASC"],["085","Critical Access Hospital"]
].map(([base,label]) => ({ base, label }));

export const CLAIM_FREQUENCY_DIGIT = {
  ORIGINAL: "1",
  INTERIM_FIRST: "2",
  INTERIM_CONTINUING: "3",
  INTERIM_LAST: "4",
  CORRECTED: "7",
  VOID: "8",
  FINAL_HOME_HEALTH: "9"
};

export const POA_OPTIONS = [
  { value: "", label: "Not applicable / not reported" },
  { value: "Y", label: "Y - Present at admission" },
  { value: "N", label: "N - Not present at admission" },
  { value: "U", label: "U - Documentation insufficient" },
  { value: "W", label: "W - Clinically undetermined" },
  { value: "1", label: "1 - Exempt from POA reporting" }
];

export const npiError = (value) => !value ? "" : /^\d{10}$/.test(String(value).replace(/\D/g,"")) ? "" : "NPI must contain exactly 10 digits.";
export const tinError = (value) => !value ? "" : /^(?:\d{9}|\d{2}-\d{7})$/.test(String(value).trim()) ? "" : "Provider TIN/EIN must contain 9 digits (12-3456789 or 123456789).";
export const taxonomyError = (value) => !value ? "" : /^[A-Z0-9]{10}$/i.test(String(value).trim()) ? "" : "Taxonomy code must be exactly 10 letters/numbers.";

export function normalizeIcd10Cm(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g,"");
  if (!raw || raw.includes(".")) return raw;
  return raw.length > 3 ? `${raw.slice(0,3)}.${raw.slice(3)}` : raw;
}
export const icd10CmError = (value) => {
  const normalized = normalizeIcd10Cm(value);
  return !normalized || /^[A-Z][0-9][A-Z0-9](?:\.[A-Z0-9]{1,4})?$/.test(normalized)
    ? "" : "Use a valid ICD-10-CM format, e.g. E11.9 or S72.001A.";
};

export function normalizeIcd10Pcs(value) {
  return String(value || "").trim().toUpperCase().replace(/[.\s]/g,"");
}
export const icd10PcsError = (value) => {
  const normalized = normalizeIcd10Pcs(value);
  return !normalized || /^[0-9A-HJ-NP-Z]{7}$/.test(normalized)
    ? "" : "ICD-10-PCS must be exactly 7 characters and cannot use I or O.";
};

export const cptHcpcsError = (value) => !value ? "" :
  /^(?:\d{5}|\d{4}[FT]|[A-Z]\d{4})$/i.test(String(value).trim())
    ? "" : "Enter a 5-character CPT/HCPCS code, e.g. 99213 or J1234.";

export const modifiersError = (value) => {
  const values = String(value || "").split(",").map(v=>v.trim()).filter(Boolean);
  if (values.length > 4) return "Maximum 4 modifiers.";
  return values.every(v=>/^[A-Z0-9]{2}$/i.test(v)) ? "" : "Each modifier must be exactly 2 letters/numbers.";
};

export const revenueCodeError = (value) => !value || /^\d{4}$/.test(String(value).trim())
  ? "" : "Revenue Code must contain exactly 4 digits.";

export const drgError = (value) => !value || /^\d{3}$/.test(String(value).trim())
  ? "" : "DRG must contain exactly 3 digits.";

export const typeOfBillError = (value) => {
  if (!value) return "";
  const raw = String(value).trim().toUpperCase();
  const normalized = raw.length === 3 ? `0${raw}` : raw;
  return /^0[1-9][0-9A-Z][0-9A-Z]$/.test(normalized)
    ? ""
    : "Type of Bill must be a valid UB-04 value, e.g. 0131 (or 131).";
};

export const normalizeTin = (value) => String(value || "").replace(/\D/g,"").slice(0,9);
export const normalizeNpi = (value) => String(value || "").replace(/\D/g,"").slice(0,10);
export const normalizeTaxonomy = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,10);
export const normalizeProcedureCode = (value) => String(value || "").toUpperCase().replace(/\s/g,"").slice(0,5);

export function typeOfBillFor(base, frequency) {
  return base ? `${base}${CLAIM_FREQUENCY_DIGIT[frequency] || "1"}` : "";
}
