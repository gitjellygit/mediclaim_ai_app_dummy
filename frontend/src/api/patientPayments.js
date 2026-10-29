import { api } from "./client.js";

const BASE = "/api/patient-payments";

export const PatientPaymentsApi = {
  list({ q = "", status = "ALL" } = {}) {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status && status !== "ALL") params.set("status", status);
    return api(`${BASE}?${params.toString()}`);
  },

  get(id) {
    return api(`${BASE}/${id}`);
  },

  recordPayment(id, data) {
    return api(`${BASE}/${id}/payments`, {
      method: "POST",
      body: JSON.stringify(data)
    });
  },

  update(id, data) {
    return api(`${BASE}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
  }
};
