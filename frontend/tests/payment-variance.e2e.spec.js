import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

let apiContext;
let auth;
let claimId;

test.describe.configure({ mode: "serial" });

async function apiJson(response, label) {
  if (!response.ok()) {
    throw new Error(`${label} failed (${response.status()}): ${await response.text()}`);
  }
  return response.json();
}

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });
  auth = await apiJson(
    await apiContext.post("/api/auth/login", { data: { email, password } }),
    "login"
  );

  const seeded = await apiJson(
    await apiContext.post("/api/claims/e2e/payment-variance/seed", {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    }),
    "seed payment variance claim"
  );
  claimId = seeded.id;
});

test.afterAll(async () => {
  if (auth?.accessToken) {
    await apiContext.delete("/api/claims/e2e/payment-variance/cleanup", {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    });
  }
  await apiContext?.dispose();
});

test("payment variance - underpaid remittance automatically opens a recovery case", async () => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };

  await apiJson(
    await apiContext.post(`/api/claims/${claimId}/payer-simulation/connect`, {
      headers,
      data: { payerCode: "APEX_BENEFIT" }
    }),
    "connect payer"
  );

  await apiJson(
    await apiContext.post(`/api/claims/${claimId}/payer-simulation/eligibility`, { headers }),
    "eligibility"
  );

  await apiJson(
    await apiContext.post(`/api/claims/${claimId}/payer-simulation/prior-auth`, {
      headers,
      data: {}
    }),
    "prior auth"
  );

  await apiJson(
    await apiContext.post(`/api/claims/${claimId}/check`, { headers }),
    "readiness"
  );

  await apiJson(
    await apiContext.post(`/api/claims/${claimId}/submit`, { headers }),
    "submit claim"
  );

  await apiJson(
    await apiContext.post(`/api/claims/${claimId}/payer-simulation/submission`, { headers }),
    "payer submission"
  );

  for (let i = 0; i < 3; i += 1) {
    await apiJson(
      await apiContext.post(`/api/claims/${claimId}/payer-simulation/status`, { headers }),
      `payer status ${i + 1}`
    );
  }

  const remittance = await apiJson(
    await apiContext.post(`/api/claims/${claimId}/payer-simulation/remittance`, { headers }),
    "remittance"
  );

  expect(remittance.result.potentialUnderpayment).toBeGreaterThan(0);
  expect(remittance.underpaymentCase).toBeTruthy();
  expect(Number(remittance.underpaymentCase.varianceAmount)).toBe(
    remittance.result.potentialUnderpayment
  );

  const listed = await apiJson(
    await apiContext.get("/api/underpayments", { headers }),
    "list underpayments"
  );

  const recoveryCase = listed.items.find((item) => item.claimId === claimId);
  expect(recoveryCase).toBeTruthy();
  expect(recoveryCase.status).toBe("OPEN");
  expect(recoveryCase.outstandingAmount).toBeGreaterThan(0);
});

test("payment variance - recovery workflow enforces ordered transitions", async () => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  const listed = await apiJson(
    await apiContext.get("/api/underpayments", { headers }),
    "list recovery cases"
  );
  const recoveryCase = listed.items.find((item) => item.claimId === claimId);
  expect(recoveryCase).toBeTruthy();

  const skipped = await apiContext.patch(`/api/underpayments/${recoveryCase.id}`, {
    headers,
    data: { status: "RECOVERED", recoveredAmount: recoveryCase.varianceAmount }
  });
  expect(skipped.status()).toBe(409);

  for (const status of [
    "REVIEWING",
    "DISPUTE_PREPARED",
    "DISPUTE_SUBMITTED"
  ]) {
    const updated = await apiJson(
      await apiContext.patch(`/api/underpayments/${recoveryCase.id}`, {
        headers,
        data: { status }
      }),
      `transition to ${status}`
    );
    expect(updated.status).toBe(status);
  }

  const recovered = await apiJson(
    await apiContext.patch(`/api/underpayments/${recoveryCase.id}`, {
      headers,
      data: {
        status: "RECOVERED",
        recoveredAmount: recoveryCase.varianceAmount,
        notes: "Synthetic recovery posted for regression coverage."
      }
    }),
    "recover variance"
  );

  expect(recovered.status).toBe("RECOVERED");
  expect(recovered.outstandingAmount).toBe(0);
});

test("payment variance - workspace shows the detected case", async ({ page }) => {
  await page.addInitScript(
    ({ accessToken, refreshToken, user }) => {
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
      localStorage.setItem("user", JSON.stringify(user));
    },
    auth
  );

  await page.goto("/payments");
  await expect(
    page.getByRole("heading", { name: "Payment Variance Intelligence" })
  ).toBeVisible();
  await expect(page.getByText("E2E-PAYMENT-VARIANCE", { exact: true })).toBeVisible();
  await expect(page.getByText("RECOVERED", { exact: true })).toBeVisible();
});
