import { api } from "./client.js";

export const AnalyticsApi = {
  dashboard({ range = "30", payer = "" } = {}) {
    const params = new URLSearchParams({ range });
    if (payer) params.set("payer", payer);
    return api(`/api/analytics?${params.toString()}`);
  }
};
