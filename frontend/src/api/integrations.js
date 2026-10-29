import { api } from "./client.js";

const BASE = "/api/integrations";

export const IntegrationsApi = {
  list() {
    return api(BASE);
  },

  adapters() {
    return api(`${BASE}/adapters/catalog`);
  },

  create(data) {
    return api(BASE, {
      method: "POST",
      body: JSON.stringify(data)
    });
  },

  updateHealth(id, data) {
    return api(`${BASE}/${id}/health`, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
  },

  epicStatus(id) {
    return api(`${BASE}/${id}/epic/status`);
  },

  testEpic(id) {
    return api(`${BASE}/${id}/epic/test`, {
      method: "POST",
      body: JSON.stringify({})
    });
  },

  syncEpic(id, patientId = "") {
    return api(`${BASE}/${id}/epic/sync`, {
      method: "POST",
      body: JSON.stringify(patientId ? { patientId } : {})
    });
  },

  athenaHealthStatus(id) {
    return api(`${BASE}/${id}/athenahealth/status`);
  },

  testAthenaHealth(id) {
    return api(`${BASE}/${id}/athenahealth/test`, {
      method: "POST",
      body: JSON.stringify({})
    });
  },

  syncAthenaHealth(id, patientId = "") {
    return api(`${BASE}/${id}/athenahealth/sync`, {
      method: "POST",
      body: JSON.stringify(patientId ? { patientId } : {})
    });
  },

  searchPatients(id, criteria) {
    return api(`${BASE}/${id}/patients/search`, {
      method: "POST",
      body: JSON.stringify(criteria)
    });
  },

  oracleHealthStatus(id) {
    return api(`${BASE}/${id}/oracle-health/status`);
  },

  testOracleHealth(id) {
    return api(`${BASE}/${id}/oracle-health/test`, {
      method: "POST",
      body: JSON.stringify({})
    });
  },

  oracleBillingDemos(id) {
    return api(`${BASE}/${id}/oracle-health/billing-demos`);
  },

  syncOracleHealth(id, patientId = "", encounterId = "", { signal } = {}) {
    return api(`${BASE}/${id}/oracle-health/sync`, {
      method: "POST",
      signal,
      body: JSON.stringify({
        ...(patientId ? { patientId } : {}),
        ...(encounterId ? { encounterId } : {})
      })
    });
  },
  billableEncounters(id, patientId, count = 25) {
    return api(`${BASE}/${id}/patients/billable-encounters`, {
      method: "POST",
      body: JSON.stringify({ patientId, count })
    });
  },

  claimDraftPreview(id, patientId, encounterId = "", { signal } = {}) {
    const params = new URLSearchParams({ patientId });
    if (encounterId) params.set("encounterId", encounterId);
    return api(`${BASE}/${id}/claim-draft/preview?${params.toString()}`, { signal });
  },

  createPatientBalance(id, patientId, encounterId = "") {
    return api(`${BASE}/${id}/patient-balance`, {
      method: "POST",
      body: JSON.stringify({
        patientId,
        ...(encounterId ? { encounterId } : {})
      })
    });
  },

  createClaimDraft(id, patientId, encounterId = "") {
    return api(`${BASE}/${id}/claim-draft`, {
      method: "POST",
      body: JSON.stringify({
        patientId,
        ...(encounterId ? { encounterId } : {})
      })
    });
  },

  records(id, { resourceType = "", limit = 50 } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (resourceType) params.set("resourceType", resourceType);
    return api(`${BASE}/${id}/records?${params.toString()}`);
  }
};
