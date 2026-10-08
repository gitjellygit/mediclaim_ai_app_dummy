import { PayerConnectorUnavailableError } from "./payerConnectorRegistry.js";

const DEFAULT_BASE_URL = "https://healthcare.us.stedi.com/2026-06-01";
const DEFAULT_CLAIMS_BASE_URL = "https://healthcare.us.stedi.com/2024-04-01";

function required(value, name) {
  if (value == null || value === "") {
    const error = new Error(`${name} is required for the Stedi request`);
    error.code = "STEDI_REQUEST_INVALID";
    throw error;
  }
  return value;
}

function patientNameParts(claim) {
  const source = String(claim.subscriberName || claim.patientName || "").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return { firstName: parts[0] || null, lastName: null };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

function dateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function buildStediEligibilityRequest(claim, context = {}) {
  if (context.requestPayload) return context.requestPayload;

  const names = patientNameParts(claim);
  const payerId = context.payerId || claim.payerEdiId;
  const memberId = claim.subscriberId || claim.memberId;
  const dateOfBirth = dateOnly(claim.patientDob);
  const npi = context.providerNpi || claim.billingProviderNpi || claim.renderingProviderNpi;

  required(payerId, "payerEdiId");
  required(memberId, "memberId/subscriberId");
  required(dateOfBirth, "patientDob");
  required(names.firstName, "subscriber first name");
  required(names.lastName, "subscriber last name");
  required(npi, "provider NPI");

  return {
    payerId,
    subscriber: {
      dateOfBirth,
      memberId,
      name: {
        person: {
          firstName: names.firstName,
          lastName: names.lastName
        }
      }
    },
    provider: {
      name: {
        organization: context.providerName || claim.hospitalName || "CLAIM APP Test Provider"
      },
      npi
    },
    encounter: {
      services: [
        {
          value: context.serviceTypeCode || "30",
          system: "STC"
        }
      ]
    },
    externalPatientId: String(claim.id || "").slice(0, 36) || undefined
  };
}

function compactDate(value) {
  const normalized = dateOnly(value);
  return normalized ? normalized.replaceAll("-", "") : null;
}

export function buildStediClaimStatusRequest(claim, context = {}) {
  if (context.requestPayload) return context.requestPayload;

  const names = patientNameParts(claim);
  const payerId = context.payerId || claim.payerEdiId;
  const memberId = claim.subscriberId || claim.memberId;
  const dateOfBirth = compactDate(claim.patientDob);
  const providerNpi =
    context.providerNpi || claim.billingProviderNpi || claim.renderingProviderNpi;
  const beginningDateOfService = compactDate(
    claim.dateOfService || claim.admissionDate || claim.procedureDate
  );
  const endDateOfService = compactDate(
    claim.dischargeDate || claim.dateOfService || claim.admissionDate || claim.procedureDate
  );

  required(payerId, "payerEdiId");
  required(memberId, "memberId/subscriberId");
  required(dateOfBirth, "patientDob");
  required(names.firstName, "subscriber first name");
  required(names.lastName, "subscriber last name");
  required(providerNpi, "provider NPI");
  required(beginningDateOfService, "dateOfService/admissionDate");

  return {
    tradingPartnerServiceId: payerId,
    providers: [
      {
        npi: providerNpi,
        organizationName:
          context.providerName || claim.hospitalName || "CLAIM APP Provider",
        providerType: "BillingProvider"
      }
    ],
    subscriber: {
      dateOfBirth,
      firstName: names.firstName,
      lastName: names.lastName,
      memberId
    },
    encounter: {
      beginningDateOfService,
      ...(endDateOfService && endDateOfService !== beginningDateOfService
        ? { endDateOfService }
        : {})
    }
  };
}

function selectClaimStatusResult(claims, claim = {}) {
  if (!Array.isArray(claims) || claims.length === 0) return null;
  if (claims.length === 1) return claims[0];

  const expected = String(claim.insurerClaimNo || claim.payerReferenceNo || "").trim();
  if (!expected) return null;

  return (
    claims.find((item) => {
      const status = item?.claimStatus || {};
      return [
        status.tradingPartnerClaimNumber,
        status.trackingNumber,
        status.patientAccountNumber,
        status.clearingHouseClaimNumber
      ]
        .filter(Boolean)
        .some((value) => String(value).trim() === expected);
    }) || null
  );
}

function normalizedPayerStatus(status = {}) {
  const category = String(status.statusCategoryCode || "").toUpperCase();
  const description = [
    status.statusCategoryCodeValue,
    status.statusCodeValue
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  if (
    category === "F1" ||
    Number(status.amountPaid || 0) > 0 ||
    /\bPAID\b/.test(description)
  ) {
    return "PAID";
  }
  if (category === "F2" || /DENIAL|DENIED|REJECTED/.test(description)) {
    return "DENIED";
  }
  if (category === "F0" || category === "F3" || /FINALIZED|APPROVED/.test(description)) {
    return "APPROVED";
  }
  if (/^P[1-5]$/.test(category) || /PENDING|IN PROCESS|PROCESSING/.test(description)) {
    return "IN_REVIEW";
  }
  if (category === "D0") return "NOT_FOUND";
  if (category === "E1") return "UNAVAILABLE";
  return "ACKNOWLEDGED";
}

export function normalizeStediClaimStatusResponse(body, {
  claim = {},
  latencyMs = null
} = {}) {
  const claims = Array.isArray(body?.claims) ? body.claims : [];
  const selected = selectClaimStatusResult(claims, claim);

  if (!selected) {
    return {
      transactionId: body?.controlNumber || body?.id || null,
      status: claims.length > 1 ? "NEEDS_REVIEW" : "NOT_FOUND",
      claimCount: claims.length,
      latencyMs,
      transactionType: "276/277",
      livePayerVerification: true,
      testMode: false,
      raw: body
    };
  }

  const claimStatus = selected.claimStatus || {};
  return {
    transactionId:
      body?.controlNumber ||
      claimStatus.trackingNumber ||
      claimStatus.tradingPartnerClaimNumber ||
      body?.id ||
      null,
    status: normalizedPayerStatus(claimStatus),
    claimCount: claims.length,
    statusCategoryCode: claimStatus.statusCategoryCode || null,
    statusCategoryCodeValue: claimStatus.statusCategoryCodeValue || null,
    statusCode: claimStatus.statusCode || null,
    statusCodeValue: claimStatus.statusCodeValue || null,
    payerClaimNo:
      claimStatus.tradingPartnerClaimNumber ||
      claimStatus.trackingNumber ||
      claim.insurerClaimNo ||
      null,
    patientAccountNumber: claimStatus.patientAccountNumber || null,
    submittedAmount:
      claimStatus.submittedAmount != null
        ? Number(claimStatus.submittedAmount)
        : null,
    amountPaid:
      claimStatus.amountPaid != null ? Number(claimStatus.amountPaid) : null,
    paidDate: claimStatus.paidDate || null,
    effectiveDate: claimStatus.effectiveDate || null,
    checkNumber: claimStatus.checkNumber || null,
    latencyMs,
    transactionType: "276/277",
    livePayerVerification: true,
    testMode: false,
    raw: body
  };
}


function moneyOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeAdjustmentRows(rows = [], scope = "CLAIM") {
  const normalized = [];
  for (const row of rows || []) {
    const groupCode = row?.claimAdjustmentGroupCode || null;
    for (let index = 1; index <= 6; index += 1) {
      const code = row?.[`adjustmentReasonCode${index}`];
      const amount = moneyOrNull(row?.[`adjustmentAmount${index}`]);
      const description = row?.[`adjustmentReason${index}`] || null;
      if (!code && amount == null && !description) continue;
      normalized.push({
        scope,
        groupCode,
        groupDescription: row?.claimAdjustmentGroupCodeValue || null,
        reasonCode: code || null,
        reason: description,
        amount
      });
    }
  }
  return normalized;
}

function flatten835Payments(body = {}) {
  const entries = [];
  for (const transaction of body?.transactions || []) {
    for (const detail of transaction?.detailInfo || []) {
      for (const payment of detail?.paymentInfo || []) {
        entries.push({ transaction, detail, payment });
      }
    }
  }
  return entries;
}

function normalizePcn(value) {
  return String(value || "").trim().toUpperCase();
}

function serviceAllowedAmount(payment = {}) {
  const values = (payment.serviceLines || [])
    .map((line) => moneyOrNull(line?.serviceSupplementalAmounts?.allowedActual))
    .filter((value) => value != null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

export function normalizeStedi835Report(
  body,
  {
    expectedPatientControlNumber = null,
    transactionId = null,
    latencyMs = null
  } = {}
) {
  const entries = flatten835Payments(body);
  const expected = normalizePcn(expectedPatientControlNumber);
  const matching = expected
    ? entries.filter(({ payment }) =>
        normalizePcn(payment?.claimPaymentInfo?.patientControlNumber) === expected
      )
    : entries;

  if (expected && matching.length === 0) {
    return {
      status: "NOT_FOUND",
      transactionId: transactionId || body?.meta?.transactionId || null,
      patientControlNumber: expectedPatientControlNumber || null,
      matchCount: 0,
      transactionType: "835",
      latencyMs,
      testMode: String(body?.meta?.applicationMode || "").toLowerCase() === "test",
      raw: body
    };
  }

  if (matching.length !== 1) {
    return {
      status: matching.length > 1 ? "NEEDS_REVIEW" : "NOT_FOUND",
      transactionId: transactionId || body?.meta?.transactionId || null,
      patientControlNumber: expectedPatientControlNumber || null,
      matchCount: matching.length,
      transactionType: "835",
      latencyMs,
      testMode: String(body?.meta?.applicationMode || "").toLowerCase() === "test",
      raw: body
    };
  }

  const { transaction, payment } = matching[0];
  const claimPayment = payment?.claimPaymentInfo || {};
  const claimAdjustments = normalizeAdjustmentRows(
    payment?.claimAdjustments || [],
    "CLAIM"
  );
  const serviceAdjustments = (payment?.serviceLines || []).flatMap((line) =>
    normalizeAdjustmentRows(line?.serviceAdjustments || [], "SERVICE").map((item) => ({
      ...item,
      lineItemControlNumber: line?.lineItemControlNumber || null,
      procedureCode:
        line?.servicePaymentInformation?.adjudicatedProcedureCode || null
    }))
  );
  const allowedAmount = serviceAllowedAmount(payment);
  const paidAmount = moneyOrNull(claimPayment.claimPaymentAmount);
  const patientResponsibility = moneyOrNull(
    claimPayment.patientResponsibilityAmount
  );
  const expectedPayerPayment =
    allowedAmount != null
      ? Math.max(0, allowedAmount - Number(patientResponsibility || 0))
      : null;
  const potentialUnderpayment =
    expectedPayerPayment != null && paidAmount != null
      ? Math.max(0, expectedPayerPayment - paidAmount)
      : null;

  return {
    status: "POSTED",
    transactionId:
      transactionId || body?.meta?.transactionId || transaction?.controlNumber || null,
    controlNumber: transaction?.controlNumber || null,
    patientControlNumber: claimPayment.patientControlNumber || null,
    payerClaimControlNumber: claimPayment.payerClaimControlNumber || null,
    claimStatusCode: claimPayment.claimStatusCode || null,
    billedAmount: moneyOrNull(claimPayment.totalClaimChargeAmount),
    allowedAmount,
    paidAmount,
    patientResponsibility,
    expectedPayerPayment,
    potentialUnderpayment,
    paymentReference:
      transaction?.paymentAndRemitReassociationDetails?.checkOrEFTTraceNumber ||
      null,
    paymentMethod: transaction?.financialInformation?.paymentMethodCode || null,
    paymentDate:
      transaction?.financialInformation?.checkIssueOrEFTEffectiveDate || null,
    payerName: transaction?.payer?.name || null,
    payeeNpi: transaction?.payee?.npi || null,
    memberId: payment?.patientName?.memberId || null,
    adjustments: [...claimAdjustments, ...serviceAdjustments],
    transactionType: "835",
    latencyMs,
    testMode: String(body?.meta?.applicationMode || "").toLowerCase() === "test",
    raw: body
  };
}

function stediTransactionType(item = {}) {
  return (
    item?.x12?.metadata?.transaction?.transactionSetIdentifier ||
    item?.x12?.transactionSetIdentifier ||
    ""
  );
}

async function fetchStedi835Report({
  transactionId,
  apiKey,
  eraBaseUrl,
  fetchImpl,
  signal
}) {
  const startedAt = Date.now();
  const response = await fetchImpl(
    `${eraBaseUrl}/change/medicalnetwork/reports/v2/${encodeURIComponent(
      transactionId
    )}/835`,
    {
      headers: { Authorization: apiKey },
      signal
    }
  );
  const body = await parseResponse(response);
  return { body, latencyMs: Date.now() - startedAt };
}

async function discoverStedi835({
  expectedPatientControlNumber,
  startDateTime,
  apiKey,
  coreBaseUrl,
  eraBaseUrl,
  fetchImpl,
  signal
}) {
  required(expectedPatientControlNumber, "expectedPatientControlNumber");

  const fallbackStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const requestedStart = startDateTime ? new Date(startDateTime) : fallbackStart;
  const safeStart = Number.isNaN(requestedStart.getTime())
    ? fallbackStart
    : requestedStart;
  // Stedi requires a time at least one minute in the past.
  const latestAllowed = new Date(Date.now() - 60 * 1000);
  const pollStart = safeStart > latestAllowed ? latestAllowed : safeStart;

  const url = new URL(`${coreBaseUrl}/polling/transactions`);
  url.searchParams.set("startDateTime", pollStart.toISOString());
  url.searchParams.set("pageSize", "100");

  const pollResponse = await fetchImpl(url, {
    headers: { Authorization: apiKey },
    signal
  });
  const pollBody = await parseResponse(pollResponse);
  const candidates = (pollBody?.items || [])
    .filter(
      (item) =>
        String(item?.direction || "").toUpperCase() === "INBOUND" &&
        String(item?.status || "").toLowerCase() === "succeeded" &&
        String(stediTransactionType(item)) === "835" &&
        item?.transactionId
    )
    .slice(-20)
    .reverse();

  const matches = [];
  for (const candidate of candidates) {
    const { body, latencyMs } = await fetchStedi835Report({
      transactionId: candidate.transactionId,
      apiKey,
      eraBaseUrl,
      fetchImpl,
      signal
    });
    const normalized = normalizeStedi835Report(body, {
      expectedPatientControlNumber,
      transactionId: candidate.transactionId,
      latencyMs
    });
    if (normalized.status === "POSTED") {
      matches.push(normalized);
    }
  }

  if (matches.length === 1) {
    return {
      ...matches[0],
      nextPageToken: pollBody?.nextPageToken || null
    };
  }

  return {
    status: matches.length > 1 ? "NEEDS_REVIEW" : "NOT_AVAILABLE",
    transactionType: "835",
    matchCount: matches.length,
    candidateTransactionIds: matches.map((item) => item.transactionId),
    nextPageToken: pollBody?.nextPageToken || null,
    testMode: true
  };
}

export function buildStediClaimSubmissionRequest(claim, context = {}) {
  if (context.requestPayload) {
    return {
      payload: {
        ...context.requestPayload,
        usageIndicator: "T"
      },
      claimType: String(context.claimType || claim?.claimForm || "PROFESSIONAL").toUpperCase()
    };
  }

  const error = new Error(
    "Stedi claim submission requires an explicit validated 837P/837I request payload"
  );
  error.code = "STEDI_CLAIM_REQUEST_INVALID";
  throw error;
}

export function normalizeStediClaimSubmissionResponse(body, {
  claimType,
  latencyMs = null,
  idempotencyKey = null
} = {}) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const claimReference = body?.claimReference || {};
  const transactionId =
    claimReference.correlationId ||
    claimReference.customerClaimNumber ||
    body?.submissionId ||
    body?.claimId ||
    null;

  return {
    transactionId,
    status: errors.length > 0 ? "REJECTED" : "ACKNOWLEDGED",
    acknowledgmentType: "277CA",
    claimType: String(claimType || claimReference.claimType || "").toUpperCase() || null,
    patientControlNumber: claimReference.patientControlNumber || null,
    payerId: claimReference.payerId || null,
    errors: errors.map((item) => ({
      code: item?.code || null,
      description: item?.description || item?.message || null
    })),
    has277CA: Boolean(body?.x12),
    x12: body?.x12 || null,
    latencyMs,
    idempotencyKey,
    testMode: true,
    livePayerSubmission: false
  };
}

function flattenBenefitGroups(body) {
  const groups = [];
  for (const plan of body?.plans || []) {
    const benefits = plan?.benefits || {};
    for (const [type, entries] of Object.entries(benefits)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) groups.push({ type, ...entry });
    }
  }
  return groups;
}

function firstMoney(entries, type) {
  const hit = entries.find(
    (entry) =>
      entry.type === type &&
      (entry.amount != null || entry.benefitAmount != null)
  );
  const value = hit?.amount ?? hit?.benefitAmount;
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstPercent(entries, type) {
  const hit = entries.find(
    (entry) =>
      entry.type === type &&
      (entry.percent != null || entry.benefitPercent != null)
  );
  const value = hit?.percent ?? hit?.benefitPercent;
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number <= 1 ? Math.round(number * 100) : Math.round(number);
}

export function normalizeStediEligibilityResponse(
  body,
  {
    latencyMs = null,
    testMode = true,
    livePayerVerification = !testMode
  } = {}
) {
  const benefits = flattenBenefitGroups(body);
  const statuses = benefits.filter((entry) => entry.type === "statuses");
  const active = statuses.some((entry) =>
    String(entry.status || "").toUpperCase().startsWith("ACTIVE")
  );
  const inactive =
    statuses.length > 0 &&
    statuses.every((entry) =>
      String(entry.status || "").toUpperCase().startsWith("INACTIVE")
    );

  const result = String(body?.result || "").toUpperCase();
  const status =
    active || result === "ACTIVE"
      ? "ACTIVE"
      : inactive || result === "INACTIVE"
      ? "INACTIVE"
      : ["FAILED", "INVESTIGATE"].includes(result)
      ? result
      : benefits.length > 0
      ? "ACTIVE"
      : "NEEDS_REVIEW";

  const deductibleAmount =
    firstMoney(benefits, "deductible") ??
    firstMoney(benefits, "deductibles");
  const coinsuranceBenefitPct =
    firstPercent(benefits, "coInsurance") ??
    firstPercent(benefits, "coinsurance");

  return {
    transactionId: body?.id || body?.eligibilityCheckId || body?.transactionId || null,
    status,
    coverageStatus:
      status === "ACTIVE" ? "ACTIVE" :
      status === "INACTIVE" ? "INACTIVE" : "UNKNOWN",
    // Benefit-level network indicators do not prove the requesting provider
    // is in-network, so do not persist them as provider network status.
    networkStatus: null,
    // A returned deductible is not necessarily the patient's remaining
    // deductible. Keep it in the response summary until we model benefit
    // periods/remaining amounts explicitly.
    deductibleRemaining: null,
    coinsurancePct: null,
    benefitSummary: {
      deductibleAmount,
      coinsuranceBenefitPct,
      benefitEntryCount: benefits.length
    },
    missingFields: [],
    latencyMs,
    livePayerVerification,
    testMode,
    rawResult: result || null
  };
}

async function parseResponse(response) {
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: "Non-JSON response from Stedi" };
    }
  }

  if (!response.ok) {
    const error = new Error(
      body?.message || body?.error || `Stedi request failed with HTTP ${response.status}`
    );
    error.code = "STEDI_API_ERROR";
    error.status = response.status;
    error.retryAfter = response.headers?.get?.("retry-after") || null;
    throw error;
  }

  return body || {};
}

export function createStediTestConnector({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const apiKey = String(env.STEDI_TEST_API_KEY || "").trim();
  const baseUrl = String(env.STEDI_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const claimsBaseUrl = String(env.STEDI_CLAIMS_API_BASE_URL || DEFAULT_CLAIMS_BASE_URL).replace(/\/$/, "");
  const coreBaseUrl = String(
    env.STEDI_CORE_API_BASE_URL || "https://core.us.stedi.com/2023-08-01"
  ).replace(/\/$/, "");
  const eraBaseUrl = String(
    env.STEDI_ERA_API_BASE_URL || DEFAULT_CLAIMS_BASE_URL
  ).replace(/\/$/, "");

  if (!apiKey) {
    throw new PayerConnectorUnavailableError(
      "STEDI_TEST",
      "STEDI_TEST_API_KEY is not configured"
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch implementation is required for Stedi connector");
  }

  const notYetImplemented = (operation) => {
    throw new PayerConnectorUnavailableError(
      "STEDI_TEST",
      `${operation} is planned for the next Stedi claims/remittance slice`
    );
  };

  return Object.freeze({
    mode: "LIVE",

    async checkEligibility(claim, context = {}) {
      const payload = buildStediEligibilityRequest(claim, context);
      const startedAt = Date.now();
      const response = await fetchImpl(`${baseUrl}/eligibility-check`, {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: context.signal
      });
      const body = await parseResponse(response);
      return normalizeStediEligibilityResponse(body, {
        latencyMs: Date.now() - startedAt
      });
    },

    requestPriorAuth() {
      return notYetImplemented("requestPriorAuth");
    },

    async submitClaim(claim, context = {}) {
      const { payload, claimType } = buildStediClaimSubmissionRequest(claim, context);
      const normalizedType = claimType === "INSTITUTIONAL" ? "INSTITUTIONAL" : "PROFESSIONAL";
      const path =
        normalizedType === "INSTITUTIONAL"
          ? "/change/medicalnetwork/institutionalclaims/v1/submission"
          : "/change/medicalnetwork/professionalclaims/v3/submission";
      const idempotencyKey = String(
        context.idempotencyKey || `claim-app-${claim?.id || "claim"}-${normalizedType}`
      ).slice(0, 255);

      const startedAt = Date.now();
      const response = await fetchImpl(`${claimsBaseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify(payload),
        signal: context.signal
      });
      const body = await parseResponse(response);
      return normalizeStediClaimSubmissionResponse(body, {
        claimType: normalizedType,
        latencyMs: Date.now() - startedAt,
        idempotencyKey
      });
    },

    getStatus() {
      return notYetImplemented("getStatus");
    },

    async getRemittance(claim, context = {}) {
      const expectedPatientControlNumber =
        context.expectedPatientControlNumber ||
        context.patientControlNumber ||
        claim?.payerReferenceNo ||
        null;

      if (context.transactionId) {
        const { body, latencyMs } = await fetchStedi835Report({
          transactionId: context.transactionId,
          apiKey,
          eraBaseUrl,
          fetchImpl,
          signal: context.signal
        });
        return normalizeStedi835Report(body, {
          expectedPatientControlNumber,
          transactionId: context.transactionId,
          latencyMs
        });
      }

      return discoverStedi835({
        expectedPatientControlNumber,
        startDateTime:
          context.startDateTime ||
          claim?.claimSubmissionDate ||
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        apiKey,
        coreBaseUrl,
        eraBaseUrl,
        fetchImpl,
        signal: context.signal
      });
    }
  });
}

export function createStediProductionConnector({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const apiKey = String(env.STEDI_PRODUCTION_API_KEY || "").trim();
  const baseUrl = String(
    env.STEDI_PRODUCTION_API_BASE_URL || DEFAULT_BASE_URL
  ).replace(/\/$/, "");
  const claimStatusUrl = String(env.STEDI_CLAIM_STATUS_URL || "").trim();

  if (!apiKey) {
    throw new PayerConnectorUnavailableError(
      "STEDI_PRODUCTION",
      "STEDI_PRODUCTION_API_KEY is not configured"
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch implementation is required for Stedi connector");
  }

  const unavailable = (operation) => {
    throw new PayerConnectorUnavailableError(
      "STEDI_PRODUCTION",
      `${operation} is not enabled for the current production connector slice`
    );
  };

  return Object.freeze({
    mode: "LIVE",

    async checkEligibility(claim, context = {}) {
      const payload = buildStediEligibilityRequest(claim, context);
      const startedAt = Date.now();
      const response = await fetchImpl(`${baseUrl}/eligibility-check`, {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: context.signal
      });
      const body = await parseResponse(response);
      return normalizeStediEligibilityResponse(body, {
        latencyMs: Date.now() - startedAt,
        testMode: false,
        livePayerVerification: true
      });
    },

    requestPriorAuth() {
      return unavailable("requestPriorAuth");
    },

    submitClaim() {
      return unavailable("submitClaim");
    },

    async getStatus(claim, context = {}) {
      if (!claimStatusUrl) {
        throw new PayerConnectorUnavailableError(
          "STEDI_PRODUCTION",
          "STEDI_CLAIM_STATUS_URL is not configured"
        );
      }

      const payload = buildStediClaimStatusRequest(claim, context);
      const startedAt = Date.now();
      const response = await fetchImpl(claimStatusUrl, {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: context.signal
      });
      const body = await parseResponse(response);
      return normalizeStediClaimStatusResponse(body, {
        claim,
        latencyMs: Date.now() - startedAt
      });
    },

    getRemittance() {
      return unavailable("getRemittance");
    }
  });
}

export async function listStediPayers({
  env = process.env,
  fetchImpl = globalThis.fetch,
  pageSize = 100
} = {}) {
  const apiKey = String(env.STEDI_TEST_API_KEY || "").trim();
  const baseUrl = String(env.STEDI_PAYER_API_BASE_URL || "https://healthcare.us.stedi.com/2024-04-01").replace(/\/$/, "");
  if (!apiKey) {
    throw new PayerConnectorUnavailableError(
      "STEDI_TEST",
      "STEDI_TEST_API_KEY is not configured"
    );
  }

  const url = new URL(`${baseUrl}/payers`);
  url.searchParams.set("pageSize", String(Math.max(10, Math.min(500, pageSize))));
  const response = await fetchImpl(url, {
    headers: { Authorization: apiKey }
  });
  return parseResponse(response);
}


export async function searchStediPayers({
  query,
  env = process.env,
  fetchImpl = globalThis.fetch,
  pageSize = 20,
  eligibilityOnly = true
} = {}) {
  const apiKey = String(env.STEDI_TEST_API_KEY || "").trim();
  const baseUrl = String(
    env.STEDI_PAYER_API_BASE_URL || "https://healthcare.us.stedi.com/2024-04-01"
  ).replace(/\/$/, "");
  if (!apiKey) {
    throw new PayerConnectorUnavailableError(
      "STEDI_TEST",
      "STEDI_TEST_API_KEY is not configured"
    );
  }

  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) {
    return listStediPayers({ env, fetchImpl, pageSize });
  }

  const url = new URL(`${baseUrl}/payers/search`);
  url.searchParams.set("query", normalizedQuery.slice(0, 200));
  url.searchParams.set("pageSize", String(Math.max(10, Math.min(100, pageSize))));
  if (eligibilityOnly) {
    url.searchParams.set("eligibilityCheck", "SUPPORTED");
  }

  const response = await fetchImpl(url, {
    headers: { Authorization: apiKey }
  });
  return parseResponse(response);
}
