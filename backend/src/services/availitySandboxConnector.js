import { PayerConnectorUnavailableError } from "./payerConnectorRegistry.js";

function required(value, name) {
  if (value == null || value === "") {
    const error = new Error(`${name} is required for Availity eligibility`);
    error.code = "AVAILITY_REQUEST_INVALID";
    throw error;
  }
  return value;
}

function dateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function patientNameParts(claim) {
  const source = String(claim.subscriberName || claim.patientName || "").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || null,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null
  };
}

export function buildAvailityEligibilityRequest(claim, context = {}) {
  if (context.requestPayload) return context.requestPayload;

  const names = patientNameParts(claim);
  const payerId = context.payerId || claim.connectedPayerCode || claim.payerEdiId;
  const memberId = claim.subscriberId || claim.memberId;
  const providerNpi =
    context.providerNpi || claim.billingProviderNpi || claim.renderingProviderNpi;
  const patientDob = dateOnly(claim.patientDob);

  required(payerId, "payerEdiId");
  required(memberId, "memberId/subscriberId");
  required(providerNpi, "provider NPI");
  required(names.firstName, "subscriber first name");
  required(names.lastName, "subscriber last name");
  required(patientDob, "patientDob");

  return {
    transactionType: "270_271",
    payerId,
    provider: {
      npi: providerNpi,
      organizationName: context.providerName || claim.hospitalName || "CLAIM APP Demo Provider"
    },
    subscriber: {
      memberId,
      firstName: names.firstName,
      lastName: names.lastName,
      dateOfBirth: patientDob
    },
    serviceTypeCode: context.serviceTypeCode || "30",
    externalPatientId: String(claim.id || "").slice(0, 64) || undefined
  };
}

function asNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeAvailityEligibilityResponse(body, { latencyMs = null } = {}) {
  const payload = body?.data || body?.result || body || {};
  const coverage =
    payload.coverage || payload.eligibility || payload.coverageSummary || payload;

  const rawStatus = String(
    coverage.coverageStatus ||
      coverage.status ||
      payload.coverageStatus ||
      payload.status ||
      ""
  ).toUpperCase();

  const active =
    rawStatus.includes("ACTIVE") ||
    coverage.active === true ||
    payload.active === true;
  const inactive =
    rawStatus.includes("INACTIVE") ||
    coverage.active === false ||
    payload.active === false;

  const status = active ? "ACTIVE" : inactive ? "INACTIVE" : "NEEDS_REVIEW";

  const transactionId =
    payload.transactionId ||
    payload.traceId ||
    payload.controlNumber ||
    body?.transactionId ||
    body?.traceId ||
    null;

  return {
    transactionId,
    status,
    coverageStatus: active ? "ACTIVE" : inactive ? "INACTIVE" : "UNKNOWN",
    networkStatus: coverage.networkStatus || payload.networkStatus || null,
    deductibleRemaining:
      asNumber(coverage.deductibleRemaining ?? payload.deductibleRemaining),
    coinsurancePct:
      asNumber(coverage.coinsurancePct ?? payload.coinsurancePct),
    benefitSummary: {
      planName: coverage.planName || payload.planName || null,
      planType: coverage.planType || payload.planType || null
    },
    missingFields: [],
    latencyMs,
    livePayerVerification: false,
    testMode: true,
    rawStatus: rawStatus || null
  };
}

async function parseJsonResponse(response, providerLabel) {
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: `Non-JSON response from ${providerLabel}` };
    }
  }

  if (!response.ok) {
    const error = new Error(
      body?.message || body?.error || `${providerLabel} request failed with HTTP ${response.status}`
    );
    error.code = "AVAILITY_API_ERROR";
    error.status = response.status;
    throw error;
  }

  return body;
}

export function createAvailitySandboxConnector({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const clientId = String(env.AVAILITY_CLIENT_ID || "").trim();
  const clientSecret = String(env.AVAILITY_CLIENT_SECRET || "").trim();
  const tokenUrl = String(env.AVAILITY_TOKEN_URL || "").trim();
  const eligibilityUrl = String(env.AVAILITY_ELIGIBILITY_URL || "").trim();

  if (!clientId || !clientSecret || !tokenUrl || !eligibilityUrl) {
    throw new PayerConnectorUnavailableError(
      "AVAILITY_SANDBOX",
      "Availity sandbox OAuth and eligibility endpoints are not fully configured"
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch implementation is required for Availity connector");
  }

  let cachedToken = null;
  let tokenExpiresAt = 0;

  async function accessToken(signal) {
    if (cachedToken && Date.now() < tokenExpiresAt - 30_000) {
      return cachedToken;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret
    });

    const response = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal
    });
    const tokenBody = await parseJsonResponse(response, "Availity OAuth");
    const token = tokenBody.access_token || tokenBody.accessToken;
    if (!token) {
      const error = new Error("Availity OAuth response did not contain an access token");
      error.code = "AVAILITY_API_ERROR";
      throw error;
    }

    const expiresIn = Number(tokenBody.expires_in || tokenBody.expiresIn || 300);
    cachedToken = token;
    tokenExpiresAt = Date.now() + Math.max(60, expiresIn) * 1000;
    return token;
  }

  const unavailable = (operation) => {
    throw new PayerConnectorUnavailableError(
      "AVAILITY_SANDBOX",
      `${operation} is outside the R2C Availity demo slice`
    );
  };

  return Object.freeze({
    mode: "LIVE",

    async checkEligibility(claim, context = {}) {
      const payload = buildAvailityEligibilityRequest(claim, context);
      const token = await accessToken(context.signal);
      const startedAt = Date.now();
      const response = await fetchImpl(eligibilityUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: context.signal
      });
      const responseBody = await parseJsonResponse(response, "Availity eligibility");
      return normalizeAvailityEligibilityResponse(responseBody, {
        latencyMs: Date.now() - startedAt
      });
    },

    requestPriorAuth() {
      return unavailable("requestPriorAuth");
    },

    submitClaim() {
      return unavailable("submitClaim");
    },

    getStatus() {
      return unavailable("getStatus");
    },

    getRemittance() {
      return unavailable("getRemittance");
    }
  });
}
