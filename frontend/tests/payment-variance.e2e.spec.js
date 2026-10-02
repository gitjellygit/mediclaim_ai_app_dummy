import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

let apiContext;
let auth;
let claimId;

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

  const claim = await apiJson(
    await apiContext.post("/api/claims", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: {
        patientName: "E2E-PAYMENT-VARIANCE",
        payerName: "Apex Benefit Network",
        policyNo: "PAY-VAR-100",
        memberId: "APEX-MEMBER-100",
        amount: 1000,
        claimForm: "PROFESSIONAL",
        billingProviderNpi: "1234567890",
        renderingProviderNpi: "1234567890",
        icd10Codes: ["M54.50"],
        timelyFilingDeadline: "12/31/2027",
        serviceLines: [{
          cptHcpcsCode: "99213",
          units: 1,
          charge: 1000,
          diagnosisPointers: ["M54.50"],
          placeOfService: "11"
        }]
      }
    }),
    "create claim"
  );
  claimId = claim.id;
});

test.afterAll(async () => {
  if (claimId) {
    await apiContext.delete(`/api/claims/${claimId}`, {
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
