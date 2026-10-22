import { api, apiBlob } from "./client.js";

const BASE = "/api/denials";

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

export const DenialsApi = {
  list({ query = "", status = "ALL", limit = 100 } = {}) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (status && status !== "ALL") params.set("status", status);
    params.set("limit", String(limit));

    return withReadRetry(() =>
      api(`${BASE}?${params.toString()}`)
    );
  },

  get(id) {
    return withReadRetry(() => api(`${BASE}/${id}`));
  },

  getAppealWorkspace(id) {
    return withReadRetry(() => api(`${BASE}/${id}/appeal-workspace`));
  },

  overrideAssessment(id, data) {
    return api(`${BASE}/${id}/assessment-override`, {
      method: "POST",
      body: JSON.stringify(data)
    });
  },

  saveAppealDraft(id, data) {
    return api(`${BASE}/${id}/appeal-draft`, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
  },

  recheckEligibility(id) {
    return api(`${BASE}/${id}/appeal-eligibility-recheck`, {
      method: "POST",
      body: JSON.stringify({})
    });
  },

  prepareAppeal(id) {
    return api(`${BASE}/${id}/appeal-prepare`, {
      method: "POST"
    });
  },

  markAppealSubmitted(id, data) {
    return api(`${BASE}/${id}/appeal-submit`, {
      method: "POST",
      body: JSON.stringify(data)
    });
  },

  uploadAppealEvidence(id, { file, type = "OTHER" }) {
    const body = new FormData();
    body.append("file", file);
    body.append("type", type);
    return api(`${BASE}/${id}/appeal-evidence`, {
      method: "POST",
      body
    });
  },

  previewDocument(documentId) {
    return apiBlob(`/api/documents/${documentId}/preview`);
  },

  downloadDocument(documentId) {
    return apiBlob(`/api/documents/${documentId}/download`);
  },

  lookupCodes({ carc = "", rarc = "" } = {}) {
    const params = new URLSearchParams();
    if (carc) params.set("carc", carc);
    if (rarc) params.set("rarc", rarc);
    return withReadRetry(() => api(`${BASE}/reference/codes?${params.toString()}`));
  },

  previewDeadline({ denialDate, appealWindowDays = 180 }) {
    return api(`${BASE}/deadline-preview`, {
      method: "POST",
      body: JSON.stringify({ denialDate, appealWindowDays })
    });
  },

  createFromClaim(claimId, data = {}) {
    return api(`${BASE}/from-claim/${claimId}`, {
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

  analyze(id) {
    return api(`${BASE}/${id}/analyze`, {
      method: "POST"
    });
  }
};
