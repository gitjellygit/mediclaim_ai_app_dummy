import { api } from "./client.js";

const BASE = "/api/underpayments";

export const UnderpaymentsApi = {
  list({ query = "", status = "ALL" } = {}) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (status && status !== "ALL") params.set("status", status);
    return api(`${BASE}?${params.toString()}`);
  },

  get(id) {
    return api(`${BASE}/${id}`);
  },

  detect(claimId) {
    return api(`${BASE}/detect/${claimId}`, { method: "POST" });
  },

  update(id, data) {
    return api(`${BASE}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
  }
};
