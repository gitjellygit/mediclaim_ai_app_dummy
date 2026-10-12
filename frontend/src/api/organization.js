import { api } from "./client.js";

export const OrganizationApi = {
  async getBillingProfile() {
    const result = await api("/api/organization/billing-profile");
    return result?.profile || null;
  },

  async updateBillingProfile(data) {
    const result = await api("/api/organization/billing-profile", {
      method: "PATCH",
      body: JSON.stringify(data)
    });
    return result?.profile || null;
  }
};
