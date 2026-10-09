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

async function selectPayer(page, payerName) {
  const suggested = page.getByTestId("suggested-payer-confirmation");
  if (await suggested.count()) {
    const suggestedInput = suggested.getByLabel("Suggested payer");
    if ((await suggestedInput.inputValue()) === payerName) {
      await suggested.getByRole("button", { name: "Confirm payer", exact: true }).click();
    } else {
      await suggested.getByRole("button", { name: "Choose different", exact: true }).click();
    }
  }

  if ((await page.getByTestId("payer-select").count()) === 0) {
    const change = page.getByRole("button", { name: "Change payer", exact: true });
    if (await change.count()) await change.click();
  }

  if (await page.getByTestId("payer-select").count()) {
    await page.getByTestId("payer-select").click();
    await page.getByRole("option", { name: payerName }).click();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
  }

  await expect(page.getByText("Connected", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("connected-payer").locator("input")).toHaveValue(payerName);
  await expect(page.getByTestId("payer-select")).toHaveCount(0);
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
    await page.goto(`/journey?claimId=${claim.id}`);

    const insurance = page.getByTestId("insurance-on-file-card");
    const eligibility = page.getByTestId("journey-stage-eligibility");

    await expect(insurance).toContainText("Cedar Health Plan");

    await selectPayer(page, "Cedar Health Plan");
    await eligibility.getByRole("button", { name: "Check Eligibility", exact: true }).click();
    await expect(eligibility).toContainText("Member Not Found");
    await expect(insurance).toContainText("Cedar Health Plan");

    await selectPayer(page, "MetroCare Health");
    await expect(eligibility).toContainText("Not Checked");
    await eligibility.getByRole("button", { name: "Check Eligibility", exact: true }).click();

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
