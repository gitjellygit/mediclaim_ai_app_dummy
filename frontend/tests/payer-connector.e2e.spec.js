import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

let apiContext;
let auth;
const createdClaimIds = [];

async function apiJson(response, label) {
  if (!response.ok()) {
    throw new Error(`${label} failed (${response.status()}): ${await response.text()}`);
  }
  return response.json();
}

async function createClaim(data) {
  const response = await apiContext.post("/api/claims", {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data
  });
  const claim = await apiJson(response, "claim create");
  createdClaimIds.push(claim.id);
  return claim;
}

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });
  const login = await apiContext.post("/api/auth/login", {
    data: { email, password }
  });
  auth = await apiJson(login, "E2E login");
});

test.afterAll(async () => {
  for (const id of createdClaimIds) {
    await apiContext.delete(`/api/claims/${id}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    });
  }
  await apiContext?.dispose();
});

test("U6-1 - LOCAL connector preserves eligibility and prior-auth workflow", async () => {
  const claim = await createClaim({
    patientName: "E2E-U6-LOCAL",
    payerName: "Local Test Health",
    policyNo: "U6-LOCAL-POL",
    memberId: "U6-LOCAL-MEM",
    amount: 100,
    claimForm: "PROFESSIONAL",
    billingProviderNpi: "1234567890",
    renderingProviderNpi: "1987654321",
    serviceLines: [
      {
        cptHcpcsCode: "99213",
        units: 1,
        charge: 100,
        placeOfService: "11"
      }
    ]
  });

  expect(claim.payerConnectionMode).toBe("LOCAL");

  const eligibilityResponse = await apiContext.post(
    `/api/claims/${claim.id}/journey/eligibility/precheck`,
    {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: {}
    }
  );
  const eligibility = await apiJson(eligibilityResponse, "local eligibility");

  expect(eligibility.status).toBe("VERIFIED");
  expect(eligibility.coverageStatus).toBe("UNKNOWN");
  expect(eligibility.livePayerVerification).toBe(false);

  const authResponse = await apiContext.post(
    `/api/claims/${claim.id}/journey/prior-auth/evaluate`,
    {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: { required: false }
    }
  );
  const priorAuth = await apiJson(authResponse, "local prior auth");

  expect(priorAuth.status).toBe("NOT_REQUIRED");
  expect(priorAuth.livePayerVerification).toBe(false);
});

test("U6-2 - SIMULATED connector persists normalized payer transaction output", async () => {
  const claim = await createClaim({
    patientName: "E2E-U6-SIMULATED",
    payerName: "Initial Health",
    policyNo: "U6-SIM-POL",
    memberId: "U6-SIM-MEM",
    amount: 200,
    claimForm: "PROFESSIONAL",
    billingProviderNpi: "1234567890",
    renderingProviderNpi: "1987654321",
    serviceLines: [
      {
        cptHcpcsCode: "99214",
        units: 1,
        charge: 200,
        placeOfService: "11"
      }
    ]
  });

  const connectResponse = await apiContext.post(
    `/api/claims/${claim.id}/payer-simulation/connect`,
    {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: { payerCode: "BLUE_HORIZON" }
    }
  );
  const connected = await apiJson(connectResponse, "simulated connect");
  expect(connected.claim.payerConnectionMode).toBe("SIMULATED");

  const eligibilityResponse = await apiContext.post(
    `/api/claims/${claim.id}/payer-simulation/eligibility`,
    {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: {}
    }
  );
  const eligibility = await apiJson(
    eligibilityResponse,
    "simulated eligibility"
  );

  expect(eligibility.result.status).toBe("ACTIVE");
  expect(eligibility.transaction.mode).toBe("SIMULATED");
  expect(eligibility.transaction.transactionType).toBe("ELIGIBILITY");
  expect(eligibility.transaction.responsePayload.status).toBe("ACTIVE");
});

test("U6-3 - mock payer discovery remains explicitly simulated", async () => {
  const response = await apiContext.get("/api/claims/payers/mock", {
    headers: { Authorization: `Bearer ${auth.accessToken}` }
  });
  const body = await apiJson(response, "mock payer discovery");

  expect(body.mode).toBe("SIMULATED");
  expect(body.payers.length).toBeGreaterThan(0);
  expect(body.payers.some((payer) => payer.code === "BLUE_HORIZON")).toBe(true);
});


test("R3 - external 276/277 refresh updates claim status but does not post 835 payment fields", async ({ page }) => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  const seedResponse = await apiContext.post("/api/claims/e2e/r3-claim-status/seed", {
    headers
  });
  const seeded = await apiJson(seedResponse, "R3 claim status seed");

  try {
    const connectorsResponse = await apiContext.get("/api/payer-connectors", {
      headers
    });
    const connectorPayload = await apiJson(connectorsResponse, "payer connector list");
    const connectors = connectorPayload.connectors || [];
    const stedi = connectors.find((item) => item.id === "STEDI_PRODUCTION");
    expect(stedi).toBeTruthy();
    expect(stedi.capabilities).toContain("getStatus");

    await page.addInitScript(
      ({ accessToken, refreshToken, user }) => {
        localStorage.setItem("accessToken", accessToken);
        localStorage.setItem("refreshToken", refreshToken);
        localStorage.setItem("user", JSON.stringify(user));
      },
      auth
    );

    await page.goto(`/journey?claimId=${seeded.id}`);
    const statusStage = page.getByTestId("journey-stage-claim-status");
    await expect(statusStage).toContainText("Acknowledged");

    const refresh = statusStage.getByRole("button", {
      name: "Refresh 276/277 Status",
      exact: true
    });
    await expect(refresh).toBeEnabled();
    await refresh.click();

    await expect(statusStage).toContainText("Paid");
    const finalStatus = statusStage.getByRole("button", {
      name: "Final Status",
      exact: true
    });
    await expect(finalStatus).toBeDisabled();

    const journeyResponse = await apiContext.get(
      `/api/claims/${seeded.id}/journey`,
      { headers }
    );
    const journey = await apiJson(journeyResponse, "R3 journey after 277");
    expect(journey.claim.payerClaimStatus).toBe("PAID");
    expect(journey.claim.status).toBe("PAID");

    // A 277 can report an amount paid, but payment posting remains an 835 concern.
    expect(journey.claim.paidAmount).toBeNull();
    expect(journey.claim.allowedAmount).toBeNull();
    expect(journey.claim.remittanceStatus).toBe("NOT_AVAILABLE");

    const statusTransaction = journey.claim.payerTransactions.find(
      (tx) => tx.transactionType === "CLAIM_STATUS"
    );
    expect(statusTransaction).toBeTruthy();
    expect(statusTransaction.mode).toBe("PRODUCTION");
    expect(statusTransaction.requestPayload.transaction).toBe("276");
    expect(statusTransaction.requestPayload.responseTransaction).toBe("277");
    expect(statusTransaction.responsePayload.statusCategoryCode).toBe("F1");
    expect(statusTransaction.responsePayload.statusCode).toBe("65");
    expect(statusTransaction.responsePayload.amountPaid).toBe(108.77);

    const connectionCard = page.getByTestId("payer-connection-card");
    const toggle = connectionCard.getByTestId("payer-activity-toggle");
    if (await toggle.count()) {
      await toggle.click();
      await expect(connectionCard.getByTestId("payer-activity-history")).toContainText(
        "Claim Status"
      );
    }
  } finally {
    await apiContext.delete("/api/claims/e2e/r3-claim-status/cleanup", {
      headers
    });
  }
});
