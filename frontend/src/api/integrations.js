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

  records(id, { resourceType = "", limit = 50 } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (resourceType) params.set("resourceType", resourceType);
    return api(`${BASE}/${id}/records?${params.toString()}`);
  }
};
