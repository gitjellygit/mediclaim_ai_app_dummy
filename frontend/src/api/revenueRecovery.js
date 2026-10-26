import { api } from "./client.js";

const BASE = "/api/revenue-recovery";

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

export const RevenueRecoveryApi = {
  list({
    query = "",
    type = "ALL",
    status = "ACTIVE",
    page = 1,
    pageSize = 10,
    sort = "priority",
    direction = "desc"
  } = {}) {
    const params = new URLSearchParams({
      type,
      status,
      page: String(page),
      pageSize: String(pageSize),
      sort,
      direction
    });
    if (query.trim()) params.set("q", query.trim());
    return withReadRetry(() => api(`${BASE}?${params.toString()}`));
  },

  assignClaim(claimId, data) {
    return api(`${BASE}/claims/${claimId}/assignment`, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
  }
};
