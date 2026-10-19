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
