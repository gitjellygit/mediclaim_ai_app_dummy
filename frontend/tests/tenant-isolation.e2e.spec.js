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
      ids: [fixture.ownDocumentId, fixture.foreignDocumentId]
    }
  });

  expect(mixedRequest.status()).toBe(404);

  const afterMixedRequest = await json(
    await apiContext.post("/api/claims/e2e/tenant-isolation/verify", {
      headers,
      data: {
        ownDocumentId: fixture.ownDocumentId,
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
      data: { ids: [fixture.ownDocumentId] }
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
