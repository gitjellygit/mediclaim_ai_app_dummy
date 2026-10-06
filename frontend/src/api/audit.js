import { api } from "./client.js";

function queryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") query.set(key, String(value));
  }
  return query.toString() ? `?${query.toString()}` : "";
}

export const AuditApi = {
  list(params = {}) {
    return api(`/api/audit${queryString(params)}`);
  },

  exportCsv(params = {}) {
    return api(`/api/audit/export${queryString(params)}`);
  }
};
