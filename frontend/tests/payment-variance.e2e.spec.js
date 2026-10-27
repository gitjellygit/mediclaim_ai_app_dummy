import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

let apiContext;
let auth;
let claimId;
let recoveryCaseId;

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
    await apiContext.post(`/api/claims/${claimId}/payer-reconciliation`, {
      headers,
      data: {
        reason: "E2E confirms Apex Benefit Network is the current verified payer."
      }
    }),
    "reconcile payer identity"
  );

  const claimForContract = await apiJson(
    await apiContext.get(`/api/claims/${claimId}`, { headers }),
    "load claim for contract"
  );
  const contractLinesByCode = new Map();
  for (const line of claimForContract.serviceLines || []) {
    if (!line.cptHcpcsCode || line.verified === false) continue;
    const key = String(line.cptHcpcsCode).toUpperCase();
    if (!contractLinesByCode.has(key)) {
      contractLinesByCode.set(key, {
        cptHcpcsCode: key,
        unitRate: 9999.99,
        description: "Synthetic high-rate contract test"
      });
    }
  }
  expect(contractLinesByCode.size).toBeGreaterThan(0);

  const contractResponse = await apiContext.post("/api/payer-contracts", {
    headers,
    data: {
      name: `E2E Contract ${Date.now()}`,
      payerName: claimForContract.connectedPayerName || claimForContract.payerName,
      payerEdiId: claimForContract.payerEdiId || null,
      version: "E2E-1",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
      sourceType: "MANUAL",
      feeScheduleLines: [...contractLinesByCode.values()]
    }
  });
  expect(contractResponse.status()).toBe(201);

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
  expect(remittance.underpaymentCase.expectedPaymentSource).toBe("CONTRACT_FEE_SCHEDULE");
  expect(Number(remittance.underpaymentCase.varianceAmount)).toBeGreaterThan(
    remittance.result.potentialUnderpayment
  );
  expect(
    Number(remittance.underpaymentCase.expectedPayerPayment) -
      Number(remittance.underpaymentCase.actualPaidAmount)
  ).toBeCloseTo(Number(remittance.underpaymentCase.varianceAmount), 2);

  const listed = await apiJson(
    await apiContext.get("/api/underpayments", { headers }),
    "list underpayments"
  );

  const recoveryCase = listed.items.find((item) => item.claimId === claimId);
  expect(recoveryCase).toBeTruthy();
  recoveryCaseId = recoveryCase.id;
  expect(recoveryCase.status).toBe("OPEN");
  expect(recoveryCase.outstandingAmount).toBeGreaterThan(0);
  expect(recoveryCase.expectedPaymentSource).toBe("CONTRACT_FEE_SCHEDULE");
  expect(recoveryCase.calculationSnapshot.contractName).toContain("E2E Contract");
  expect(recoveryCase.calculationSnapshot.calculatedLines.length).toBeGreaterThan(0);
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

  await page.goto(`/revenue-recovery/underpayments/${recoveryCaseId}`);
  await expect(
    page.getByRole("heading", { name: "Underpayment Recovery Workspace" })
  ).toBeVisible();
  await expect(page.getByTestId("underpayment-workspace")).toBeVisible();
  await expect(page.getByText("E2E-PAYMENT-VARIANCE", { exact: true })).toBeVisible();
  await expect(page.getByText("RECOVERED", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Payment Variance", { exact: true })).toBeVisible();
  await expect(page.getByTestId("expected-payment-basis")).toContainText("Contract Fee Schedule");
  await expect(page.getByTestId("expected-payment-basis")).toContainText("E2E Contract");
});
