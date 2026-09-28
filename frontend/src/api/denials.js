import { api } from "./client.js";

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
