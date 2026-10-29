export const ORACLE_HEALTH_OPEN_SANDBOX = Object.freeze({
  fhirBaseUrl: "https://fhir-open.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d"
});

export const ORACLE_HEALTH_BILLING_DEMO_PATIENT_IDS = Object.freeze([
  "12742419",
  "12768550"
]);

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
      : (process.env.ORACLE_HEALTH_PRODUCTION_TEST_PATIENT_ID || ""),
    billingDemoPatientIds: sandbox
      ? String(
          process.env.ORACLE_HEALTH_SANDBOX_BILLING_DEMO_PATIENT_IDS ||
          ORACLE_HEALTH_BILLING_DEMO_PATIENT_IDS.join(",")
        )
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : []
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

export async function oracleHealthFhirGet(config, path, fetchImpl = fetch, externalSignal = null) {
  const url = trimSlash(required(config.fhirBaseUrl, "Oracle Health FHIR base URL")) +
    "/" + String(path || "").replace(/^\/+/, "");
  const timeoutMs = Number(process.env.ORACLE_HEALTH_REQUEST_TIMEOUT_MS || 15000);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const cancelFromCaller = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) cancelFromCaller();
    else externalSignal.addEventListener("abort", cancelFromCaller, { once: true });
  }

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/fhir+json, application/json+fhir, application/json" },
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      if (externalSignal?.aborted && !timedOut) {
        const cancelled = new Error("Oracle Health FHIR request cancelled");
        cancelled.code = "ORACLE_HEALTH_FHIR_CANCELLED";
        cancelled.status = 499;
        throw cancelled;
      }
      const timeoutError = new Error("Oracle Health FHIR request timed out for " + path);
      timeoutError.code = "ORACLE_HEALTH_FHIR_TIMEOUT";
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener?.("abort", cancelFromCaller);
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


function patientDisplayName(resource) {
  const name = (resource?.name || []).find((item) => item?.use === "official") || resource?.name?.[0];
  if (!name) return null;
  if (name.text) return String(name.text);
  return [...(name.given || []), name.family].filter(Boolean).join(" ") || null;
}

function patientIdentifiers(resource) {
  return (resource?.identifier || [])
    .filter((item) => item?.value)
    .map((item) => ({
      system: item.system || null,
      value: String(item.value),
      type: item.type?.text || item.type?.coding?.[0]?.display || item.type?.coding?.[0]?.code || null
    }))
    .slice(0, 10);
}

function patientTelecom(resource, system) {
  return (resource?.telecom || [])
    .filter((item) => item?.system === system && item?.value)
    .map((item) => String(item.value));
}

function patientAddress(resource) {
  const address = (resource?.address || []).find((item) => item?.use === "home") || resource?.address?.[0];
  if (!address) return null;
  return {
    lines: (address.line || []).map(String),
    city: address.city || null,
    state: address.state || null,
    postalCode: address.postalCode || null,
    country: address.country || null
  };
}

export function oracleHealthPatientSearchPath(criteria = {}) {
  const params = new URLSearchParams();
  const count = Math.min(Math.max(Number(criteria.count) || 20, 1), 50);
  params.set("_count", String(count));

  const patientId = String(criteria.patientId || "").trim();
  const identifier = String(criteria.identifier || "").trim();
  const identifierSystem = String(criteria.identifierSystem || "").trim();
  const name = String(criteria.name || "").trim();
  const family = String(criteria.family || "").trim();
  const given = String(criteria.given || "").trim();
  const birthdate = String(criteria.birthdate || "").trim();
  const birthdateFrom = String(criteria.birthdateFrom || "").trim();
  const birthdateTo = String(criteria.birthdateTo || "").trim();
  const phone = String(criteria.phone || "").trim();
  const email = String(criteria.email || "").trim();
  const postalCode = String(criteria.postalCode || "").trim();
  const gender = String(criteria.gender || "").trim().toLowerCase();
  const exactName = Boolean(criteria.exactName);

  if (name && (family || given)) {
    const error = new Error("Use either full name or first/last name fields, not both");
    error.code = "ORACLE_HEALTH_PATIENT_SEARCH_INVALID";
    error.status = 400;
    throw error;
  }
  if (birthdate && (birthdateFrom || birthdateTo)) {
    const error = new Error("Use either exact birth date or a birth date range, not both");
    error.code = "ORACLE_HEALTH_PATIENT_SEARCH_INVALID";
    error.status = 400;
    throw error;
  }
  if (identifier && !identifierSystem && !identifier.includes("|")) {
    const error = new Error("Oracle Health identifier search requires an identifier system / assigning authority");
    error.code = "ORACLE_HEALTH_PATIENT_SEARCH_INVALID";
    error.status = 400;
    throw error;
  }

  if (patientId) params.set("_id", patientId);
  if (identifier) {
    params.set("identifier", identifierSystem ? identifierSystem + "|" + identifier : identifier);
  }

  if (name) {
    params.set(exactName ? "name:exact" : "name", name);
  } else {
    if (family) params.set(exactName ? "family:exact" : "family", family);
    if (given) {
      if (!family) {
        const error = new Error("Oracle Health given-name search requires family name");
        error.code = "ORACLE_HEALTH_PATIENT_SEARCH_INVALID";
        error.status = 400;
        throw error;
      }
      params.set(exactName ? "given:exact" : "given", given);
    }
  }

  if (birthdate) params.append("birthdate", "eq" + birthdate);
  if (birthdateFrom) params.append("birthdate", "ge" + birthdateFrom);
  if (birthdateTo) params.append("birthdate", "le" + birthdateTo);
  if (phone) params.set("phone", phone);
  if (email) params.set("email", email);
  if (postalCode) params.set("address-postalcode", postalCode);
  if (gender) params.set("gender", gender);

  const searchKeys = [...params.keys()].filter((key) => key !== "_count");
  if (!searchKeys.length) {
    const error = new Error("Enter at least one patient search criterion");
    error.code = "ORACLE_HEALTH_PATIENT_SEARCH_REQUIRED";
    error.status = 400;
    throw error;
  }

  return "Patient?" + params.toString();
}

export async function searchOracleHealthPatients(config, criteria = {}, fetchImpl = fetch) {
  const path = oracleHealthPatientSearchPath(criteria);
  const payload = await oracleHealthFhirGet(config, path, fetchImpl);
  if (payload?.resourceType !== "Bundle") {
    const error = new Error("Oracle Health patient search returned an unexpected response");
    error.code = "ORACLE_HEALTH_PATIENT_SEARCH_INVALID_RESPONSE";
    error.status = 502;
    throw error;
  }

  const items = (payload.entry || [])
    .map((entry) => entry?.resource)
    .filter((resource) => resource?.resourceType === "Patient" && resource?.id)
    .map((resource) => ({
      id: String(resource.id),
      name: patientDisplayName(resource),
      birthDate: resource.birthDate || null,
      gender: resource.gender || null,
      active: resource.active !== false,
      identifiers: patientIdentifiers(resource),
      phones: patientTelecom(resource, "phone"),
      emails: patientTelecom(resource, "email"),
      address: patientAddress(resource)
    }));

  return {
    items,
    count: items.length,
    total: Number.isFinite(Number(payload.total)) ? Number(payload.total) : null,
    hasMore: Boolean((payload.link || []).find((link) => link?.relation === "next"))
  };
}


function bundleResources(payload, resourceType = null) {
  if (payload?.resourceType !== "Bundle") return [];
  return (payload.entry || [])
    .map((entry) => entry?.resource)
    .filter((resource) => resource && (!resourceType || resource.resourceType === resourceType));
}

function chargeMoney(resource) {
  const extension = resource?.extension || [];
  const findMoney = (suffix) =>
    extension.find((item) => String(item?.url || "").toLowerCase().endsWith(suffix))?.valueMoney;
  const net = findMoney("net-price");
  const unit = findMoney("unit-price");
  const quantity = Number(resource?.quantity?.value || 1);
  if (Number.isFinite(Number(net?.value)) && Number(net.value) > 0) return Number(net.value);
  if (Number.isFinite(Number(unit?.value)) && Number(unit.value) > 0) {
    return Number(unit.value) * (Number.isFinite(quantity) && quantity > 0 ? quantity : 1);
  }
  if (Number.isFinite(Number(resource?.priceOverride?.value)) && Number(resource.priceOverride.value) > 0) {
    return Number(resource.priceOverride.value) * (Number.isFinite(quantity) && quantity > 0 ? quantity : 1);
  }
  return 0;
}

function encounterSummary(encounter, charges = []) {
  const total = charges.reduce((sum, charge) => sum + chargeMoney(charge), 0);
  return {
    id: String(encounter.id),
    status: encounter.status || null,
    classCode: encounter.class?.code || null,
    classDisplay: encounter.class?.display || null,
    types: (encounter.type || [])
      .map((item) => item?.coding?.[0]?.display || item?.text || item?.coding?.[0]?.code)
      .filter(Boolean),
    period: encounter.period || null,
    serviceProvider: encounter.serviceProvider?.display || encounter.serviceProvider?.reference || null,
    chargeCount: charges.length,
    totalBilledAmount: total || null,
    billable: charges.length > 0 && total > 0
  };
}

export async function discoverOracleHealthBillableEncounters(
  config,
  patientId,
  { count = 25, fetchImpl = fetch } = {}
) {
  const id = required(patientId, "Oracle Health patient ID");
  const max = Math.min(Math.max(Number(count) || 25, 1), 50);
  const encounterPayload = await oracleHealthFhirGet(
    config,
    "Encounter?patient=" + encoded(id) + "&_count=" + max + "&status=finished",
    fetchImpl
  );
  const encounters = bundleResources(encounterPayload, "Encounter");
  const items = [];

  for (const encounter of encounters.slice(0, max)) {
    const encounterId = String(encounter.id || "").trim();
    if (!encounterId) continue;
    try {
      const chargesPayload = await oracleHealthFhirGet(
        config,
        "ChargeItem?context=" + encoded(encounterId) + "&-status=billable&_count=50",
        fetchImpl
      );
      items.push(encounterSummary(encounter, bundleResources(chargesPayload, "ChargeItem")));
    } catch (error) {
      items.push({
        ...encounterSummary(encounter, []),
        billingStatus: "UNAVAILABLE",
        billingErrorCode: error.code || "ORACLE_HEALTH_FHIR_REQUEST_FAILED"
      });
    }
  }

  return {
    patientId: id,
    items,
    billableCount: items.filter((item) => item.billable).length,
    encounterCount: items.length
  };
}


export async function discoverOracleHealthBillingDemos(
  config,
  { countPerPatient = 25, fetchImpl = fetch } = {}
) {
  const patientIds = [...new Set(
    (config?.billingDemoPatientIds || ORACLE_HEALTH_BILLING_DEMO_PATIENT_IDS)
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )].slice(0, 20);

  const items = [];
  const unavailable = [];

  for (const patientId of patientIds) {
    try {
      const [patient, encounters] = await Promise.all([
        oracleHealthFhirGet(config, "Patient/" + encoded(patientId), fetchImpl),
        discoverOracleHealthBillableEncounters(config, patientId, {
          count: countPerPatient,
          fetchImpl
        })
      ]);

      const patientName = patientDisplayName(patient) || "Oracle sandbox patient";
      const patientSummary = {
        id: patientId,
        name: patientName,
        birthDate: patient?.birthDate || null,
        gender: patient?.gender || null,
        identifiers: patientIdentifiers(patient)
      };

      for (const encounter of encounters.items || []) {
        if (!encounter.billable) continue;
        items.push({
          id: patientId + ":" + encounter.id,
          patientId,
          patient: patientSummary,
          encounterId: encounter.id,
          serviceDate: encounter.period?.start || encounter.period?.end || null,
          encounterType:
            encounter.types?.[0] ||
            encounter.classDisplay ||
            encounter.classCode ||
            "Encounter",
          chargeCount: encounter.chargeCount || 0,
          totalBilledAmount: encounter.totalBilledAmount || 0,
          serviceProvider: encounter.serviceProvider || null
        });
      }
    } catch (error) {
      unavailable.push({
        patientId,
        code: error.code || "ORACLE_HEALTH_BILLING_DEMO_DISCOVERY_FAILED"
      });
    }
  }

  items.sort((left, right) => {
    const leftDate = Date.parse(left.serviceDate || "") || 0;
    const rightDate = Date.parse(right.serviceDate || "") || 0;
    return rightDate - leftDate;
  });

  return {
    items,
    count: items.length,
    seedPatientCount: patientIds.length,
    unavailable
  };
}

async function optionalOracleResource(
  config,
  path,
  fetchImpl,
  calls,
  resources,
  name,
  signal = null
) {
  try {
    const payload = await oracleHealthFhirGet(config, path, fetchImpl, signal);
    if (payload?.resourceType !== "Bundle" || (payload.entry || []).length > 0) resources.push(payload);
    calls.push({
      resource: name,
      status: "SUCCESS",
      count: payload?.resourceType === "Bundle" ? (payload.entry || []).length : (payload ? 1 : 0)
    });
    return payload;
  } catch (error) {
    if (error?.code === "ORACLE_HEALTH_FHIR_CANCELLED") throw error;
    calls.push({
      resource: name,
      status: "SKIPPED",
      httpStatus: error.status || null,
      code: error.code || "ORACLE_HEALTH_FHIR_REQUEST_FAILED"
    });
    return null;
  }
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
  const signal = options.signal || null;
  const encounterId = options.encounterId || null;
  const resources = [];
  const calls = [];
  const encounterIds = encounterId ? [String(encounterId).trim()] : [];

  for (const item of oracleHealthPatientSyncPlan(patientId)) {
    try {
      const payload = await oracleHealthFhirGet(config, item.path, fetchImpl, signal);
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
      if (error?.code === "ORACLE_HEALTH_FHIR_CANCELLED" || item.required) throw error;
      calls.push({
        resource: item.name,
        status: "SKIPPED",
        httpStatus: error.status || null,
        code: error.code || "ORACLE_HEALTH_FHIR_REQUEST_FAILED"
      });
    }
  }

  if (encounterId) {
    const directEncounterPath = "Encounter/" + encoded(encounterId);
    try {
      const payload = await oracleHealthFhirGet(config, directEncounterPath, fetchImpl, signal);
      if (payload) resources.push(payload);
      calls.push({
        resource: "Encounter",
        encounterId: String(encounterId),
        status: "SUCCESS",
        count: payload ? 1 : 0,
        targeted: true
      });
    } catch (error) {
      if (error?.code === "ORACLE_HEALTH_FHIR_CANCELLED") throw error;
      calls.push({
        resource: "Encounter",
        encounterId: String(encounterId),
        status: "SKIPPED",
        httpStatus: error.status || null,
        code: error.code || "ORACLE_HEALTH_FHIR_REQUEST_FAILED",
        targeted: true
      });
    }
  }

  if (encounterId) {
    const target = String(encounterId).trim();
    await optionalOracleResource(
      config,
      "Coverage?-encounter=" + encoded(target),
      fetchImpl,
      calls,
      resources,
      "CoverageEncounter",
      signal
    );
    await optionalOracleResource(
      config,
      "Account?-encounter=" + encoded(target) + "&type=guarantor-balance&_count=20",
      fetchImpl,
      calls,
      resources,
      "Account",
      signal
    );
    await optionalOracleResource(
      config,
      "Condition?patient=" + encoded(patientId) + "&encounter=" + encoded(target),
      fetchImpl,
      calls,
      resources,
      "ConditionEncounter",
      signal
    );
    const procedures = await optionalOracleResource(
      config,
      "Procedure?patient=" + encoded(patientId),
      fetchImpl,
      calls,
      [],
      "Procedure",
      signal
    );
    if (procedures?.resourceType === "Bundle") {
      const filtered = bundleResources(procedures, "Procedure").filter((resource) =>
        String(resource?.encounter?.reference || "") === "Encounter/" + target
      );
      if (filtered.length) {
        resources.push({
          resourceType: "Bundle",
          type: "searchset",
          total: filtered.length,
          entry: filtered.map((resource) => ({ resource }))
        });
      }
    }
  }

  for (const encounterId of [...new Set(encounterIds)].slice(0, 25)) {
    const path = "ChargeItem?context=" + encoded(encounterId) + "&-status=billable";
    try {
      const payload = await oracleHealthFhirGet(config, path, fetchImpl, signal);
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
      if (error?.code === "ORACLE_HEALTH_FHIR_CANCELLED") throw error;
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
