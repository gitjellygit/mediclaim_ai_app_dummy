const PAYERS = [
  {
    code: "BLUE_HORIZON",
    name: "Blue Horizon Health",
    description: "Balanced commercial payer with moderate authorization rules.",
    color: "#3b82f6",
    reimbursementRate: 0.82,
    authRules: ["MRI", "INPATIENT_SURGERY"],
    documentationHeavy: false
  },
  {
    code: "SUMMITCARE",
    name: "SummitCare Insurance",
    description: "Authorization-sensitive payer for advanced imaging and inpatient services.",
    color: "#7c3aed",
    reimbursementRate: 0.78,
    authRules: ["MRI", "CT", "INPATIENT"],
    documentationHeavy: false
  },
  {
    code: "METROPLUS_DEMO",
    name: "MetroPlus Mock Health",
    description: "Documentation-heavy payer that commonly pends incomplete inpatient claims.",
    color: "#ea580c",
    reimbursementRate: 0.8,
    authRules: ["INPATIENT_SURGERY"],
    documentationHeavy: true
  },
  {
    code: "CAREFIRST_DEMO",
    name: "CareFirst Demo Plan",
    description: "Eligibility-sensitive payer used to demonstrate member and coverage responses.",
    color: "#0891b2",
    reimbursementRate: 0.84,
    authRules: ["MRI"],
    documentationHeavy: false
  },
  {
    code: "APEX_BENEFIT",
    name: "Apex Benefit Network",
    description: "Payment-focused payer used to demonstrate reimbursement and underpayment behavior.",
    color: "#059669",
    reimbursementRate: 0.68,
    authRules: ["INPATIENT_SURGERY"],
    documentationHeavy: false
  }
];

export function listMockPayers() {
  return PAYERS.map(({ reimbursementRate, authRules, documentationHeavy, ...payer }) => payer);
}

export function getMockPayer(code) {
  return PAYERS.find((payer) => payer.code === code) || null;
}

function upper(value) {
  return String(value || "").toUpperCase();
}

function hasDocument(claim, type) {
  return Boolean(claim.documents?.some((doc) => doc.type === type));
}

function serviceFlags(claim) {
  const text = upper([
    claim.procedureText,
    claim.diagnosisText,
    ...(claim.icd10Codes || [])
  ].filter(Boolean).join(" "));

  return {
    mri: text.includes("MRI"),
    ct: /(^|\s)CT($|\s)|COMPUTED TOMOGRAPH/.test(text),
    surgery: /SURGER|APPENDECT|ARTHRO|REPAIR|EXCISION|OPERAT/.test(text),
    inpatient: Boolean(claim.admissionDate || claim.dischargeDate || claim.admissionType),
    highDollar: Number(claim.amount || claim.totalBilledAmount || 0) >= 50000
  };
}

function authRequiredFor(payer, claim) {
  const flags = serviceFlags(claim);
  return payer.authRules.some((rule) => {
    if (rule === "MRI") return flags.mri;
    if (rule === "CT") return flags.ct;
    if (rule === "INPATIENT") return flags.inpatient;
    if (rule === "INPATIENT_SURGERY") return flags.inpatient && flags.surgery;
    return false;
  });
}

function makeId(prefix, payerCode, claimId, sequence = 1) {
  const tail = String(claimId || "CLAIM").replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase();
  return `${prefix}-${payerCode.slice(0, 4)}-${tail}-${String(sequence).padStart(2, "0")}`;
}

export function simulateEligibility(payer, claim, sequence = 1) {
  const missing = [];
  if (!claim.memberId) missing.push("memberId");
  if (!claim.policyNo) missing.push("policyNo");

  if (missing.length) {
    return {
      transactionId: makeId("ELIG", payer.code, claim.id, sequence),
      status: "MEMBER_NOT_FOUND",
      latencyMs: 520,
      coverageStatus: "UNKNOWN",
      networkStatus: null,
      deductibleRemaining: null,
      coinsurancePct: null,
      reason: `Missing ${missing.join(", ")}`
    };
  }

  if (
    payer.code === "CAREFIRST_DEMO" &&
    !upper(claim.memberId).startsWith("CF")
  ) {
    return {
      transactionId: makeId("ELIG", payer.code, claim.id, sequence),
      status: "MEMBER_NOT_FOUND",
      latencyMs: 640,
      coverageStatus: "INACTIVE",
      networkStatus: null,
      deductibleRemaining: null,
      coinsurancePct: null,
      reason: "Demo rule: CareFirst member IDs must start with CF."
    };
  }

  return {
    transactionId: makeId("ELIG", payer.code, claim.id, sequence),
    status: "ACTIVE",
    latencyMs: payer.code === "SUMMITCARE" ? 780 : 560,
    coverageStatus: "ACTIVE",
    networkStatus: payer.code === "APEX_BENEFIT" ? "OUT_OF_NETWORK" : "IN_NETWORK",
    deductibleRemaining:
      payer.code === "BLUE_HORIZON" ? 750 :
      payer.code === "SUMMITCARE" ? 500 :
      payer.code === "APEX_BENEFIT" ? 1200 : 350,
    coinsurancePct:
      payer.code === "APEX_BENEFIT" ? 30 :
      payer.code === "SUMMITCARE" ? 20 : 15,
    reason: "Synthetic 271-style eligibility response."
  };
}

export function simulatePriorAuth(payer, claim, sequence = 1) {
  const required = authRequiredFor(payer, claim);

  if (!required) {
    return {
      transactionId: makeId("AUTH", payer.code, claim.id, sequence),
      status: "NOT_REQUIRED",
      latencyMs: 610,
      required: false,
      authorizationNo: null,
      expiry: null,
      reason: "Service does not match this mock payer's authorization rules."
    };
  }

  if (!claim.authorizationNo) {
    return {
      transactionId: makeId("AUTH", payer.code, claim.id, sequence),
      status: "REQUIRED",
      latencyMs: 820,
      required: true,
      authorizationNo: null,
      expiry: null,
      reason: "Prior authorization is required for this service."
    };
  }

  if (upper(claim.authorizationNo).includes("DENY")) {
    return {
      transactionId: makeId("AUTH", payer.code, claim.id, sequence),
      status: "DENIED",
      latencyMs: 900,
      required: true,
      authorizationNo: claim.authorizationNo,
      expiry: null,
      reason: "Synthetic denial triggered by demo authorization number."
    };
  }

  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);

  return {
    transactionId: makeId("AUTH", payer.code, claim.id, sequence),
    status: "APPROVED",
    latencyMs: 880,
    required: true,
    authorizationNo: claim.authorizationNo,
    expiry: expiry.toISOString(),
    reason: "Synthetic prior authorization approval."
  };
}

export function simulateSubmission(payer, claim, sequence = 1) {
  const flags = serviceFlags(claim);

  if (payer.documentationHeavy && flags.inpatient && !hasDocument(claim, "DISCHARGE_SUMMARY")) {
    return {
      transactionId: makeId("CLM", payer.code, claim.id, sequence),
      status: "PENDED",
      latencyMs: 740,
      payerClaimNo: makeId("PCN", payer.code, claim.id, sequence),
      reason: "Additional documentation required: discharge summary."
    };
  }

  const authRequired = authRequiredFor(payer, claim);
  const authSatisfied =
    claim.priorAuthStatus === "APPROVED" ||
    claim.priorAuthStatus === "NOT_REQUIRED" ||
    !authRequired;

  if (!authSatisfied) {
    return {
      transactionId: makeId("CLM", payer.code, claim.id, sequence),
      status: "REJECTED",
      latencyMs: 690,
      payerClaimNo: null,
      reason: "Claim rejected before adjudication because required authorization is unresolved."
    };
  }

  if (payer.code === "CAREFIRST_DEMO" && !upper(claim.memberId).startsWith("CF")) {
    return {
      transactionId: makeId("CLM", payer.code, claim.id, sequence),
      status: "REJECTED",
      latencyMs: 620,
      payerClaimNo: null,
      reason: "Member not found for simulated payer."
    };
  }

  return {
    transactionId: makeId("CLM", payer.code, claim.id, sequence),
    status: "ACCEPTED",
    latencyMs: flags.highDollar ? 980 : 720,
    payerClaimNo: makeId("PCN", payer.code, claim.id, sequence),
    reason: flags.highDollar
      ? "Claim accepted and routed to manual high-dollar review."
      : "Claim accepted into adjudication."
  };
}

export function simulateStatus(payer, claim, priorStatusChecks = 0, sequence = 1) {
  const authRequired = authRequiredFor(payer, claim);
  let status;
  let reason;

  if (priorStatusChecks === 0) {
    status = "RECEIVED";
    reason = "Claim received by simulated payer.";
  } else if (priorStatusChecks === 1) {
    status = "IN_REVIEW";
    reason = "Claim is in simulated adjudication.";
  } else if (
    payer.code === "SUMMITCARE" &&
    authRequired &&
    claim.priorAuthStatus !== "APPROVED"
  ) {
    status = "DENIED";
    reason = "Authorization required for this service but not approved.";
  } else if (
    payer.documentationHeavy &&
    serviceFlags(claim).inpatient &&
    !hasDocument(claim, "DISCHARGE_SUMMARY")
  ) {
    status = "PENDED";
    reason = "Additional medical documentation requested.";
  } else if (payer.code === "APEX_BENEFIT") {
    status = "PARTIALLY_APPROVED";
    reason = "Claim partially approved under simulated reimbursement policy.";
  } else {
    status = "APPROVED";
    reason = "Claim approved by simulated payer.";
  }

  return {
    transactionId: makeId("STS", payer.code, claim.id, sequence),
    status,
    latencyMs: 550 + Math.min(priorStatusChecks, 3) * 120,
    reason
  };
}

export function simulateRemittance(payer, claim, sequence = 1) {
  const billed = Number(claim.amount || claim.totalBilledAmount || 0);
  const allowedAmount = Math.max(0, Math.round(billed * payer.reimbursementRate));
  let paidAmount = allowedAmount;

  if (payer.code === "APEX_BENEFIT") {
    paidAmount = Math.max(0, Math.round(allowedAmount * 0.8));
  } else {
    const coinsurance = Number(claim.coinsurancePct || 0);
    paidAmount = Math.max(0, Math.round(allowedAmount * (1 - coinsurance / 100)));
  }

  const patientResponsibility = Math.max(0, allowedAmount - paidAmount);

  return {
    transactionId: makeId("ERA", payer.code, claim.id, sequence),
    status: "POSTED",
    latencyMs: 680,
    allowedAmount,
    paidAmount,
    patientResponsibility,
    paymentReference: makeId("PAY", payer.code, claim.id, sequence),
    reason:
      payer.code === "APEX_BENEFIT"
        ? "Synthetic 835-style response includes an underpayment scenario."
        : "Synthetic 835-style remittance response."
  };
}
