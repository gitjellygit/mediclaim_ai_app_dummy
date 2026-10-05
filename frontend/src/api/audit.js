import { api } from "./client.js";

export const AuditApi = {
  list(params = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") query.set(key, String(value));
    }
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return api(`/api/audit${suffix}`);
  }
};
