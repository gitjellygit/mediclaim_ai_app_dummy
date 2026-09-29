import { api } from "./client.js";

async function safeGet(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await api(url);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) =>
        setTimeout(resolve, 250 * 2 ** (attempt - 1))
      );
    }
  }
  throw lastError;
}

export const MedicalConsistencyApi = {
  summary(query = "", limit = 50) {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    params.set("limit", String(limit));
    return safeGet(`/api/claims/medical-consistency/summary?${params.toString()}`);
  },

  claim(claimId) {
    return safeGet(`/api/claims/${claimId}/medical-consistency`);
  }
};
