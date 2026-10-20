import { test, expect, request } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

let api;
let auth;
let fixture;

function headers() {
  return { Authorization: `Bearer ${auth.accessToken}` };
}

async function json(response, label) {
  if (!response.ok()) {
    throw new Error(`${label} failed (${response.status()}): ${await response.text()}`);
  }
  return response.json();
}

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: backendURL });
  auth = await json(
    await api.post("/api/auth/login", {
      data: { email, password }
    }),
    "login"
  );
});

test.beforeEach(async () => {
  fixture = await json(
    await api.post("/api/claims/e2e/submission-safety/seed", {
      headers: headers()
    }),
    "seed submission safety"
  );
});

test.afterEach(async () => {
  await api.delete("/api/claims/e2e/submission-safety/cleanup", {
    headers: headers()
  });
});

test.afterAll(async () => {
  await api?.dispose();
});

test("Submission safety - 20 concurrent API submits still produce exactly one committed submission", async () => {
  const path = `/api/claims/${fixture.primaryClaimId}/submit`;
  const responses = await Promise.all(
    Array.from({ length: 20 }, () =>
      api.post(path, { headers: headers(), data: {} })
    )
  );

  const statuses = responses.map((response) => response.status());
  expect(statuses.filter((status) => status === 200)).toHaveLength(1);
  expect(statuses.filter((status) => status === 409)).toHaveLength(19);

  const claim = await json(
    await api.get(`/api/claims/${fixture.primaryClaimId}`, {
      headers: headers()
    }),
    "load high-concurrency submitted claim"
  );
  expect(claim.status).toBe("SUBMITTED");
  expect(claim.patientControlNumber).toMatch(/^[A-F0-9]{17}$/);
});

test("Submission safety - every key mutation surface is locked while SUBMITTING", async () => {
  const claimId = fixture.mutationLockedClaimId;

  const edit = await api.patch(`/api/claims/${claimId}`, {
    headers: headers(),
    data: { patientName: "SHOULD-NOT-CHANGE" }
  });
  expect(edit.status()).toBe(409);

  const check = await api.post(`/api/claims/${claimId}/check`, {
    headers: headers(),
    data: {}
  });
  expect(check.status()).toBe(409);

  const deletion = await api.delete(`/api/claims/${claimId}`, {
    headers: headers()
  });
  expect(deletion.status()).toBe(409);

  const documentType = await api.patch(
    `/api/documents/${fixture.activeLockedDocumentId}/type`,
    {
      headers: headers(),
      data: { type: "EOB" }
    }
  );
  expect(documentType.status()).toBe(409);

  const coding = await api.patch(
    `/api/documents/coding-suggestions/${fixture.activeLockedCodingSuggestionId}`,
    {
      headers: headers(),
      data: { action: "ACCEPT" }
    }
  );
  expect(coding.status()).toBe(409);

  const eligibility = await api.post(
    `/api/claims/${claimId}/journey/eligibility/precheck`,
    {
      headers: headers(),
      data: {}
    }
  );
  expect(eligibility.status()).toBe(409);

  const priorAuth = await api.post(
    `/api/claims/${claimId}/journey/prior-auth/evaluate`,
    {
      headers: headers(),
      data: { required: false }
    }
  );
  expect(priorAuth.status()).toBe(409);

  const claim = await json(
    await api.get(`/api/claims/${claimId}`, { headers: headers() }),
    "load locked claim after mutation attempts"
  );
  expect(claim.status).toBe("SUBMITTING");
  expect(claim.patientName).not.toBe("SHOULD-NOT-CHANGE");

  const documentsResponse = await api.get(
    `/api/documents?claimId=${claimId}&paginated=1`,
    { headers: headers() }
  );
  expect(documentsResponse.status()).toBe(200);
  const documentsBody = await documentsResponse.json();
  const docs = Array.isArray(documentsBody)
    ? documentsBody
    : documentsBody.items || documentsBody.documents || [];
  const lockedDoc = docs.find((doc) => doc.id === fixture.activeLockedDocumentId);
  expect(lockedDoc).toBeTruthy();
  expect(lockedDoc.type).toBe("FINAL_BILL");
  expect(lockedDoc.claim).toBeUndefined();
  expect(lockedDoc.rawText).toBeUndefined();
  expect(lockedDoc.fileHash).toBeUndefined();
  expect(lockedDoc.path).toBeUndefined();

  const suggestions = await json(
    await api.get(
      `/api/documents/${fixture.activeLockedDocumentId}/coding-suggestions`,
      { headers: headers() }
    ),
    "load locked coding suggestions"
  );
  const lockedSuggestion = (suggestions.items || []).find(
    (suggestion) => suggestion.id === fixture.activeLockedCodingSuggestionId
  );
  expect(lockedSuggestion.status).toBe("PENDING");
});

test("Submission safety - reconciliation completes from durable payer evidence without retransmission", async () => {
  const claimId = fixture.acceptedEvidenceClaimId;

  const response = await api.post(
    `/api/claims/${claimId}/submission/reconcile`,
    {
      headers: headers(),
      data: {}
    }
  );

  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.reconciled).toBe(true);
  expect(body.source).toBe("PAYER_TRANSACTION");
  expect(body.claim.status).toBe("SUBMITTED");
  expect(body.claim.payerClaimStatus).toBe("ACKNOWLEDGED");
  expect(body.claim.payerReferenceNo).toBe("PAYER-ACK-1001");
  expect(body.claim.claimSubmissionDate).toBeTruthy();

  const second = await api.post(
    `/api/claims/${claimId}/submission/reconcile`,
    {
      headers: headers(),
      data: {}
    }
  );
  expect(second.status()).toBe(409);
  const secondBody = await second.json();
  expect(secondBody.code).toBe("CLAIM_NOT_SUBMITTING");

  const stored = await json(
    await api.get(`/api/claims/${claimId}`, { headers: headers() }),
    "load reconciled claim"
  );
  expect(stored.status).toBe("SUBMITTED");
  expect(stored.payerClaimStatus).toBe("ACKNOWLEDGED");
  expect(stored.payerReferenceNo).toBe("PAYER-ACK-1001");
});

test("Submission safety - reconciliation is tenant scoped even for ADMIN", async () => {
  const response = await api.post(
    `/api/claims/${fixture.foreignSubmittingClaimId}/submission/reconcile`,
    {
      headers: headers(),
      data: { releaseIfNotFound: true }
    }
  );
  expect(response.status()).toBe(404);
});

test("Submission safety - concurrent submits produce exactly one committed submission", async () => {
  const path = `/api/claims/${fixture.primaryClaimId}/submit`;

  const [first, second] = await Promise.all([
    api.post(path, { headers: headers(), data: {} }),
    api.post(path, { headers: headers(), data: {} })
  ]);

  const statuses = [first.status(), second.status()].sort((a, b) => a - b);
  expect(statuses).toEqual([200, 409]);

  const successResponse = first.status() === 200 ? first : second;
  const conflictResponse = first.status() === 409 ? first : second;
  const success = await successResponse.json();
  const conflict = await conflictResponse.json();

  expect(success.success).toBe(true);
  expect(success.claim.status).toBe("SUBMITTED");
  expect(success.claim.patientControlNumber).toMatch(/^[A-F0-9]{17}$/);
  expect(success.claim.documents).toBeUndefined();
  expect(success.claim.fieldProvenance).toBeUndefined();
  expect(JSON.stringify(success.claim)).not.toMatch(/rawText|fileHash|e2e-fixture|path/i);

  expect([
    "CLAIM_SUBMISSION_IN_PROGRESS",
    "CLAIM_LOCKED"
  ]).toContain(conflict.code);

  const stored = await json(
    await api.get(`/api/claims/${fixture.primaryClaimId}`, {
      headers: headers()
    }),
    "load submitted claim"
  );
  expect(stored.status).toBe("SUBMITTED");
  expect(stored.patientControlNumber).toBe(success.claim.patientControlNumber);
});

test("Submission safety - secondary and tertiary claims fail closed before transmission", async () => {
  for (const claimId of [
    fixture.secondaryClaimId,
    fixture.tertiaryClaimId
  ]) {
    const response = await api.post(`/api/claims/${claimId}/submit`, {
      headers: headers(),
      data: {}
    });
    expect(response.status()).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("SECONDARY_TERTIARY_SUBMISSION_NOT_SUPPORTED");

    const claim = await json(
      await api.get(`/api/claims/${claimId}`, { headers: headers() }),
      "load COB claim"
    );
    expect(claim.status).toBe("READY");
    expect(claim.claimSubmissionDate).toBeNull();
  }
});

test("Submission safety - active SUBMITTING lock cannot be stolen", async () => {
  const response = await api.post(
    `/api/claims/${fixture.activeSubmittingClaimId}/submit`,
    {
      headers: headers(),
      data: {}
    }
  );

  expect(response.status()).toBe(409);
  const body = await response.json();
  expect(body.code).toBe("CLAIM_SUBMISSION_IN_PROGRESS");

  const claim = await json(
    await api.get(`/api/claims/${fixture.activeSubmittingClaimId}`, {
      headers: headers()
    }),
    "load active locked claim"
  );
  expect(claim.status).toBe("SUBMITTING");
});

test("Submission safety - abandoned SUBMITTING lock is reclaimed safely", async () => {
  const response = await api.post(
    `/api/claims/${fixture.staleSubmittingClaimId}/submit`,
    {
      headers: headers(),
      data: {}
    }
  );

  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.success).toBe(true);
  expect(body.claim.status).toBe("SUBMITTED");
  expect(body.claim.patientControlNumber).toMatch(/^[A-F0-9]{17}$/);

  const claim = await json(
    await api.get(`/api/claims/${fixture.staleSubmittingClaimId}`, {
      headers: headers()
    }),
    "load reclaimed claim"
  );
  expect(claim.status).toBe("SUBMITTED");
  expect(claim.submissionAttemptId).toBeUndefined();
});

test("Submission safety - admin reconciliation cannot prematurely release an active submission", async () => {
  const response = await api.post(
    `/api/claims/${fixture.activeSubmittingClaimId}/submission/reconcile`,
    {
      headers: headers(),
      data: { releaseIfNotFound: true }
    }
  );

  expect(response.status()).toBe(409);

  const claim = await json(
    await api.get(`/api/claims/${fixture.activeSubmittingClaimId}`, {
      headers: headers()
    }),
    "load active claim after premature reconcile attempt"
  );
  expect(claim.status).toBe("SUBMITTING");
});

test("Submission safety - reconciliation-required stale lock cannot be retried normally", async () => {
  const response = await api.post(
    `/api/claims/${fixture.reconciliationRequiredClaimId}/submit`,
    {
      headers: headers(),
      data: {}
    }
  );

  expect(response.status()).toBe(409);
  const body = await response.json();
  expect(body.code).toBe("CLAIM_SUBMISSION_RECONCILIATION_REQUIRED");

  const claim = await json(
    await api.get(`/api/claims/${fixture.reconciliationRequiredClaimId}`, {
      headers: headers()
    }),
    "load reconciliation-required claim"
  );
  expect(claim.status).toBe("SUBMITTING");
});

test("Submission safety - admin can explicitly reconcile a stale local submission back to READY", async () => {
  const response = await api.post(
    `/api/claims/${fixture.reconciliationRequiredClaimId}/submission/reconcile`,
    {
      headers: headers(),
      data: { releaseIfNotFound: true }
    }
  );

  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.reconciled).toBe(true);
  expect(body.released).toBe(true);
  expect(body.status).toBe("READY");

  const claim = await json(
    await api.get(`/api/claims/${fixture.reconciliationRequiredClaimId}`, {
      headers: headers()
    }),
    "load released claim"
  );
  expect(claim.status).toBe("READY");
});

test("Submission safety - non-admin users cannot reconcile submissions", async () => {
  const cashier = await json(
    await api.post("/api/auth/login", {
      data: { email: "cashier@hospital.com", password: "cashier123" }
    }),
    "cashier login"
  );

  const response = await api.post(
    `/api/claims/${fixture.reconciliationRequiredClaimId}/submission/reconcile`,
    {
      headers: { Authorization: `Bearer ${cashier.accessToken}` },
      data: { releaseIfNotFound: true }
    }
  );

  expect(response.status()).toBe(403);
});

test("Submission safety - approval intelligence includes in-flight and stale submissions", async () => {
  const response = await api.get("/api/claims/approval-intelligence?status=SUBMITTING", {
    headers: headers()
  });
  expect(response.status()).toBe(200);
  const body = await response.json();

  expect(body.metrics.submitting).toBeGreaterThanOrEqual(3);
  expect(body.metrics.staleSubmitting).toBeGreaterThanOrEqual(2);
  expect(body.metrics.submitted).toBeGreaterThanOrEqual(body.metrics.submitting);
  expect(body.submissionAlert).toBeTruthy();
  expect(body.submissionAlert.count).toBeGreaterThanOrEqual(2);
  expect(body.items.every((item) => item.status === "SUBMITTING")).toBe(true);
});

test("Submission safety - retry after successful submission cannot create a second submission", async () => {
  const path = `/api/claims/${fixture.primaryClaimId}/submit`;
  const first = await api.post(path, { headers: headers(), data: {} });
  expect(first.status()).toBe(200);
  const firstBody = await first.json();

  const retry = await api.post(path, { headers: headers(), data: {} });
  expect(retry.status()).toBe(409);
  const retryBody = await retry.json();
  expect(retryBody.code).toBe("CLAIM_LOCKED");

  const claim = await json(
    await api.get(`/api/claims/${fixture.primaryClaimId}`, {
      headers: headers()
    }),
    "load retried claim"
  );
  expect(claim.patientControlNumber).toBe(firstBody.claim.patientControlNumber);
  expect(claim.status).toBe("SUBMITTED");
});
