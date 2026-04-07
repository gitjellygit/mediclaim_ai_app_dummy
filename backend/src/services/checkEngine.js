export async function runChecks({ claim, documents, rules }) {
  const issues = [];
  let score = 100;

  // Helper to check if document type exists
  const hasDocType = (type) => documents.some((d) => d.type === type);

  // No docs at all: -60 (BLOCK) - check this first to avoid double-counting
  if (documents.length === 0) {
    issues.push({
      rule: "NO_DOCUMENTS",
      severity: "BLOCK",
      message: "No documents uploaded. At least one document is required."
    });
    score -= 60;
  } else {
    // 1. MANDATORY DOCUMENTS (v1 - India claim workflows)

    // DISCHARGE_SUMMARY: BLOCK if missing (-35)
    if (!hasDocType("DISCHARGE_SUMMARY")) {
      issues.push({
        rule: "REQ_DISCHARGE_SUMMARY",
        severity: "BLOCK",
        message: "Missing required document: DISCHARGE_SUMMARY"
      });
      score -= 35;
    }

    // FINAL_BILL: BLOCK if missing (-35)
    if (!hasDocType("FINAL_BILL")) {
      issues.push({
        rule: "REQ_FINAL_BILL",
        severity: "BLOCK",
        message: "Missing required document: FINAL_BILL"
      });
      score -= 35;
    }

    // ID_PROOF: BLOCK if missing (-20, configurable to WARN)
    if (!hasDocType("ID_PROOF")) {
      issues.push({
        rule: "REQ_ID_PROOF",
        severity: "BLOCK",
        message: "Missing required document: ID_PROOF"
      });
      score -= 20;
    }
  }

  // LAB_REPORT / RADIOLOGY / PRESCRIPTION: WARN if missing (-5 each, not always mandatory)
  if (!hasDocType("LAB_REPORT")) {
    issues.push({
      rule: "RECOMMENDED_LAB_REPORT",
      severity: "WARN",
      message: "Missing recommended document: LAB_REPORT"
    });
    score -= 5;
  }

  if (!hasDocType("RADIOLOGY")) {
    issues.push({
      rule: "RECOMMENDED_RADIOLOGY",
      severity: "WARN",
      message: "Missing recommended document: RADIOLOGY"
    });
    score -= 5;
  }

  if (!hasDocType("PRESCRIPTION")) {
    issues.push({
      rule: "RECOMMENDED_PRESCRIPTION",
      severity: "WARN",
      message: "Missing recommended document: PRESCRIPTION"
    });
    score -= 5;
  }

  // 2. CORE REQUIRED FIELDS (BLOCK)

  // patientName: BLOCK if missing
  if (!claim.patientName || String(claim.patientName).trim().length === 0) {
    issues.push({
      rule: "REQ_PATIENT_NAME",
      severity: "BLOCK",
      message: "Patient name is required"
    });
    score -= 30; // High penalty for missing core field
  }

  // payerName: BLOCK if missing
  if (!claim.payerName || String(claim.payerName).trim().length === 0) {
    issues.push({
      rule: "REQ_PAYER_NAME",
      severity: "BLOCK",
      message: "Payer name is required"
    });
    score -= 30; // High penalty for missing core field
  }

  // amount: BLOCK if missing or invalid
  if (!claim.amount || claim.amount <= 0) {
    issues.push({
      rule: "REQ_AMOUNT",
      severity: "BLOCK",
      message: "Claim amount must be greater than 0"
    });
    score -= 50; // Claimed <= 0: -50 (BLOCK)
  }

  // policyNo: BLOCK if missing (-20)
  if (!claim.policyNo || String(claim.policyNo).trim().length === 0) {
    issues.push({
      rule: "REQ_POLICY_NO",
      severity: "BLOCK",
      message: "Policy number is required (cannot submit without policy)"
    });
    score -= 20;
  }

  // 3. ADDITIONAL VALIDATION RULES

  // Claimed > billed (if billed exists): -25 (BLOCK)
  if (claim.totalBilledAmount && claim.amount > claim.totalBilledAmount) {
    issues.push({
      rule: "AMOUNT_EXCEEDS_BILLED",
      severity: "BLOCK",
      message: `Claimed amount (${claim.amount}) exceeds billed amount (${claim.totalBilledAmount})`
    });
    score -= 25;
  }

  // Missing ICD (optional): -5 (WARN)
  if (!claim.icd10Codes || claim.icd10Codes.length === 0) {
    issues.push({
      rule: "RECOMMENDED_ICD",
      severity: "WARN",
      message: "ICD-10 codes are recommended for better claim processing"
    });
    score -= 5;
  }

  // Ensure score stays within bounds
  score = Math.max(0, Math.min(100, score));

  return { score, issues };
}
