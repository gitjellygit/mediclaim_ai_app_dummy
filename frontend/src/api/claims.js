import { api } from "./client.js";

const BASE = "/api/claims";

/**
 * Retry only safe/idempotent reads on transient failures.
 * We intentionally do not auto-retry POST/PATCH mutations because that can
 * duplicate side effects when a response is lost after the server succeeds.
 */
async function withReadRetry(operation, attempts = 3, baseDelayMs = 350) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const retryable = status === 0 || status >= 500;

      if (!retryable || attempt === attempts) throw error;

      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1))
      );
    }
  }

  throw lastError;
}

export const ClaimsApi = {
  listRules() {
    return withReadRetry(() => api("/api/rules"));
  },

  getRulesMeta() {
    return withReadRetry(() => api("/api/rules/meta"));
  },

  listRuleRecommendations() {
    return withReadRetry(() => api("/api/rules/recommendations"));
  },

  refreshRuleRecommendations(minimumOccurrences = 3) {
    return api("/api/rules/recommendations/refresh", {
      method: "POST",
      body: JSON.stringify({ minimumOccurrences })
    });
  },

  approveRuleRecommendation(id) {
    return api(`/api/rules/recommendations/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({})
    });
  },

  rejectRuleRecommendation(id, reason) {
    return api(`/api/rules/recommendations/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason })
    });
  },

  getRule(id) {
    return withReadRetry(() => api("/api/rules/" + id));
  },

  getRuleVersions(id) {
    return withReadRetry(() => api("/api/rules/" + id + "/versions"));
  },

  simulateRule(data) {
    return api("/api/rules/simulate", {
      method: "POST",
      body: JSON.stringify(data)
    });
  },

  createRule(data) {
    return api("/api/rules", {
      method: "POST",
      body: JSON.stringify(data)
    });
  },

  updateRule(id, data) {
    return api("/api/rules/" + id, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
  },

  deleteRule(id) {
    return api("/api/rules/" + id, {
      method: "DELETE"
    });
  },

  list({
    page = 1,
    pageSize = 50,
    paginated = true,
    sort = "createdAt",
    direction = "desc",
    q = ""
  } = {}) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
      direction
    });
    if (q.trim()) params.set("q", q.trim());
    if (paginated) params.set("paginated", "1");
    return api(`${BASE}?${params.toString()}`);
  },

  get(id) {
    return api(`${BASE}/${id}`);
  },

  approvalIntelligence({
    page = 1,
    pageSize = 25,
    q = "",
    status = "ALL",
    work = "ALL",
    filing = "ALL",
    owner = "ALL",
    followUp = "ALL",
    sort = "priority",
    direction = "desc"
  } = {}) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize)
    });
    if (q.trim()) params.set("q", q.trim());
    if (status && status !== "ALL") params.set("status", status);
    if (work && work !== "ALL") params.set("work", work);
    if (filing && filing !== "ALL") params.set("filing", filing);
    if (owner && owner !== "ALL") params.set("owner", owner);
    if (followUp && followUp !== "ALL") params.set("followUp", followUp);
    if (sort) params.set("sort", sort);
    if (direction) params.set("direction", direction);
    return withReadRetry(() =>
      api(`${BASE}/approval-intelligence?${params.toString()}`)
    );
  },

  workManagementUsers() {
    return withReadRetry(() => api(`${BASE}/work-management/users`));
  },

  updateWorkManagement(id, data) {
    return api(`${BASE}/${id}/work-management`, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
  },

  reconcilePayerIdentity(id, reason) {
    return api(`${BASE}/${id}/payer-reconciliation`, {
      method: "POST",
      body: JSON.stringify({ reason })
    });
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

  runCheck(id, { signal } = {}) {
    return api(`${BASE}/${id}/check`, {
      method: "POST",
      signal
    });
  },

  submit(id, options = {}) {
    return api(`${BASE}/${id}/submit`, {
      method: "POST",
      body: JSON.stringify(options)
    });
  },

  reconcileSubmission(id, options = {}) {
    return api(`${BASE}/${id}/submission/reconcile`, {
      method: "POST",
      body: JSON.stringify(options)
    });
  },

  uploadDoc({ claimId, type, file }) {
    const fd = new FormData();
    fd.append("claimId", claimId);
    if (type) fd.append("type", type);
    fd.append("file", file);

    return api("/api/documents/upload", {
      method: "POST",
      body: fd
    });
  },

  applyDocumentSuggestion(docId) {
    return api(`${BASE}/documents/${docId}/apply-suggestion`, {
      method: "POST"
    });
  },

  updateDocumentType(docId, type) {
    return api(`/api/documents/${docId}/type`, {
      method: "PATCH",
      body: JSON.stringify({ type })
    });
  },

  reviewDocumentIdentity(docId, decision = "CONFIRMED") {
    return api(`/api/documents/${docId}/identity-review`, {
      method: "PATCH",
      body: JSON.stringify({ decision })
    });
  },


  deleteDoc(docId) {
    return api(`${BASE}/documents/${docId}`, {
      method: "DELETE"
    });
  },

  bulkDeleteDocs(ids) {
    return api(`${BASE}/documents/bulk-delete`, {
      method: "POST",
      body: JSON.stringify({ ids })
    });
  },

  smartUploadDoc(file) {
    const fd = new FormData();
    fd.append("file", file);

    return api("/api/documents/smart-upload", {
      method: "POST",
      body: fd
    });
  },

  listDocuments(
    claimId = "",
    {
      page = 1,
      pageSize = 50,
      paginated = true,
      sort = "createdAt",
      direction = "desc"
    } = {}
  ) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
      direction
    });
    if (claimId) params.set("claimId", claimId);
    if (paginated) params.set("paginated", "1");
    return withReadRetry(() => api(`/api/documents?${params.toString()}`));
  },

  getDocumentCodingSuggestions(docId) {
    return api(`/api/documents/${docId}/coding-suggestions`);
  },

  reviewCodingSuggestion(suggestionId, { action, code } = {}) {
    return api(`/api/documents/coding-suggestions/${suggestionId}`, {
      method: "PATCH",
      body: JSON.stringify({
        action,
        ...(code ? { code } : {})
      })
    });
  },


  searchClaims(query = "", limit = 20) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("limit", String(limit));

    return withReadRetry(() =>
      api(`${BASE}/search?${params.toString()}`)
    );
  },

  getJourney(id) {
    return withReadRetry(() => api(`${BASE}/${id}/journey`));
  },

  getMockPayers() {
    return withReadRetry(() => api(`${BASE}/payers/mock`));
  },

  getPayerConnectors() {
    return withReadRetry(() => api("/api/payer-connectors"));
  },

  connectExternalPayer(id, data) {
    return api(`${BASE}/${id}/journey/payer-connection`, {
      method: "POST",
      body: JSON.stringify(data)
    });
  },

  connectMockPayer(id, payerCode) {
    return api(`${BASE}/${id}/payer-simulation/connect`, {
      method: "POST",
      body: JSON.stringify({ payerCode })
    });
  },

  simulatePayerEligibility(id) {
    return api(`${BASE}/${id}/payer-simulation/eligibility`, { method: "POST" });
  },

  simulatePayerPriorAuth(id, data = {}) {
    return api(`${BASE}/${id}/payer-simulation/prior-auth`, {
      method: "POST",
      body: JSON.stringify(data)
    });
  },

  simulatePayerSubmission(id) {
    return api(`${BASE}/${id}/payer-simulation/submission`, { method: "POST" });
  },

  simulatePayerStatus(id) {
    return api(`${BASE}/${id}/payer-simulation/status`, { method: "POST" });
  },

  simulatePayerRemittance(id) {
    return api(`${BASE}/${id}/payer-simulation/remittance`, { method: "POST" });
  },

  runEligibilityPrecheck(id) {
    return api(`${BASE}/${id}/journey/eligibility/precheck`, {
      method: "POST"
    });
  },

  evaluatePriorAuth(id, data) {
    return api(`${BASE}/${id}/journey/prior-auth/evaluate`, {
      method: "POST",
      body: JSON.stringify(data)
    });
  },

  getPriorAuthCase(id) {
    return withReadRetry(() => api(`/api/prior-auth/claims/${id}`));
  },

  syncPriorAuthCase(id) {
    return api(`/api/prior-auth/claims/${id}/sync`, {
      method: "POST",
      body: JSON.stringify({})
    });
  },

  updatePriorAuthCase(caseId, data) {
    return api(`/api/prior-auth/cases/${caseId}`, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
  },

  refreshPayerStatus(id) {
    return api(`${BASE}/${id}/journey/claim-status/refresh`, {
      method: "POST",
      body: JSON.stringify({})
    });
  },

  updatePayerStatus(id, payerClaimStatus) {
    return api(`${BASE}/${id}/journey/claim-status`, {
      method: "PATCH",
      body: JSON.stringify({ payerClaimStatus })
    });
  },

  refreshRemittance(id, data = {}) {
    return api(`${BASE}/${id}/journey/remittance/refresh`, {
      method: "POST",
      body: JSON.stringify(data)
    });
  },

  updateRemittance(id, data) {
    return api(`${BASE}/${id}/journey/remittance`, {
      method: "PATCH",
      body: JSON.stringify(data)
    });
  }
};
