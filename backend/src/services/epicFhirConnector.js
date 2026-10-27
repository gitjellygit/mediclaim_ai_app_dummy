import crypto from "node:crypto";
import jwt from "jsonwebtoken";

export const EPIC_SANDBOX = Object.freeze({
  fhirBaseUrl: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/",
  tokenUrl: "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token"
});

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const error = new Error(name + " is not configured");
    error.code = "EPIC_CONFIGURATION_REQUIRED";
    throw error;
  }
  return normalized;
}

function secretFromEnv(name) {
  const value = process.env[name];
  return value ? value.replace(/\\n/g, "\n") : "";
}

export function epicConfig(environment = "SANDBOX") {
  const env = String(environment || "SANDBOX").toUpperCase();
  const sandbox = env !== "PRODUCTION";
  const prefix = sandbox ? "EPIC_SANDBOX" : "EPIC_PRODUCTION";

  return {
    environment: env,
    fhirBaseUrl: trimSlash(
      process.env[prefix + "_FHIR_BASE_URL"] ||
        (sandbox ? EPIC_SANDBOX.fhirBaseUrl : "")
    ),
    tokenUrl:
      process.env[prefix + "_TOKEN_URL"] ||
      (sandbox ? EPIC_SANDBOX.tokenUrl : ""),
    clientId: process.env[prefix + "_CLIENT_ID"] || "",
    jkuUrl: process.env[prefix + "_JKU_URL"] || "",
    keyId: process.env[prefix + "_JWK_KID"] || "",
    privateKey: secretFromEnv(prefix + "_PRIVATE_KEY"),
    testPatientId: process.env[prefix + "_TEST_PATIENT_ID"] || ""
  };
}

export function epicConfigurationStatus(environment = "SANDBOX") {
  const config = epicConfig(environment);
  return {
    environment: config.environment,
    fhirBaseUrl: config.fhirBaseUrl || null,
    tokenUrl: config.tokenUrl || null,
    clientIdConfigured: Boolean(config.clientId),
    jkuConfigured: Boolean(config.jkuUrl),
    keyIdConfigured: Boolean(config.keyId),
    privateKeyConfigured: Boolean(config.privateKey),
    testPatientConfigured: Boolean(config.testPatientId),
    ready: Boolean(
      config.fhirBaseUrl &&
      config.tokenUrl &&
      config.clientId &&
      config.jkuUrl &&
      config.keyId &&
      config.privateKey
    )
  };
}


export function epicPublicJwks() {
  const keys = [];
  const seen = new Set();

  for (const environment of ["SANDBOX", "PRODUCTION"]) {
    const config = epicConfig(environment);
    if (!config.privateKey || !config.keyId || seen.has(config.keyId)) continue;

    try {
      const privateKey = crypto.createPrivateKey(config.privateKey);
      const publicKey = crypto.createPublicKey(privateKey);
      const jwk = publicKey.export({ format: "jwk" });
      keys.push({
        ...jwk,
        kid: config.keyId,
        use: "sig",
        alg: "RS384"
      });
      seen.add(config.keyId);
    } catch {
      const error = new Error("Epic signing key is invalid for " + environment);
      error.code = "EPIC_SIGNING_KEY_INVALID";
      throw error;
    }
  }

  return { keys };
}

export function createEpicClientAssertion(config, now = Date.now()) {
  const clientId = required(config.clientId, "Epic client ID");
  const tokenUrl = required(config.tokenUrl, "Epic token URL");
  const privateKey = required(config.privateKey, "Epic private key");
  const keyId = required(config.keyId, "Epic JWK key ID");
  const jkuUrl = required(config.jkuUrl, "Epic JWK Set URL");
  const iat = Math.floor(now / 1000);

  return jwt.sign(
    {
      iss: clientId,
      sub: clientId,
      aud: tokenUrl,
      jti: crypto.randomUUID(),
      iat,
      nbf: iat - 5,
      exp: iat + 300
    },
    privateKey,
    {
      algorithm: "RS384",
      header: {
        alg: "RS384",
        typ: "JWT",
        kid: keyId,
        jku: jkuUrl
      }
    }
  );
}

export async function requestEpicAccessToken(config, fetchImpl = fetch) {
  const assertion = createEpicClientAssertion(config);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: required(config.clientId, "Epic client ID"),
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion
  });

  const response = await fetchImpl(required(config.tokenUrl, "Epic token URL"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.access_token) {
    const error = new Error("Epic OAuth token request failed");
    error.code = "EPIC_OAUTH_FAILED";
    error.status = response.status;
    error.epicError = payload?.error || null;
    error.epicErrorDescription = payload?.error_description || payload?.message || null;
    throw error;
  }

  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type || "bearer",
    expiresIn: Number(payload.expires_in || 0),
    scope: payload.scope || null
  };
}

export async function epicFhirGet(config, path, {
  token,
  fetchImpl = fetch
} = {}) {
  const accessToken = token || (await requestEpicAccessToken(config, fetchImpl)).accessToken;
  const url = trimSlash(required(config.fhirBaseUrl, "Epic FHIR base URL")) +
    "/" + String(path || "").replace(/^\/+/, "");

  const response = await fetchImpl(url, {
    headers: {
      Authorization: "Bearer " + accessToken,
      Accept: "application/fhir+json, application/json"
    }
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error("Epic FHIR request failed for " + path);
    error.code = "EPIC_FHIR_REQUEST_FAILED";
    error.status = response.status;
    error.operationOutcome = payload?.resourceType === "OperationOutcome" ? payload : null;
    throw error;
  }

  return payload;
}

function encoded(value) {
  return encodeURIComponent(String(value || ""));
}

export function epicPatientSyncPlan(patientId) {
  const id = required(patientId, "Epic test patient ID");
  return [
    { name: "Patient", path: "Patient/" + encoded(id), required: true },
    {
      name: "Coverage",
      path: "Coverage?beneficiary=Patient%2F" + encoded(id),
      required: false
    },
    {
      name: "Appointment",
      path: "Appointment?patient=" + encoded(id),
      required: false
    },
    {
      name: "Encounter",
      path: "Encounter?patient=" + encoded(id),
      required: false
    },
    {
      name: "Condition",
      path: "Condition?patient=" + encoded(id),
      required: false
    },
    {
      name: "DocumentReference",
      path: "DocumentReference?patient=" + encoded(id),
      required: false
    }
  ];
}

export async function fetchEpicPatientSnapshot(config, patientId, fetchImpl = fetch) {
  const token = await requestEpicAccessToken(config, fetchImpl);
  const resources = [];
  const calls = [];

  for (const item of epicPatientSyncPlan(patientId)) {
    try {
      const payload = await epicFhirGet(config, item.path, {
        token: token.accessToken,
        fetchImpl
      });
      resources.push(payload);
      calls.push({
        resource: item.name,
        status: "SUCCESS",
        count:
          payload?.resourceType === "Bundle"
            ? (payload.entry || []).length
            : payload
            ? 1
            : 0
      });
    } catch (error) {
      if (item.required) throw error;
      calls.push({
        resource: item.name,
        status: "SKIPPED",
        httpStatus: error.status || null,
        code: error.code || "EPIC_FHIR_REQUEST_FAILED"
      });
    }
  }

  return {
    resources,
    calls,
    token: {
      expiresIn: token.expiresIn,
      scope: token.scope
    }
  };
}
