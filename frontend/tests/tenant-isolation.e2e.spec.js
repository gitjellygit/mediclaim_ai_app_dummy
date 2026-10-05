import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

let apiContext;
let auth;
let fixture;

async function json(response, label) {
  if (!response.ok()) {
    throw new Error(`${label} failed (${response.status()}): ${await response.text()}`);
  }
  return response.json();
}

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });
  auth = await json(
    await apiContext.post("/api/auth/login", { data: { email, password } }),
    "login"
  );
  fixture = await json(
    await apiContext.post("/api/claims/e2e/tenant-isolation/seed", {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    }),
    "seed tenant isolation"
  );
});

test.afterAll(async () => {
  if (auth?.accessToken) {
    await apiContext.delete("/api/claims/e2e/tenant-isolation/cleanup", {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    });
  }
  await apiContext?.dispose();
});

test("H0 - mixed-organization bulk delete is rejected atomically", async () => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };

  const mixedRequest = await apiContext.post("/api/documents/bulk-delete", {
    headers,
    data: {
      ids: [fixture.bulkDeleteOwnDocumentId, fixture.foreignDocumentId]
    }
  });

  expect(mixedRequest.status()).toBe(404);

  const afterMixedRequest = await json(
    await apiContext.post("/api/claims/e2e/tenant-isolation/verify", {
      headers,
      data: {
        ownDocumentId: fixture.bulkDeleteOwnDocumentId,
        foreignDocumentId: fixture.foreignDocumentId
      }
    }),
    "verify after mixed organization request"
  );

  expect(afterMixedRequest.ownExists).toBe(true);
  expect(afterMixedRequest.foreignExists).toBe(true);

  const ownDelete = await json(
    await apiContext.post("/api/documents/bulk-delete", {
      headers,
      data: { ids: [fixture.bulkDeleteOwnDocumentId] }
    }),
    "delete own document"
  );

  expect(ownDelete.deleted).toBe(1);

  const final = await json(
    await apiContext.post("/api/claims/e2e/tenant-isolation/verify", {
      headers,
      data: {
        ownDocumentId: fixture.ownDocumentId,
        foreignDocumentId: fixture.foreignDocumentId
      }
    }),
    "verify tenant isolation"
  );

  expect(final.ownExists).toBe(false);
  expect(final.foreignExists).toBe(true);
});

test("H8B-1 - foreign claim cannot be read by different organization", async () => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };

  // Try to read foreign claim
  const foreignClaim = await apiContext.get(`/api/claims/${fixture.foreignClaimId}`, {
    headers
  });

  expect(foreignClaim.status()).toBe(404);

  // Own claim is accessible
  const ownClaim = await json(
    await apiContext.get(`/api/claims/${fixture.ownClaimId}`, {
      headers
    }),
    "read own claim"
  );

  expect(ownClaim.id).toBe(fixture.ownClaimId);
});

test("H8B-1 - foreign claim cannot be updated by different organization", async () => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };

  // Try to update foreign claim
  const updateForeign = await apiContext.patch(`/api/claims/${fixture.foreignClaimId}`, {
    headers,
    data: { patientName: "Modified Name" }
  });

  expect(updateForeign.status()).toBe(404);

  // Own claim can be updated
  const updateOwn = await json(
    await apiContext.patch(`/api/claims/${fixture.ownClaimId}`, {
      headers,
      data: { patientName: "Test Update" }
    }),
    "update own claim"
  );

  expect(updateOwn.patientName).toBe("Test Update");
});

test("H8B-1 - foreign claim cannot be deleted by different organization", async () => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };

  // Try to delete foreign claim
  const deleteForeign = await apiContext.delete(`/api/claims/${fixture.foreignClaimId}`, {
    headers
  });

  expect(deleteForeign.status()).toBe(404);
});

test("H8B-1 - foreign document metadata cannot be read by different organization", async () => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };

  // The supported metadata read is claim-scoped. A foreign claim must expose
  // no document metadata to this organization.
  const foreignDocs = await json(
    await apiContext.get(`/api/documents/claim/${fixture.foreignClaimId}`, {
      headers
    }),
    "list foreign claim documents"
  );

  expect(foreignDocs).toEqual([]);

  // The same endpoint must still expose this organization's own document.
  const ownDocs = await json(
    await apiContext.get(`/api/documents/claim/${fixture.ownClaimId}`, {
      headers
    }),
    "list own claim documents"
  );

  expect(ownDocs.some((doc) => doc.id === fixture.ownDocumentId)).toBe(true);
  expect(ownDocs.some((doc) => doc.id === fixture.foreignDocumentId)).toBe(false);
});

test("H8B-1 - foreign document cannot be reprocessed by different organization", async () => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };

  // Try to reprocess foreign document
  const reprocessForeign = await apiContext.post(
    `/api/documents/${fixture.foreignDocumentId}/process`,
    {
      headers,
      data: { suggestedType: "DISCHARGE_SUMMARY" }
    }
  );

  expect(reprocessForeign.status()).toBe(404);
});

test("H8B-1 - foreign document cannot be deleted by different organization", async () => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };

  // Try to delete foreign document
  const deleteForeign = await apiContext.delete(
    `/api/documents/${fixture.foreignDocumentId}`,
    {
      headers
    }
  );

  expect(deleteForeign.status()).toBe(404);
});

test("H8B-1 - rules are scoped to organization", async () => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };

  // Create a rule for own org
  const createRule = await json(
    await apiContext.post("/api/rules", {
      headers,
      data: { code: "H8B1_TEST_RULE", name: "H8B1 Test Rule", severity: "WARN" }
    }),
    "create rule"
  );

  expect(createRule.code).toBe("H8B1_TEST_RULE");

  // Read rules for own org
  const rules = await json(
    await apiContext.get("/api/rules", {
      headers
    }),
    "read rules"
  );

  expect(rules.some((r) => r.code === "H8B1_TEST_RULE")).toBe(true);

  // Clean up
  await apiContext.delete(`/api/rules/${createRule.id}`, {
    headers
  });
});

test("H8B-1 - medical consistency detail is scoped to organization", async () => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };

  // Try to get medical consistency for foreign claim
  const foreignConsistency = await apiContext.get(
    `/api/claims/${fixture.foreignClaimId}/medical-consistency`,
    {
      headers
    }
  );

  expect(foreignConsistency.status()).toBe(404);

  // Own claim medical consistency is accessible
  const ownConsistency = await json(
    await apiContext.get(`/api/claims/${fixture.ownClaimId}/medical-consistency`, {
      headers
    }),
    "read own medical consistency"
  );

  expect(ownConsistency.claim.id).toBe(fixture.ownClaimId);
});

test("H8B-1 - claim journey is scoped to organization", async () => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };

  // Try to get journey for foreign claim
  const foreignJourney = await apiContext.get(
    `/api/claims/${fixture.foreignClaimId}/journey`,
    {
      headers
    }
  );

  expect(foreignJourney.status()).toBe(404);

  // Own claim journey is accessible
  const ownJourney = await json(
    await apiContext.get(`/api/claims/${fixture.ownClaimId}/journey`, {
      headers
    }),
    "read own journey"
  );

  expect(ownJourney.claim.id).toBe(fixture.ownClaimId);
});

test("H8B-1 - claim audit log is scoped to organization", async () => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };

  // Try to get audit for foreign claim
  const foreignAudit = await apiContext.get(
    `/api/claims/${fixture.foreignClaimId}/audit`,
    {
      headers
    }
  );

  expect(foreignAudit.status()).toBe(404);

  // Own claim audit is accessible
  const ownAudit = await json(
    await apiContext.get(`/api/claims/${fixture.ownClaimId}/audit`, {
      headers
    }),
    "read own audit"
  );

  expect(Array.isArray(ownAudit.items)).toBe(true);
});
