const DEFAULT_APPEAL_WINDOW_DAYS = 180;

const CARC = {
  "16": {
    category: "MISSING_INFORMATION",
    label: "Missing or incomplete claim information",
    recommendedAction: "Review the payer response for the missing data element, correct the claim, and resubmit or appeal with supporting documentation."
  },
  "18": {
    category: "DUPLICATE",
    label: "Possible duplicate claim or service",
    recommendedAction: "Confirm whether the claim was previously accepted or paid before sending a corrected claim or appeal."
  },
  "22": {
    category: "COORDINATION_OF_BENEFITS",
    label: "Other payer or coordination-of-benefits issue",
    recommendedAction: "Verify primary and secondary coverage order and submit the required other-payer information."
  },
  "27": {
    category: "ELIGIBILITY",
    label: "Coverage was not active for the reported service date",
    recommendedAction: "Verify eligibility for the date of service and correct member, plan, or service-date information if appropriate."
  },
  "29": {
    category: "TIMELY_FILING",
    label: "Timely-filing limit issue",
    recommendedAction: "Verify the payer filing limit and proof of timely submission. Appeal only when payer policy and evidence support an exception."
  },
  "45": {
    category: "CONTRACTUAL",
    label: "Charge exceeds payer fee schedule or contracted allowance",
    recommendedAction: "Compare the adjudication with the payer contract and fee schedule before posting an adjustment or disputing an underpayment."
  },
  "50": {
    category: "MEDICAL_NECESSITY",
    label: "Medical-necessity denial",
    recommendedAction: "Review the payer medical-necessity policy and clinical documentation before preparing an appeal."
  },
  "96": {
    category: "NON_COVERED",
    label: "Non-covered charge",
    recommendedAction: "Confirm benefit coverage and coding. Appeal only when coverage terms or submitted coding support payment."
  },
  "97": {
    category: "BUNDLING",
    label: "Service may be included in another paid service",
    recommendedAction: "Review coding edits, modifiers, and payer bundling policy before correction or appeal."
  },
  "109": {
    category: "PAYER_ROUTING",
    label: "Claim may have been sent to the wrong payer",
    recommendedAction: "Verify payer responsibility and member coverage, then route the claim to the correct payer."
  },
  "197": {
    category: "AUTHORIZATION",
    label: "Authorization or precertification issue",
    recommendedAction: "Verify authorization requirements, approved dates/services, and authorization number before correction or appeal."
  }
};

const RARC = {
  N130: {
    category: "ELIGIBILITY",
    label: "Additional eligibility or coverage information is required"
  },
  N115: {
    category: "AUTHORIZATION",
    label: "Authorization-related payer remark"
  },
  N390: {
    category: "MISSING_INFORMATION",
    label: "Additional claim information is required"
  },
  M15: {
    category: "BUNDLING",
    label: "Service may be bundled with another service"
  },
  M20: {
    category: "MISSING_INFORMATION",
    label: "Missing or incomplete supporting information"
  }
};

export { DEFAULT_APPEAL_WINDOW_DAYS };

export function normalizeAdjustmentCode(value) {
  if (value == null) return "";
  return String(value).trim().toUpperCase().replace(/^CARC[-\s:]*/i, "").replace(/^RARC[-\s:]*/i, "");
}

export function lookupDenialCode(type, value) {
  const code = normalizeAdjustmentCode(value);
  if (!code) return null;
  const table = String(type || "").toUpperCase() === "RARC" ? RARC : CARC;
  const match = table[code];
  return match ? { type: String(type || "CARC").toUpperCase(), code, ...match } : {
    type: String(type || "CARC").toUpperCase(),
    code,
    category: null,
    label: "Code not in the local reference set",
    recommendedAction: null
  };
}

export function interpretDenialCodes({ carcCode, rarcCode } = {}) {
  const carc = lookupDenialCode("CARC", carcCode);
  const rarc = lookupDenialCode("RARC", rarcCode);
  const primary = carc?.category ? carc : rarc?.category ? rarc : null;

  return {
    carc,
    rarc,
    category: primary?.category || null,
    recommendedAction: carc?.recommendedAction || null
  };
}

export function parseAppealWindowDays(value, fallback = DEFAULT_APPEAL_WINDOW_DAYS) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 730) {
    const error = new Error("Appeal window must be a whole number between 1 and 730 days");
    error.status = 400;
    throw error;
  }
  return parsed;
}

export function computeAppealDeadline(denialDate, windowDays = DEFAULT_APPEAL_WINDOW_DAYS) {
  const base = denialDate instanceof Date ? new Date(denialDate) : new Date(denialDate);
  if (Number.isNaN(base.getTime())) {
    const error = new Error("Denial date is invalid");
    error.status = 400;
    throw error;
  }

  const days = parseAppealWindowDays(windowDays);
  const deadline = new Date(Date.UTC(
    base.getUTCFullYear(),
    base.getUTCMonth(),
    base.getUTCDate() + days
  ));
  return deadline;
}

export function appealDeadlineState(deadline, now = new Date()) {
  if (!deadline) return { state: "NOT_SET", daysRemaining: null };

  const end = new Date(deadline);
  if (Number.isNaN(end.getTime())) return { state: "NOT_SET", daysRemaining: null };

  const startUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const daysRemaining = Math.ceil((endUtc - startUtc) / 86400000);

  if (daysRemaining < 0) return { state: "OVERDUE", daysRemaining };
  if (daysRemaining <= 30) return { state: "DUE_SOON", daysRemaining };
  return { state: "OPEN", daysRemaining };
}

export function enrichDenialCase(denial) {
  if (!denial) return denial;
  return {
    ...denial,
    codeReference: interpretDenialCodes(denial),
    deadline: appealDeadlineState(denial.appealDeadline)
  };
}
