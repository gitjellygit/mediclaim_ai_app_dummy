export const DOC_TYPES = [
  "DISCHARGE_SUMMARY",
  "FINAL_BILL",
  "BREAKUP_BILL",
  "LAB_REPORT",
  "RADIOLOGY",
  "PRESCRIPTION",
  "ID_PROOF",
  "INSURANCE_CARD",
  "PRIOR_AUTHORIZATION",
  "OPERATIVE_NOTE",
  "PROGRESS_NOTE",
  "EOB",
  "OTHER"
];

export const DOC_TYPE_LABELS = {
  DISCHARGE_SUMMARY: "Discharge Summary",
  FINAL_BILL: "Final Bill",
  BREAKUP_BILL: "Itemized / Breakup Bill",
  LAB_REPORT: "Lab Report",
  RADIOLOGY: "Radiology Report",
  PRESCRIPTION: "Prescription",
  ID_PROOF: "ID Proof",
  INSURANCE_CARD: "Insurance Card",
  PRIOR_AUTHORIZATION: "Prior Authorization",
  OPERATIVE_NOTE: "Operative Note",
  PROGRESS_NOTE: "Progress Note",
  EOB: "Explanation of Benefits (EOB)",
  OTHER: "Other"
};

export const STATUS_COLOR = {
  DRAFT: "default",
  NEEDS_REVIEW: "warning",
  READY: "primary",
  SUBMITTED: "warning",
  DENIED: "error",
  PAID: "success"
};

export function pct(x) {
  if (typeof x !== "number") return "—";
  return `${Math.round(x * 100)}%`;
}

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric"
  }).format(date);
}

export function formatMoney(value) {
  if (value == null || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(amount);
}

export function riskChipColor(level) {
  if (level === "HIGH") return "error";
  if (level === "MED") return "warning";
  if (level === "LOW") return "success";
  return "default";
}

export function readinessColor(score) {
  const value = Number(score || 0);
  if (value < 40) return "error";
  if (value < 70) return "warning";
  return "success";
}

export function readinessTextColor(score) {
  const value = Number(score || 0);
  if (value < 40) return "error.main";
  if (value < 70) return "warning.dark";
  return "success.main";
}

export function provenanceChipColor(source) {
  if (source === "DOCUMENT_AI") return "secondary";
  if (source === "CALCULATED_ESTIMATE") return "warning";
  if (source === "LOCAL_PRECHECK" || source === "DERIVED") return "info";
  if (source === "USER" || source === "USER_RECORDED") return "default";
  return "default";
}
