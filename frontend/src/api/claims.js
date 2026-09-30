import { api } from "./client.js";

const BASE = "/api/claims";

/**
 * Retry only safe/idempotent reads on transient failures.
 * We intentionally do not auto-retry POST/PATCH mutations because that can
 * duplicate side effects when a response is lost after the server succeeds.
 */
async function withReadRetry(operation, attempts = 3, baseDelayMs = 350) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const retryable = status === 0 || status >= 500;

      if (!retryable || attempt === attempts) throw error;

      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1))
      );
    }
  }

  throw lastError;
}

export const ClaimsApi = {
  list() {
    return api(BASE);
  },

  get(id) {
    return api(`${BASE}/${id}`);
  },

  create(data) {
    return api(BASE, {
      method: "POST",
      body: JSON.stringify(data)
    });
  },

  update(id, data) {
    return api(`${BASE}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
  },

  delete(id) {
    return api(`${BASE}/${id}`, {
      method: "DELETE"
    });
  },

  runCheck(id) {
    return api(`${BASE}/${id}/check`, {
      method: "POST"
    });
  },

  submit(id) {
    return api(`${BASE}/${id}/submit`, {
      method: "POST"
    });
  },

  uploadDoc({ claimId, type, file }) {
    const fd = new FormData();
    fd.append("claimId", claimId);
    if (type) fd.append("type", type);
    fd.append("file", file);

    return api("/api/documents/upload", {
      method: "POST",
      body: fd
    });
  },

  applyDocumentSuggestion(docId) {
    return api(`${BASE}/documents/${docId}/apply-suggestion`, {
      method: "POST"
    });
  },

  deleteDoc(docId) {
    return api(`${BASE}/documents/${docId}`, {
      method: "DELETE"
    });
  },

  bulkDeleteDocs(ids) {
    return api(`${BASE}/documents/bulk-delete`, {
      method: "POST",
      body: JSON.stringify({ ids })
    });
  },

  smartUploadDoc(file) {
    const fd = new FormData();
    fd.append("file", file);

    return api("/api/documents/smart-upload", {
      method: "POST",
      body: fd
    });
  },

  searchClaims(query = "", limit = 20) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("limit", String(limit));

    return withReadRetry(() =>
      api(`${BASE}/search?${params.toString()}`)
    );
  },

  getJourney(id) {
    return withReadRetry(() => api(`${BASE}/${id}/journey`));
  },

  getMockPayers() {
    return withReadRetry(() => api(`${BASE}/payers/mock`));
  },

  connectMockPayer(id, payerCode) {
    return api(`${BASE}/${id}/payer-simulation/connect`, {
      method: "POST",
      body: JSON.stringify({ payerCode })
    });
  },

  simulatePayerEligibility(id) {
    return api(`${BASE}/${id}/payer-simulation/eligibility`, { method: "POST" });
  },

  simulatePayerPriorAuth(id, data = {}) {
    return api(`${BASE}/${id}/payer-simulation/prior-auth`, {
      method: "POST",
      body: JSON.stringify(data)
    });
  },

  simulatePayerSubmission(id) {
    return api(`${BASE}/${id}/payer-simulation/submission`, { method: "POST" });
  },

  simulatePayerStatus(id) {
    return api(`${BASE}/${id}/payer-simulation/status`, { method: "POST" });
  },

  simulatePayerRemittance(id) {
    return api(`${BASE}/${id}/payer-simulation/remittance`, { method: "POST" });
  },

  runEligibilityPrecheck(id) {
    return api(`${BASE}/${id}/journey/eligibility/precheck`, {
      method: "POST"
    });
  },

  evaluatePriorAuth(id, data) {
    return api(`${BASE}/${id}/journey/prior-auth/evaluate`, {
      method: "POST",
      body: JSON.stringify(data)
    });
  },

  updatePayerStatus(id, payerClaimStatus) {
    return api(`${BASE}/${id}/journey/claim-status`, {
      method: "PATCH",
      body: JSON.stringify({ payerClaimStatus })
    });
  },

  updateRemittance(id, data) {
    return api(`${BASE}/${id}/journey/remittance`, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
  }
};
