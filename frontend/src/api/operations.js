import { api } from "./client.js";

export const OperationsApi = {
  roles: () => api("/api/operations/roles"),
  users: () => api("/api/operations/users"),
  inviteUser: (data) => api("/api/operations/users/invite", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id, data) => api(`/api/operations/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  teams: () => api("/api/operations/teams"),
  createTeam: (data) => api("/api/operations/teams", { method: "POST", body: JSON.stringify(data) }),

  bulkWork: (data) => api("/api/operations/claims/bulk-work", { method: "POST", body: JSON.stringify(data) }),

  comments: (claimId) => api(`/api/operations/claims/${claimId}/comments`),
  addComment: (claimId, data) => api(`/api/operations/claims/${claimId}/comments`, { method: "POST", body: JSON.stringify(data) }),

  clinicalRequests: (params = {}) => {
    const query = new URLSearchParams();
    if (params.mine) query.set("mine", "true");
    if (params.status) query.set("status", params.status);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return api(`/api/operations/clinical-requests${suffix}`);
  },
  createClinicalRequest: (data) => api("/api/operations/clinical-requests", { method: "POST", body: JSON.stringify(data) }),
  respondClinicalRequest: (id, data) => api(`/api/operations/clinical-requests/${id}/respond`, { method: "PATCH", body: JSON.stringify(data) }),

  savedQueues: () => api("/api/operations/saved-queues"),
  saveQueue: (data) => api("/api/operations/saved-queues", { method: "POST", body: JSON.stringify(data) }),
  deleteSavedQueue: (id) => api(`/api/operations/saved-queues/${id}`, { method: "DELETE" }),

  notifications: () => api("/api/operations/notifications"),
  markNotificationRead: (id) => api(`/api/operations/notifications/${id}/read`, { method: "PATCH", body: JSON.stringify({}) }),

  approvals: (status = "") => api(`/api/operations/approvals${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  createApproval: (data) => api("/api/operations/approvals", { method: "POST", body: JSON.stringify(data) }),
  decideApproval: (id, data) => api(`/api/operations/approvals/${id}/decision`, { method: "PATCH", body: JSON.stringify(data) }),

  workload: () => api("/api/operations/workload"),
  ownershipHistory: (claimId) => api(`/api/operations/claims/${claimId}/ownership-history`)
};
