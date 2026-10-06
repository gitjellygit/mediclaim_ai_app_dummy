import { PayerConnectorUnavailableError } from "./payerConnectorRegistry.js";

const DEFAULT_BASE_URL = "https://healthcare.us.stedi.com/2026-06-01";

function required(value, name) {
  if (value == null || value === "") {
    const error = new Error(`${name} is required for Stedi eligibility`);
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

export function normalizeStediEligibilityResponse(body, { latencyMs = null } = {}) {
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

  const networkIndicators = benefits
    .map((entry) => entry?.network?.indicator || entry?.inPlanNetworkIndicator)
    .filter(Boolean);
  const networkStatus =
    networkIndicators.find((value) => value === "IN_NETWORK") ||
    networkIndicators.find((value) => value === "OUT_OF_NETWORK") ||
    networkIndicators[0] ||
    null;

  return {
    transactionId: body?.id || body?.eligibilityCheckId || body?.transactionId || null,
    status,
    coverageStatus:
      status === "ACTIVE" ? "ACTIVE" :
      status === "INACTIVE" ? "INACTIVE" : "UNKNOWN",
    networkStatus,
    deductibleRemaining:
      firstMoney(benefits, "deductible") ??
      firstMoney(benefits, "deductibles"),
    coinsurancePct:
      firstPercent(benefits, "coInsurance") ??
      firstPercent(benefits, "coinsurance"),
    missingFields: [],
    latencyMs,
    livePayerVerification: false,
    testMode: true,
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

    submitClaim() {
      return notYetImplemented("submitClaim");
    },

    getStatus() {
      return notYetImplemented("getStatus");
    },

    getRemittance() {
      return notYetImplemented("getRemittance");
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
