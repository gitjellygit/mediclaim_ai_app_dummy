export const ORACLE_HEALTH_OPEN_SANDBOX = Object.freeze({
  fhirBaseUrl: "https://fhir-open.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d"
});

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const error = new Error(name + " is not configured");
    error.code = "ORACLE_HEALTH_CONFIGURATION_REQUIRED";
    throw error;
  }
  return normalized;
}

export function oracleHealthConfig(environment = "SANDBOX") {
  const env = String(environment || "SANDBOX").toUpperCase();
  const sandbox = env !== "PRODUCTION";
  return {
    environment: env,
    fhirBaseUrl: trimSlash(
      sandbox
        ? (process.env.ORACLE_HEALTH_SANDBOX_FHIR_BASE_URL || ORACLE_HEALTH_OPEN_SANDBOX.fhirBaseUrl)
        : (process.env.ORACLE_HEALTH_PRODUCTION_FHIR_BASE_URL || "")
    ),
    testPatientId: sandbox
      ? (process.env.ORACLE_HEALTH_SANDBOX_TEST_PATIENT_ID || "12724067")
      : (process.env.ORACLE_HEALTH_PRODUCTION_TEST_PATIENT_ID || "")
  };
}

export function oracleHealthConfigurationStatus(environment = "SANDBOX") {
  const config = oracleHealthConfig(environment);
  return {
    environment: config.environment,
    fhirBaseUrl: config.fhirBaseUrl || null,
    authentication: config.environment === "PRODUCTION" ? "CUSTOMER_CONFIGURATION_REQUIRED" : "OPEN_SANDBOX_NO_AUTH",
    testPatientConfigured: Boolean(config.testPatientId),
    ready: Boolean(config.fhirBaseUrl)
  };
}

export async function oracleHealthFhirGet(config, path, fetchImpl = fetch) {
  const url = trimSlash(required(config.fhirBaseUrl, "Oracle Health FHIR base URL")) +
    "/" + String(path || "").replace(/^\/+/, "");
  const timeoutMs = Number(process.env.ORACLE_HEALTH_REQUEST_TIMEOUT_MS || 15000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/fhir+json, application/json+fhir, application/json" },
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Oracle Health FHIR request timed out for " + path);
      timeoutError.code = "ORACLE_HEALTH_FHIR_TIMEOUT";
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error("Oracle Health FHIR request failed for " + path);
    error.code = "ORACLE_HEALTH_FHIR_REQUEST_FAILED";
    error.status = response.status;
    error.operationOutcome = payload?.resourceType === "OperationOutcome" ? payload : null;
    throw error;
  }

  return payload;
}

export async function testOracleHealthConnection(config, fetchImpl = fetch) {
  const payload = await oracleHealthFhirGet(config, "metadata", fetchImpl);
  if (payload?.resourceType !== "CapabilityStatement") {
    const error = new Error("Oracle Health FHIR capability response was unexpected");
    error.code = "ORACLE_HEALTH_CAPABILITY_INVALID";
    error.status = 502;
    throw error;
  }
  return {
    ok: true,
    resourceType: payload.resourceType,
    fhirVersion: payload.fhirVersion || null,
    software: payload.software?.name || null
  };
}

function encoded(value) {
  return encodeURIComponent(String(value || ""));
}

export function oracleHealthPatientSyncPlan(patientId) {
  const id = required(patientId, "Oracle Health test patient ID");
  return [
    { name: "Patient", path: "Patient/" + encoded(id), required: true },
    { name: "Coverage", path: "Coverage?patient=" + encoded(id), required: false },
    { name: "Appointment", path: "Appointment?patient=" + encoded(id), required: false },
    { name: "Encounter", path: "Encounter?patient=" + encoded(id), required: false },
    { name: "Condition", path: "Condition?patient=" + encoded(id), required: false },
    { name: "DocumentReference", path: "DocumentReference?patient=" + encoded(id), required: false }
  ];
}

export async function fetchOracleHealthPatientSnapshot(
  config,
  patientId,
  optionsOrFetch = {}
) {
  const options =
    typeof optionsOrFetch === "function"
      ? { fetchImpl: optionsOrFetch }
      : (optionsOrFetch || {});
  const fetchImpl = options.fetchImpl || fetch;
  const encounterId = options.encounterId || null;
  const resources = [];
  const calls = [];
  const encounterIds = encounterId ? [String(encounterId).trim()] : [];

  for (const item of oracleHealthPatientSyncPlan(patientId)) {
    try {
      const payload = await oracleHealthFhirGet(config, item.path, fetchImpl);
      if (payload?.resourceType !== "Bundle" || (payload.entry || []).length > 0) {
        resources.push(payload);
      }
      if (item.name === "Encounter" && payload?.resourceType === "Bundle") {
        for (const entry of payload.entry || []) {
          const id = String(entry?.resource?.id || "").trim();
          if (id) encounterIds.push(id);
        }
      }
      calls.push({
        resource: item.name,
        status: "SUCCESS",
        count: payload?.resourceType === "Bundle" ? (payload.entry || []).length : (payload ? 1 : 0)
      });
    } catch (error) {
      if (item.required) throw error;
      calls.push({
        resource: item.name,
        status: "SKIPPED",
        httpStatus: error.status || null,
        code: error.code || "ORACLE_HEALTH_FHIR_REQUEST_FAILED"
      });
    }
  }

  for (const encounterId of [...new Set(encounterIds)].slice(0, 25)) {
    const path = "ChargeItem?context=" + encoded(encounterId) + "&-status=billable";
    try {
      const payload = await oracleHealthFhirGet(config, path, fetchImpl);
      if (payload?.resourceType !== "Bundle" || (payload.entry || []).length > 0) {
        resources.push(payload);
      }
      calls.push({
        resource: "ChargeItem",
        encounterId,
        status: "SUCCESS",
        count: payload?.resourceType === "Bundle" ? (payload.entry || []).length : (payload ? 1 : 0)
      });
    } catch (error) {
      calls.push({
        resource: "ChargeItem",
        encounterId,
        status: "SKIPPED",
        httpStatus: error.status || null,
        code: error.code || "ORACLE_HEALTH_FHIR_REQUEST_FAILED"
      });
    }
  }

  return { resources, calls };
}
