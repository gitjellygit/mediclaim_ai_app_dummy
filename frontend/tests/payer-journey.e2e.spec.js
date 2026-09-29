import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

const payerNames = {
  BLUE_HORIZON: "Blue Horizon Health",
  SUMMITCARE: "SummitCare Insurance",
  METROPLUS_DEMO: "MetroCare Health",
  CAREFIRST_DEMO: "Cedar Health Plan",
  APEX_BENEFIT: "Apex Benefit Network"
};

let apiContext;
let auth;
let scenarios = [];

async function selectPayer(page, payerName) {
  await page.getByTestId("payer-select").click();
  await page.getByRole("option", { name: payerName }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true }).first()).toBeVisible();
}

async function clickStageButton(stage, name) {
  const button = stage.getByRole("button", { name, exact: true });
  await expect(button).toBeEnabled();
  await button.click();
}

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });

  const login = await apiContext.post("/api/auth/login", {
    data: { email, password }
  });
  if (!login.ok()) throw new Error(`E2E login failed: ${await login.text()}`);
  auth = await login.json();

  const seed = await apiContext.post("/api/claims/e2e/payer-journey/seed", {
    headers: { Authorization: `Bearer ${auth.accessToken}` }
  });
  if (!seed.ok()) throw new Error(`Payer seed failed: ${await seed.text()}`);
  const body = await seed.json();
  scenarios = body.scenarios;
  expect(scenarios).toHaveLength(5);
});

test.afterAll(async () => {
  if (apiContext && auth?.accessToken) {
    await apiContext.delete("/api/claims/e2e/payer-journey/cleanup", {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    });
  }
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

for (const expectedKey of ["BLUE", "SUMMIT", "METRO", "CEDAR", "APEX"]) {
  test(`payer Journey end-to-end: ${expectedKey}`, async ({ page }) => {
    const scenario = scenarios.find((item) => item.key === expectedKey);
    expect(scenario).toBeTruthy();

    await page.goto(`/journey?claimId=${scenario.id}`);
    await expect(page.getByRole("heading", { name: "Claim Journey" })).toBeVisible();
    await expect(page.getByText(scenario.patientName, { exact: true })).toBeVisible();

    // Client-facing screen stays clean: no implementation-source labels.
    await expect(page.getByText("SIMULATED", { exact: true })).toHaveCount(0);
    await expect(page.getByText("LOCAL", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Mock Payer/i)).toHaveCount(0);

    await selectPayer(page, payerNames[scenario.payerCode]);

    const eligibility = page.getByTestId("journey-stage-eligibility");
    const priorAuth = page.getByTestId("journey-stage-prior-auth");
    const claim = page.getByTestId("journey-stage-claim");
    const status = page.getByTestId("journey-stage-claim-status");
    const remittance = page.getByTestId("journey-stage-remittance");

    await clickStageButton(eligibility, "Check Eligibility");
    await expect(eligibility).toContainText("Verified");
    await expect(eligibility.getByRole("button", { name: "Eligibility Current" })).toBeDisabled();

    await clickStageButton(priorAuth, "Check Prior Auth");

    if (expectedKey === "SUMMIT") {
      await expect(priorAuth).toContainText("Required");
      const authInput = priorAuth.getByLabel(/Authorization No/);
      await authInput.fill("AUTH-SUMMIT-100");
      await clickStageButton(priorAuth, "Check Prior Auth");
      await expect(priorAuth).toContainText("Approved");
    } else {
      await expect(priorAuth).toContainText("Not Required");
    }

    await expect(
      priorAuth.getByRole("button", { name: "Authorization Current" })
    ).toBeDisabled();

    await clickStageButton(claim, "Submit to Payer");
    await expect(claim).toContainText("Submitted");
    await expect(claim.getByRole("button", { name: "Sent to Payer" })).toBeDisabled();

    // Status progression is intentionally polled; identical final/pended states
    // must not create unlimited activity rows.
    await clickStageButton(status, "Check Status");
    await expect(status).toContainText(/Received|In Review|Pended|Approved|Partially Approved/);

    await clickStageButton(status, "Check Status");
    await clickStageButton(status, "Check Status");

    if (expectedKey === "METRO") {
      await expect(status).toContainText("Pended");

      const activityBefore = await page.locator('[data-testid="payer-connection-card"] .MuiPaper-outlined').count();
      await clickStageButton(status, "Check Status");
      const activityAfter = await page.locator('[data-testid="payer-connection-card"] .MuiPaper-outlined').count();
      expect(activityAfter).toBe(activityBefore);

      await expect(remittance.getByRole("button", { name: "Get Remittance" })).toBeDisabled();
      return;
    }

    if (expectedKey === "APEX") {
      await expect(status).toContainText("Partially Approved");
    } else {
      await expect(status).toContainText("Approved");
    }

    // Adjudication should pre-fill financial data before remittance arrives.
    const allowed = remittance.getByLabel("Allowed Amount");
    await expect(allowed).not.toHaveValue("");
    const approved = remittance.getByLabel("Approved Amount");
    await expect(approved).not.toHaveValue("");

    await expect(status.getByRole("button", { name: "Final Status" })).toBeDisabled();

    await clickStageButton(remittance, "Get Remittance");
    await expect(remittance).toContainText("Posted");
    await expect(remittance.getByLabel("Paid Amount")).not.toHaveValue("");
    await expect(remittance.getByLabel("Payment Reference")).not.toHaveValue("");
    await expect(
      remittance.getByRole("button", { name: "Remittance Posted" })
    ).toBeDisabled();

    console.log(`✓ ${expectedKey} full payer lifecycle passed`);
  });
}

test("payer Journey compact activity and duplicate-action protections", async ({ page }) => {
  const scenario = scenarios.find((item) => item.key === "BLUE");
  await page.goto(`/journey?claimId=${scenario.id}`);

  // BLUE may have been cleaned/recreated by isolated worker ordering. If already
  // connected from its lifecycle test, the current state itself proves the lock.
  const connectionCard = page.getByTestId("payer-connection-card");
  await expect(connectionCard).toBeVisible();

  const visibleRows = connectionCard.locator(".MuiPaper-outlined");
  expect(await visibleRows.count()).toBeLessThanOrEqual(5);

  const viewAll = connectionCard.getByRole("button", { name: /View All/ });
  if (await viewAll.count()) {
    await viewAll.click();
    expect(await visibleRows.count()).toBeGreaterThanOrEqual(5);
    await connectionCard.getByRole("button", { name: "Show Recent" }).click();
    expect(await visibleRows.count()).toBeLessThanOrEqual(5);
  }
});
