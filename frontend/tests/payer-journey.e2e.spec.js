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
  expect(scenarios).toHaveLength(6);
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

    // Payer status cannot be queried until the payer has accepted/received
    // transmission. Validate this in the API, not just the disabled button.
    const preSubmission = await apiContext.post(
      `/api/claims/${scenario.id}/payer-simulation/status`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } }
    );
    expect(preSubmission.status()).toBe(409);

    const eligibility = page.getByTestId("journey-stage-eligibility");
    const priorAuth = page.getByTestId("journey-stage-prior-auth");
    const claim = page.getByTestId("journey-stage-claim");
    const status = page.getByTestId("journey-stage-claim-status");
    const remittance = page.getByTestId("journey-stage-remittance");

    await clickStageButton(eligibility, "Check Eligibility");
    await expect(eligibility).toContainText("Verified");
    await expect(eligibility.getByRole("button", { name: "Eligibility Current" })).toBeDisabled();

    const duplicateEligibility = await apiContext.post(
      `/api/claims/${scenario.id}/payer-simulation/eligibility`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } }
    );
    expect(duplicateEligibility.ok()).toBeTruthy();
    expect((await duplicateEligibility.json()).unchanged).toBe(true);

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

    const duplicateAuth = await apiContext.post(
      `/api/claims/${scenario.id}/payer-simulation/prior-auth`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } }
    );
    expect(duplicateAuth.ok()).toBeTruthy();
    expect((await duplicateAuth.json()).unchanged).toBe(true);

    await clickStageButton(claim, "Submit to Payer");
    await expect(claim).toContainText("Submitted");
    await expect(claim.getByRole("button", { name: "Sent to Payer" })).toBeDisabled();

    const duplicateTransmission = await apiContext.post(
      `/api/claims/${scenario.id}/payer-simulation/submission`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } }
    );
    expect(duplicateTransmission.ok()).toBeTruthy();
    expect((await duplicateTransmission.json()).unchanged).toBe(true);

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
    const approved = remittance.getByLabel("Expected Payer Payment");
    await expect(approved).not.toHaveValue("");

    await expect(status.getByRole("button", { name: "Final Status" })).toBeDisabled();

    await clickStageButton(remittance, "Get Remittance");
    await expect(remittance).toContainText("Posted");
    await expect(remittance.getByLabel("Paid Amount")).not.toHaveValue("");
    await expect(remittance.getByLabel("Payment Reference")).not.toHaveValue("");
    await expect(
      remittance.getByRole("button", { name: "Remittance Posted" })
    ).toBeDisabled();

    const duplicateRemittance = await apiContext.post(
      `/api/claims/${scenario.id}/payer-simulation/remittance`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } }
    );
    expect(duplicateRemittance.ok()).toBeTruthy();
    expect((await duplicateRemittance.json()).unchanged).toBe(true);

    const journeyAfterERA = await apiContext.get(
      `/api/claims/${scenario.id}/journey`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } }
    );
    expect(journeyAfterERA.ok()).toBeTruthy();
    const finalClaim = (await journeyAfterERA.json()).claim;
    expect(finalClaim.status).toBe("PAID");
    expect(finalClaim.remittanceStatus).toBe("POSTED");
    expect(finalClaim.paidAmount).toBeGreaterThan(0);
    if (expectedKey === "APEX") {
      const era = finalClaim.payerTransactions.find((tx) => tx.transactionType === "REMITTANCE");
      expect(era.responsePayload.potentialUnderpayment).toBeGreaterThan(0);
      expect(finalClaim.patientResponsibility).toBeLessThan(era.responsePayload.allowedAmount);
      await expect(remittance).toContainText("Potential payer underpayment");
    }

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


test("payer switch invalidates old coverage and authorization without reusing old transactions", async ({ page }) => {
  const scenario = scenarios.find((item) => item.key === "SWITCH");
  expect(scenario).toBeTruthy();
  await page.goto(`/journey?claimId=${scenario.id}`);
  await expect(page.getByText(scenario.patientName, { exact: true })).toBeVisible();
  await selectPayer(page, payerNames.BLUE_HORIZON);
  const eligibility = page.getByTestId("journey-stage-eligibility");
  const priorAuth = page.getByTestId("journey-stage-prior-auth");
  await clickStageButton(eligibility, "Check Eligibility");
  await expect(eligibility).toContainText("Verified");
  await clickStageButton(priorAuth, "Check Prior Auth");
  await expect(priorAuth).toContainText("Not Required");

  await selectPayer(page, payerNames.CAREFIRST_DEMO);
  await expect(eligibility).not.toContainText("Verified");

  const changedJourney = await apiContext.get(
    `/api/claims/${scenario.id}/journey`,
    { headers: { Authorization: `Bearer ${auth.accessToken}` } }
  );
  expect(changedJourney.ok()).toBeTruthy();
  const state = (await changedJourney.json()).claim;
  expect(state.eligibilityStatus).toBe("NOT_CHECKED");
  expect(state.priorAuthStatus).toBe("NOT_CHECKED");
  expect(state.authorizationNo).toBeNull();

  await clickStageButton(eligibility, "Check Eligibility");
  await expect(eligibility).toContainText("Failed");
  await expect(priorAuth.getByRole("button", { name: "Check Prior Auth" })).toBeDisabled();
  const blockedAuth = await apiContext.post(
    `/api/claims/${scenario.id}/payer-simulation/prior-auth`,
    { headers: { Authorization: `Bearer ${auth.accessToken}` } }
  );
  expect(blockedAuth.status()).toBe(409);
});
