const DAY_MS = 24 * 60 * 60 * 1000;

function asNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function daysUntil(value, now = new Date()) {
  const target = dateOnly(value);
  const today = dateOnly(now);
  if (target == null || today == null) return null;
  return Math.ceil((target - today) / DAY_MS);
}

export function paymentOutlook(claim) {
  const status = String(claim?.status || "");
  const paid = asNumber(claim?.paidAmount);
  const approved = asNumber(claim?.approvedAmount);
  const claimed = asNumber(claim?.amount);

  if (status === "PAID") {
    const amount = paid ?? approved;
    return {
      amount,
      kind: amount == null ? "UNAVAILABLE" : "PAID",
      source:
        amount == null
          ? "Payment finalized; payer-paid amount is not recorded"
          : "Actual payer payment from posted remittance"
    };
  }

  if (status === "DENIED") {
    return {
      amount: claimed,
      kind: claimed == null ? "UNAVAILABLE" : "AT_RISK",
      source:
        claimed == null
          ? "Denied claim; billed amount is not available"
          : "Billed amount currently at risk after denial"
    };
  }

  if (approved != null && approved >= 0) {
    return {
      amount: approved,
      kind: "EXPECTED",
      source: "Payer-approved amount awaiting or preceding final payment"
    };
  }

  if (claimed == null || claimed <= 0) {
    return {
      amount: null,
      kind: "UNAVAILABLE",
      source: "Awaiting a valid billed amount"
    };
  }

  const deductions = Math.max(0, asNumber(claim?.deductionAmount) || 0);
  const copay = Math.max(0, asNumber(claim?.copayAmount) || 0);

  return {
    amount: Math.max(0, claimed - deductions - copay),
    kind: "ESTIMATE",
    source:
      deductions > 0 || copay > 0
        ? "Estimated reimbursement from billed amount less recorded deductions/copay"
        : "Estimated reimbursement from current billed amount; payer contract terms not applied"
  };
}

function issueCategory(issue) {
  const rule = String(issue?.rule || "").toUpperCase();
  const message = String(issue?.message || "").toLowerCase();

  if (
    rule.includes("AUTH") ||
    message.includes("authorization") ||
    message.includes("prior auth")
  ) return "PRIOR_AUTH";
  if (
    rule.includes("TIMELY") ||
    message.includes("timely filing") ||
    message.includes("filing deadline")
  ) return "TIMELY_FILING";
  if (
    rule.includes("CPT") ||
    rule.includes("DIAGNOSIS") ||
    rule.includes("NPI") ||
    rule.includes("837") ||
    message.includes("cpt") ||
    message.includes("hcpcs") ||
    message.includes("diagnosis") ||
    message.includes("npi") ||
    message.includes("service line")
  ) return "CLAIM_EDIT";
  if (
    message.includes("eligibility") ||
    message.includes("member") ||
    message.includes("policy")
  ) return "ELIGIBILITY";
  if (message.includes("document")) return "DOCUMENTS";
  return "CLAIM_EDIT";
}

function addAction(
  actions,
  code,
  label,
  target,
  severity = "info",
  metadata = {}
) {
  if (actions.some((item) => item.code === code)) return;
  actions.push({ code, label, target, severity, ...metadata });
}

export function buildApprovalIntelligenceItem(claim, { now = new Date() } = {}) {
  const check = Array.isArray(claim?.checks) ? claim.checks[0] || null : null;
  const issues = Array.isArray(check?.issues) ? check.issues : [];
  const blockers = issues.filter((issue) => issue?.severity === "BLOCK");
  const warnings = issues.filter((issue) => issue?.severity === "WARN");
  const score = check && Number.isFinite(Number(check.score)) ? Number(check.score) : null;
  const riskScore =
    check && Number.isFinite(Number(check.riskScore))
      ? Math.max(0, Math.min(1, Number(check.riskScore)))
      : null;
  const riskLevel = check?.riskLevel || null;
  const riskFactors = Array.isArray(check?.riskFactors) ? check.riskFactors : [];
  const isStale = Boolean(check?.isStale);
  const finalStatus = ["SUBMITTED", "DENIED", "PAID"].includes(claim?.status);
  const alreadySubmitted = Boolean(claim?.claimSubmissionDate) || finalStatus;
  const eligibilityResolved = claim?.eligibilityStatus === "VERIFIED";
  const priorAuthExpired =
    claim?.priorAuthStatus === "APPROVED" &&
    Boolean(claim?.priorAuthExpiry) &&
    daysUntil(claim.priorAuthExpiry, now) < 0;
  const priorAuthResolved =
    ["APPROVED", "NOT_REQUIRED"].includes(claim?.priorAuthStatus) &&
    !priorAuthExpired;

  const filingDaysRemaining = daysUntil(claim?.timelyFilingDeadline, now);
  const filingState =
    filingDaysRemaining == null
      ? "UNKNOWN"
      : filingDaysRemaining < 0
      ? "EXPIRED"
      : filingDaysRemaining <= 7
      ? "URGENT"
      : filingDaysRemaining <= 30
      ? "DUE_SOON"
      : "ON_TRACK";

  const actions = [];

  if (!alreadySubmitted) {
    if (filingState === "EXPIRED") {
      addAction(
        actions,
        "TIMELY_FILING_EXPIRED",
        "Review expired timely-filing deadline",
        "claim",
        "error"
      );
    } else if (filingState === "URGENT") {
      addAction(
        actions,
        "TIMELY_FILING_URGENT",
        `Submit or resolve blockers within ${filingDaysRemaining} day${filingDaysRemaining === 1 ? "" : "s"}`,
        "claim",
        "error"
      );
    } else if (filingState === "DUE_SOON") {
      addAction(
        actions,
        "TIMELY_FILING_DUE_SOON",
        `Timely filing due in ${filingDaysRemaining} days`,
        "claim",
        "warning"
      );
    }

    if (!check) {
      addAction(
        actions,
        "RUN_READINESS",
        "Run pre-submission readiness check",
        "readiness",
        "warning"
      );
    } else if (isStale) {
      addAction(
        actions,
        "REFRESH_READINESS",
        "Refresh readiness after claim changes",
        "readiness",
        "warning"
      );
    }

    if (!eligibilityResolved) {
      addAction(
        actions,
        "VERIFY_ELIGIBILITY",
        "Verify current eligibility and benefits",
        "eligibility",
        "error"
      );
    }

    if (!priorAuthResolved) {
      addAction(
        actions,
        "RESOLVE_PRIOR_AUTH",
        claim?.priorAuthRequired === true
          ? "Resolve required prior authorization"
          : "Confirm whether prior authorization is required",
        "prior-auth",
        "error"
      );
    }

    for (const issue of blockers) {
      const category = issueCategory(issue);
      addAction(
        actions,
        `BLOCKER_${issue?.rule || issue?.field || actions.length}`,
        issue?.message || "Resolve blocking claim issue",
        issue?.fixTarget || category.toLowerCase(),
        "error",
        {
          field: issue?.field || null,
          rule: issue?.rule || null
        }
      );
    }

    if (
      check &&
      !isStale &&
      blockers.length === 0 &&
      score != null &&
      score >= 80 &&
      eligibilityResolved &&
      priorAuthResolved
    ) {
      addAction(
        actions,
        "READY_TO_SUBMIT",
        "Review and submit claim",
        "journey",
        "success"
      );
    }
  }

  let actionState = "ACTION_REQUIRED";
  if (alreadySubmitted) {
    actionState = claim?.status === "PAID" ? "FINALIZED" : "SUBMITTED";
  } else if (!check) {
    actionState = "NOT_EVALUATED";
  } else if (isStale) {
    actionState = "REFRESH_REQUIRED";
  } else if (
    blockers.length === 0 &&
    score != null &&
    score >= 80 &&
    eligibilityResolved &&
    priorAuthResolved
  ) {
    actionState = "READY_TO_SUBMIT";
  }

  const workDueDays = daysUntil(claim?.workDueAt, now);
  const followUpDays = daysUntil(claim?.nextFollowUpAt, now);
  const workOverdue =
    (workDueDays != null && workDueDays < 0) ||
    (followUpDays != null && followUpDays < 0);

  let priority = "LOW";
  if (workOverdue || (!alreadySubmitted && (filingState === "EXPIRED" || filingState === "URGENT"))) {
    priority = "CRITICAL";
  } else if (
    !alreadySubmitted &&
    (
      blockers.length > 0 ||
      ["FAILED", "NEEDS_REVIEW"].includes(claim?.eligibilityStatus) ||
      claim?.priorAuthStatus === "DENIED" ||
      (claim?.priorAuthRequired === true && !priorAuthResolved)
    )
  ) {
    priority = "HIGH";
  } else if (
    !alreadySubmitted &&
    (isStale || !check || filingState === "DUE_SOON" || warnings.length > 0)
  ) {
    priority = "MEDIUM";
  }

  const pendingCodingSuggestions = Array.isArray(claim?.codingSuggestions)
    ? claim.codingSuggestions.length
    : 0;
  const verifiedServiceLines = Array.isArray(claim?.serviceLines)
    ? claim.serviceLines.filter((line) => line?.verified !== false).length
    : 0;

  return {
    id: claim.id,
    createdAt: claim.createdAt,
    claimSubmissionDate: claim.claimSubmissionDate || null,
    patientName: claim.patientName,
    payerName: claim.payerName,
    memberId: claim.memberId,
    policyNo: claim.policyNo,
    insurerClaimNo: claim.insurerClaimNo,
    authorizationNo: claim.authorizationNo,
    claimForm: claim.claimForm,
    status: claim.status,
    amount: asNumber(claim.amount),
    actionState,
    priority,
    readiness: {
      score,
      state: !check ? "NOT_EVALUATED" : isStale ? "STALE" : "CURRENT",
      checkedAt: check?.createdAt || null,
      staleReason: check?.staleReason || null,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      blockers: blockers.slice(0, 5)
    },
    submissionRisk: {
      level: riskLevel,
      score: riskScore,
      factors: riskFactors.slice(0, 5),
      methodology:
        riskLevel == null
          ? "Not evaluated"
          : "Rules-based pre-submission risk signal; not a payer approval probability"
    },
    eligibility: {
      status: claim.eligibilityStatus,
      checkedAt: claim.eligibilityCheckedAt || null,
      coverageStatus: claim.coverageStatus || null,
      networkStatus: claim.networkStatus || null
    },
    priorAuthorization: {
      required: claim.priorAuthRequired,
      status: claim.priorAuthStatus,
      authorizationNo: claim.authorizationNo || null,
      expiresAt: claim.priorAuthExpiry || null,
      expired: priorAuthExpired
    },
    timelyFiling: {
      deadline: claim.timelyFilingDeadline || null,
      daysRemaining: filingDaysRemaining,
      state: filingState
    },
    coding: {
      verifiedServiceLines,
      pendingSuggestions: pendingCodingSuggestions
    },
    payerConnection: {
      mode: claim.payerConnectionMode,
      connectorId: claim.payerConnectorId || null
    },
    documentsCount: Array.isArray(claim?.documents) ? claim.documents.length : 0,
    workManagement: {
      assignedToUser: claim.assignedToUser || null,
      workTeam: claim.workTeam || null,
      workDueAt: claim.workDueAt || null,
      nextFollowUpAt: claim.nextFollowUpAt || null,
      lastWorkedAt: claim.lastWorkedAt || null,
      escalatedAt: claim.escalatedAt || null,
      overdue: workOverdue,
      dueInDays:
        followUpDays != null
          ? followUpDays
          : workDueDays
    },
    paymentOutlook: paymentOutlook(claim),
    nextActions: actions.slice(0, 5)
  };
}
