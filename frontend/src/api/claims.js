import { api } from "./client.js";

const BASE = "/api/claims";

export const ClaimsApi = {
  list() {
    return api(BASE);
  },

  get(id) {
    return api(`${BASE}/${id}`);
  },

  create(data) {
    return api(BASE, {
      method: "POST",
      body: JSON.stringify(data)
    });
  },

  update(id, data) {
    return api(`${BASE}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
  },

  delete(id) {
    return api(`${BASE}/${id}`, {
      method: "DELETE"
    });
  },

  runCheck(id) {
    return api(`${BASE}/${id}/check`, {
      method: "POST"
    });
  },

  submit(id) {
    return api(`${BASE}/${id}/submit`, {
      method: "POST"
    });
  },

  uploadDoc({ claimId, type, file }) {
    const fd = new FormData();
    fd.append("claimId", claimId);
    fd.append("type", type);
    fd.append("file", file);

    return api(`${BASE}/documents`, {
      method: "POST",
      body: fd
    });
  },

  applyDocumentSuggestion(docId) {
    return api(`${BASE}/documents/${docId}/apply-suggestion`, {
      method: "POST"
    });
  },

  deleteDoc(docId) {
    return api(`${BASE}/documents/${docId}`, {
      method: "DELETE"
    });
  }
};