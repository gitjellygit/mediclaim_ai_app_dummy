export const ATHENAHEALTH_PREVIEW = Object.freeze({
  fhirBaseUrl: "https://preview.api.fhir.athena.io/fhir/r4",
  tokenUrl: "https://api.preview.platform.athenahealth.com/oauth2/v1/token",
  scope: "athena/service/Athenanet.MDP.*"
});

export const ATHENAHEALTH_MOCK_PATIENTS = Object.freeze([
  {
    id: "athena-demo-1001",
    name: "Maya Carter",
    birthDate: "1984-06-18",
    gender: "female",
    mrn: "ATH-MRN-1001",
    phone: "6175550101",
    email: "maya.carter@example.test",
    postalCode: "02115"
  },
  {
    id: "athena-demo-1002",
    name: "Daniel Brooks",
    birthDate: "1976-11-03",
    gender: "male",
    mrn: "ATH-MRN-1002",
    phone: "6175550102",
    email: "daniel.brooks@example.test",
    postalCode: "02116"
  },
  {
    id: "athena-demo-1003",
    name: "Priya Shah",
    birthDate: "1991-02-27",
    gender: "female",
    mrn: "ATH-MRN-1003",
    phone: "6175550103",
    email: "priya.shah@example.test",
    postalCode: "02118"
  }
]);

function athenaMockEnabled(environment) {
  return String(environment || "SANDBOX").toUpperCase() !== "PRODUCTION" &&
    /^(1|true|yes|on)$/i.test(String(process.env.ATHENAHEALTH_SANDBOX_MOCK || ""));
}

function athenaMockPatientResource(patient) {
  const [given, ...familyParts] = patient.name.split(" ");
  return {
    resourceType: "Patient",
    id: patient.id,
    active: true,
    name: [{ use: "official", given: [given], family: familyParts.join(" ") }],
    birthDate: patient.birthDate,
    gender: patient.gender,
    identifier: [{ system: "urn:athena:mock:mrn", value: patient.mrn, type: { text: "MRN" } }],
    telecom: [
      { system: "phone", value: patient.phone },
      { system: "email", value: patient.email }
    ],
    address: [{ use: "home", city: "Boston", state: "MA", postalCode: patient.postalCode, country: "US" }]
  };
}

function athenaMockBundle(resources) {
  return {
    resourceType: "Bundle",
    type: "searchset",
    total: resources.length,
    entry: resources.map((resource) => ({ resource }))
  };
}

function athenaMockSnapshot(patientId) {
  const patient = ATHENAHEALTH_MOCK_PATIENTS.find((item) => item.id === String(patientId));
  if (!patient) {
    const error = new Error("athenahealth mock patient was not found");
    error.code = "ATHENAHEALTH_MOCK_PATIENT_NOT_FOUND";
    error.status = 404;
    throw error;
  }
  const encounterId = "athena-enc-" + patient.id.slice(-4);
  const resources = [
    athenaMockPatientResource(patient),
    athenaMockBundle([{
      resourceType: "Coverage",
      id: "athena-cov-" + patient.id.slice(-4),
      status: "active",
      subscriberId: "ATH-MEMBER-" + patient.id.slice(-4),
      beneficiary: { reference: "Patient/" + patient.id },
      subscriber: { reference: "Patient/" + patient.id },
      payor: [{ display: "Athena Demo Health Plan" }],
      period: { start: "2026-01-01", end: "2026-12-31" }
    }]),
    athenaMockBundle([{
      resourceType: "Appointment",
      id: "athena-appt-" + patient.id.slice(-4),
      status: "fulfilled",
      start: "2026-10-15T14:00:00Z",
      participant: [{ actor: { reference: "Patient/" + patient.id }, status: "accepted" }]
    }]),
    athenaMockBundle([{
      resourceType: "Encounter",
      id: encounterId,
      status: "finished",
      class: { code: "AMB", display: "ambulatory" },
      subject: { reference: "Patient/" + patient.id },
      period: { start: "2026-10-15T14:00:00Z", end: "2026-10-15T14:30:00Z" }
    }]),
    athenaMockBundle([{
      resourceType: "Condition",
      id: "athena-cond-" + patient.id.slice(-4),
      clinicalStatus: { coding: [{ code: "active" }] },
      subject: { reference: "Patient/" + patient.id },
      encounter: { reference: "Encounter/" + encounterId },
      code: {
        coding: [{
          system: "http://hl7.org/fhir/sid/icd-10-cm",
          code: "Z09",
          display: "Encounter for follow-up examination after treatment"
        }],
        text: "Routine follow-up"
      }
    }]),
    athenaMockBundle([{
      resourceType: "DocumentReference",
      id: "athena-doc-" + patient.id.slice(-4),
      status: "current",
      subject: { reference: "Patient/" + patient.id },
      description: "Synthetic athenahealth preview note"
    }]),
    athenaMockBundle([
      {
        resourceType: "ChargeItem",
        id: "athena-charge-" + patient.id.slice(-4) + "-1",
        status: "billable",
        subject: { reference: "Patient/" + patient.id },
        context: { reference: "Encounter/" + encounterId },
        code: {
          coding: [{
            system: "http://www.ama-assn.org/go/cpt",
            code: "99213",
            display: "Office or other outpatient visit"
          }]
        },
        quantity: { value: 1 },
        priceOverride: { value: 125, currency: "USD" },
        occurrenceDateTime: "2026-10-15T14:00:00Z"
      },
      {
        resourceType: "ChargeItem",
        id: "athena-charge-" + patient.id.slice(-4) + "-2",
        status: "billable",
        subject: { reference: "Patient/" + patient.id },
        context: { reference: "Encounter/" + encounterId },
        code: {
          coding: [{
            system: "http://www.ama-assn.org/go/cpt",
            code: "36415",
            display: "Collection of venous blood by venipuncture"
          }]
        },
        quantity: { value: 1 },
        priceOverride: { value: 35, currency: "USD" },
        occurrenceDateTime: "2026-10-15T14:10:00Z"
      }
    ])
  ];
  return {
    patientId: patient.id,
    resources,
    calls: [
      { resource: "Patient", status: "SUCCESS", count: 1 },
      { resource: "Coverage", status: "SUCCESS", count: 1 },
      { resource: "Appointment", status: "SUCCESS", count: 1 },
      { resource: "Encounter", status: "SUCCESS", count: 1 },
      { resource: "Condition", status: "SUCCESS", count: 1 },
      { resource: "DocumentReference", status: "SUCCESS", count: 1 },
      { resource: "ChargeItem", status: "SUCCESS", count: 2 }
    ],
    tokenScope: "MOCK"
  };
}

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const error = new Error(name + " is not configured");
    error.code = "ATHENAHEALTH_CONFIGURATION_REQUIRED";
    throw error;
  }
  return normalized;
}

function encoded(value) {
  return encodeURIComponent(String(value || ""));
}

export function athenaHealthConfig(environment = "SANDBOX") {
  const env = String(environment || "SANDBOX").toUpperCase();
  const sandbox = env !== "PRODUCTION";
  const prefix = sandbox ? "ATHENAHEALTH_SANDBOX" : "ATHENAHEALTH_PRODUCTION";

  return {
    environment: env,
    fhirBaseUrl: trimSlash(
      process.env[prefix + "_FHIR_BASE_URL"] ||
        (sandbox ? ATHENAHEALTH_PREVIEW.fhirBaseUrl : "")
    ),
    tokenUrl:
      process.env[prefix + "_TOKEN_URL"] ||
      (sandbox ? ATHENAHEALTH_PREVIEW.tokenUrl : ""),
    clientId: process.env[prefix + "_CLIENT_ID"] || "",
    clientSecret: process.env[prefix + "_CLIENT_SECRET"] || "",
    scope:
      process.env[prefix + "_SCOPE"] ||
      (sandbox ? ATHENAHEALTH_PREVIEW.scope : ""),
    testPatientId: process.env[prefix + "_TEST_PATIENT_ID"] || "",
    mockMode: sandbox && athenaMockEnabled(env)
  };
}

export function athenaHealthConfigurationStatus(environment = "SANDBOX") {
  const config = athenaHealthConfig(environment);
  return {
    environment: config.environment,
    fhirBaseUrl: config.fhirBaseUrl || null,
    tokenUrl: config.tokenUrl || null,
    scope: config.scope || null,
    clientIdConfigured: Boolean(config.clientId),
    clientSecretConfigured: Boolean(config.clientSecret),
    testPatientConfigured: Boolean(config.testPatientId),
    mockMode: Boolean(config.mockMode),
    dataMode: config.mockMode ? "MOCK" : "LIVE",
    billingApiEnabled: false,
    billingApiNote:
      "FHIR patient import is supported. athenaOne claims, patient balances, statements, and payment APIs require separate preview practice credentials and are not mapped in this foundation.",
    ready: Boolean(
      config.mockMode ||
      (
        config.fhirBaseUrl &&
        config.tokenUrl &&
        config.clientId &&
        config.clientSecret &&
        config.scope
      )
    )
  };
}

export async function requestAthenaHealthAccessToken(config, fetchImpl = fetch) {
  const clientId = required(config.clientId, "athenahealth client ID");
  const clientSecret = required(config.clientSecret, "athenahealth client secret");
  const tokenUrl = required(config.tokenUrl, "athenahealth token URL");
  const scope = required(config.scope, "athenahealth OAuth scope");

  const response = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope
    })
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.access_token) {
    const error = new Error("athenahealth OAuth token request failed");
    error.code = "ATHENAHEALTH_OAUTH_FAILED";
    error.status = response.status;
    error.athenaError = payload?.error || null;
    error.athenaErrorDescription =
      payload?.error_description || payload?.message || null;
    throw error;
  }

  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type || "Bearer",
    expiresIn: Number(payload.expires_in || 0),
    scope: payload.scope || scope
  };
}

export async function athenaHealthFhirGet(
  config,
  path,
  { token, fetchImpl = fetch } = {}
) {
  const accessToken =
    token || (await requestAthenaHealthAccessToken(config, fetchImpl)).accessToken;
  const url =
    trimSlash(required(config.fhirBaseUrl, "athenahealth FHIR base URL")) +
    "/" +
    String(path || "").replace(/^\/+/, "");

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
    const error = new Error("athenahealth FHIR request failed for " + path);
    error.code = "ATHENAHEALTH_FHIR_REQUEST_FAILED";
    error.status = response.status;
    error.operationOutcome =
      payload?.resourceType === "OperationOutcome" ? payload : null;
    throw error;
  }

  return payload;
}

export async function testAthenaHealthConnection(config, fetchImpl = fetch) {
  if (config.mockMode) {
    return {
      ok: true,
      resourceType: "CapabilityStatement",
      fhirVersion: "4.0.1",
      software: "Claim App athenahealth Mock",
      scope: "MOCK",
      mockMode: true
    };
  }
  const token = await requestAthenaHealthAccessToken(config, fetchImpl);
  const payload = await athenaHealthFhirGet(config, "metadata", {
    token: token.accessToken,
    fetchImpl
  });
  if (payload?.resourceType !== "CapabilityStatement") {
    const error = new Error("athenahealth FHIR capability response was unexpected");
    error.code = "ATHENAHEALTH_CAPABILITY_INVALID";
    error.status = 502;
    throw error;
  }
  return {
    ok: true,
    resourceType: payload.resourceType,
    fhirVersion: payload.fhirVersion || null,
    software: payload.software?.name || null,
    scope: token.scope || null
  };
}

function patientDisplayName(resource) {
  const name =
    (resource?.name || []).find((item) => item?.use === "official") ||
    resource?.name?.[0];
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
      type:
        item.type?.text ||
        item.type?.coding?.[0]?.display ||
        item.type?.coding?.[0]?.code ||
        null
    }))
    .slice(0, 10);
}

function patientTelecom(resource, system) {
  return (resource?.telecom || [])
    .filter((item) => item?.system === system && item?.value)
    .map((item) => String(item.value));
}

function patientAddress(resource) {
  const address =
    (resource?.address || []).find((item) => item?.use === "home") ||
    resource?.address?.[0];
  if (!address) return null;
  return {
    lines: (address.line || []).map(String),
    city: address.city || null,
    state: address.state || null,
    postalCode: address.postalCode || null,
    country: address.country || null
  };
}

export function athenaHealthPatientSearchPath(criteria = {}) {
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
  const phone = String(criteria.phone || "").trim();
  const email = String(criteria.email || "").trim();
  const postalCode = String(criteria.postalCode || "").trim();
  const gender = String(criteria.gender || "").trim().toLowerCase();

  if (patientId) params.set("_id", patientId);
  if (identifier) {
    params.set(
      "identifier",
      identifierSystem ? identifierSystem + "|" + identifier : identifier
    );
  }
  if (name) params.set("name", name);
  if (family) params.set("family", family);
  if (given) params.set("given", given);
  if (birthdate) params.set("birthdate", birthdate);
  if (phone) params.set("phone", phone);
  if (email) params.set("email", email);
  if (postalCode) params.set("address-postalcode", postalCode);
  if (gender) params.set("gender", gender);

  const searchKeys = [...params.keys()].filter((key) => key !== "_count");
  if (!searchKeys.length) {
    const error = new Error("Enter at least one patient search criterion");
    error.code = "ATHENAHEALTH_PATIENT_SEARCH_REQUIRED";
    error.status = 400;
    throw error;
  }

  return "Patient?" + params.toString();
}

export async function searchAthenaHealthPatients(
  config,
  criteria = {},
  fetchImpl = fetch
) {
  if (config.mockMode) {
    const normalized = Object.fromEntries(
      Object.entries(criteria || {}).map(([key, value]) => [key, String(value || "").trim().toLowerCase()])
    );
    const hasCriterion = ["patientId", "identifier", "name", "family", "given", "birthdate", "phone", "email", "postalCode", "gender"]
      .some((key) => normalized[key]);
    if (!hasCriterion) {
      const error = new Error("Enter at least one patient search criterion");
      error.code = "ATHENAHEALTH_PATIENT_SEARCH_REQUIRED";
      error.status = 400;
      throw error;
    }
    const items = ATHENAHEALTH_MOCK_PATIENTS
      .filter((patient) => {
        const haystack = {
          patientId: patient.id.toLowerCase(),
          identifier: patient.mrn.toLowerCase(),
          name: patient.name.toLowerCase(),
          family: patient.name.split(" ").slice(1).join(" ").toLowerCase(),
          given: patient.name.split(" ")[0].toLowerCase(),
          birthdate: patient.birthDate.toLowerCase(),
          phone: patient.phone.toLowerCase(),
          email: patient.email.toLowerCase(),
          postalCode: patient.postalCode.toLowerCase(),
          gender: patient.gender.toLowerCase()
        };
        return Object.entries(normalized).every(([key, value]) => {
          if (!value || ["count", "identifierSystem", "exactName"].includes(key)) return true;
          if (key === "birthdateFrom") return patient.birthDate >= value;
          if (key === "birthdateTo") return patient.birthDate <= value;
          return String(haystack[key] || "").includes(value);
        });
      })
      .slice(0, Math.min(Math.max(Number(criteria.count) || 20, 1), 50))
      .map((patient) => {
        const resource = athenaMockPatientResource(patient);
        return {
          id: patient.id,
          name: patientDisplayName(resource),
          birthDate: resource.birthDate || null,
          gender: resource.gender || null,
          active: true,
          identifiers: patientIdentifiers(resource),
          phones: patientTelecom(resource, "phone"),
          emails: patientTelecom(resource, "email"),
          address: patientAddress(resource)
        };
      });
    return { items, count: items.length, total: items.length, hasMore: false, mockMode: true };
  }
  const token = await requestAthenaHealthAccessToken(config, fetchImpl);
  const path = athenaHealthPatientSearchPath(criteria);
  const payload = await athenaHealthFhirGet(config, path, {
    token: token.accessToken,
    fetchImpl
  });

  if (payload?.resourceType !== "Bundle") {
    const error = new Error(
      "athenahealth patient search returned an unexpected response"
    );
    error.code = "ATHENAHEALTH_PATIENT_SEARCH_INVALID_RESPONSE";
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
    hasMore: Boolean(
      (payload.link || []).find((link) => link?.relation === "next")
    )
  };
}

export function athenaHealthPatientSyncPlan(patientId) {
  const id = required(patientId, "athenahealth patient ID");
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

export async function fetchAthenaHealthPatientSnapshot(
  config,
  patientId,
  fetchImpl = fetch
) {
  if (config.mockMode) return athenaMockSnapshot(patientId);
  const token = await requestAthenaHealthAccessToken(config, fetchImpl);
  const resources = [];
  const calls = [];

  for (const item of athenaHealthPatientSyncPlan(patientId)) {
    try {
      const payload = await athenaHealthFhirGet(config, item.path, {
        token: token.accessToken,
        fetchImpl
      });
      if (
        payload?.resourceType !== "Bundle" ||
        (payload.entry || []).length > 0
      ) {
        resources.push(payload);
      }
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
        code: error.code || "ATHENAHEALTH_FHIR_REQUEST_FAILED"
      });
    }
  }

  return {
    patientId: String(patientId),
    resources,
    calls,
    tokenScope: token.scope || null
  };
}
