import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

let apiContext;
let auth;

async function apiJson(response, label) {
  if (!response.ok()) {
    throw new Error(`${label} failed (${response.status()}): ${await response.text()}`);
  }
  return response.json();
}

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });
  const login = await apiContext.post("/api/auth/login", {
    data: { email, password }
  });
  auth = await apiJson(login, "login");
});

test.afterAll(async () => {
  await apiContext?.dispose();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ accessToken, refreshToken, user }) => {
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
      localStorage.setItem("user", JSON.stringify(user));
    },
    auth
  );
});

test("insurance on file remains source truth when a different payer verifies active", async ({ page }) => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  const create = await apiContext.post("/api/claims", {
    headers,
    data: {
      patientName: "Avery Morgan Separation Test",
      payerName: "Cedar Health Plan",
      memberId: "AM-884210",
      policyNo: "POL-AM-77101",
      amount: 12480
    }
  });
  const claim = await apiJson(create, "create claim");

  try {
    const cedarConnect = await apiContext.post(
      `/api/claims/${claim.id}/payer-simulation/connect`,
      { headers, data: { payerCode: "CAREFIRST_DEMO" } }
    );
    expect(cedarConnect.ok()).toBe(true);

    const cedarEligibility = await apiContext.post(
      `/api/claims/${claim.id}/payer-simulation/eligibility`,
      { headers, data: {} }
    );
    expect(cedarEligibility.ok()).toBe(true);
    expect((await cedarEligibility.json()).result.status).toBe("MEMBER_NOT_FOUND");

    await page.goto(`/journey?claimId=${claim.id}`);

    const insurance = page.getByTestId("insurance-on-file-card");
    const eligibility = page.getByTestId("journey-stage-eligibility");

    await expect(insurance).toContainText("Cedar Health Plan");
    await expect(eligibility).toContainText("Member Not Found");

    const metroConnect = await apiContext.post(
      `/api/claims/${claim.id}/payer-simulation/connect`,
      { headers, data: { payerCode: "METROPLUS_DEMO" } }
    );
    expect(metroConnect.ok()).toBe(true);

    const afterSwitch = await apiJson(
      await apiContext.get(`/api/claims/${claim.id}/journey`, { headers }),
      "journey after payer switch"
    );
    expect(afterSwitch.claim.payerName).toBe("Cedar Health Plan");
    expect(afterSwitch.claim.connectedPayerName).toBe("MetroCare Health");
    expect(afterSwitch.claim.eligibilityStatus).toBe("NOT_CHECKED");

    const metroEligibility = await apiContext.post(
      `/api/claims/${claim.id}/payer-simulation/eligibility`,
      { headers, data: {} }
    );
    expect(metroEligibility.ok()).toBe(true);
    expect((await metroEligibility.json()).result.status).toBe("ACTIVE");

    await page.goto(`/journey?claimId=${claim.id}`);
    await expect(eligibility).toContainText("Verified Active");
    await expect(eligibility).toContainText("Checked against");
    await expect(eligibility).toContainText("MetroCare Health");

    // Source insurance remains Cedar even though MetroCare is the verified connected payer.
    await expect(insurance).toContainText("Cedar Health Plan");
    await expect(insurance).not.toContainText("Insurance on FileMetroCare Health");

    const mismatch = page.getByTestId("insurance-payer-mismatch");
    await expect(mismatch).toBeVisible();
    await expect(mismatch).toContainText("MetroCare Health");
    await expect(mismatch).toContainText("Cedar Health Plan");
    await expect(page.getByTestId("insurance-verification-state")).toHaveText(
      "Not Verified Against File"
    );

    const detail = await apiJson(
      await apiContext.get(`/api/claims/${claim.id}`, { headers }),
      "claim detail"
    );
    expect(detail.payerName).toBe("Cedar Health Plan");
    expect(detail.connectedPayerName).toBe("MetroCare Health");
    expect(detail.connectedPayerCode).toBe("METROPLUS_DEMO");
  } finally {
    await apiContext.delete(`/api/claims/${claim.id}`, { headers });
  }
});
