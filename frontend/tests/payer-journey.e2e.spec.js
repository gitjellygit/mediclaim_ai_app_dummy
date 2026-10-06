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
  if ((await page.getByTestId("payer-select").count()) === 0) {
    const change = page.getByRole("button", { name: "Change payer", exact: true });
    if (await change.count()) await change.click();
  }
  await page.getByTestId("payer-select").click();
  await page.getByRole("option", { name: payerName }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("connected-payer")).toHaveValue(payerName);
  await expect(page.getByTestId("payer-select")).toHaveCount(0);
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

test("Journey landing page waits for explicit claim selection", async ({ page }) => {
  const firstScenario = scenarios[0];

  await page.goto("/journey");

  await expect(page.getByRole("heading", { name: "Claim Journey" })).toBeVisible();
  await expect(page.getByLabel("Choose a Claim")).toBeVisible();
  await expect(
    page.getByText(
      /Choose a claim above to view its complete lifecycle/i
    )
  ).toBeVisible();

  await expect(page.getByTestId("journey-stage-eligibility")).toHaveCount(0);
  await expect(page.getByTestId("journey-stage-claim")).toHaveCount(0);
  await expect(page.getByText(firstScenario.patientName, { exact: true })).toHaveCount(0);
});

test("Journey deep link loads the requested claim and uses clear claim-detail labels", async ({ page }) => {
  const scenario = scenarios[0];

  await page.goto(`/journey?claimId=${scenario.id}`);

  await expect(page.getByText(scenario.patientName, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "View Claim Details" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Claim" })).toHaveCount(0);
});

test("Payer connection is required before eligibility and prior authorization", async ({ page }) => {
  const scenario = scenarios[1];

  await page.goto(`/journey?claimId=${scenario.id}`);
  await expect(page.getByTestId("payer-connection-card")).toContainText(
    "Payer connection required"
  );

  const eligibility = page.getByTestId("journey-stage-eligibility");
  const priorAuth = page.getByTestId("journey-stage-prior-auth");

  await expect(eligibility).toContainText("Connect the payer above to unlock Eligibility");
  await expect(
    eligibility.getByRole("button", { name: "Check Eligibility" })
  ).toBeDisabled();

  await expect(priorAuth).toContainText(
    "Connect the payer above before checking Prior Authorization"
  );
  await expect(
    priorAuth.getByRole("button", { name: "Check Prior Auth" })
  ).toBeDisabled();
});

test("Approval Intelligence sends unevaluated editable claims directly to AI readiness", async ({ page }) => {
  const scenario = scenarios.find((item) => item.key === "SWITCH");
  expect(scenario).toBeTruthy();

  await page.goto("/approval");

  const search = page.getByPlaceholder(
    "Search patient, payer, policy, member or claim number..."
  );
  await search.fill(scenario.patientName);

  const row = page.getByRole("row").filter({ hasText: scenario.patientName });
  await expect(row).toBeVisible();
  await expect(row.getByText("Not evaluated", { exact: true }).first()).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Run AI Check", exact: true })
  ).toBeVisible();

  await row.getByRole("button", { name: "Run AI Check", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/claims/${scenario.id}\\?section=readiness`));
  await expect(
    page.getByRole("heading", { name: "Claim Readiness for Submission" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check Readiness", exact: true })
  ).toBeVisible();
});

test("Claim readiness Fix actions highlight the exact provider and service-line fields", async ({ page }) => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  const created = await apiContext.post("/api/claims", {
    headers,
    data: {
      patientName: "E2E-READINESS-FIX-TARGETS",
      payerName: "Blue Horizon Health",
      amount: 250,
      totalBilledAmount: 250,
      policyNo: "POL-E2E-READY",
      memberId: "MEM-E2E-READY",
      claimForm: "PROFESSIONAL",
      diagnosisText: "Routine office visit",
      icd10Codes: ["Z00.00"],
      dateOfService: "2026-10-01"
    }
  });
  expect(created.ok()).toBeTruthy();
  const claim = await created.json();

  try {
    const check = await apiContext.post(`/api/claims/${claim.id}/check`, {
      headers,
      data: {}
    });
    expect(check.ok()).toBeTruthy();
    const readiness = await check.json();

    expect(readiness.score).toBeGreaterThan(0);
    expect(
      readiness.issues.some(
        (issue) =>
          issue.field === "billingProviderNpi" &&
          issue.fixTarget === "claim"
      )
    ).toBeTruthy();
    expect(
      readiness.issues.some(
        (issue) =>
          issue.rule === "US_CPT_PRESENT" &&
          issue.fixTarget === "serviceLines"
      )
    ).toBeTruthy();

    await page.goto(`/claims/${claim.id}`);
    await expect(
      page.getByRole("heading", { name: "Claim Readiness for Submission" })
    ).toBeVisible();

    const billingIssue = page.getByTestId("readiness-issue-US_NPI_VALID");
    await expect(billingIssue).toContainText(/billing provider npi/i);
    await billingIssue.getByRole("button", { name: "Fix Field" }).click();

    const billingNpi = page.getByLabel("Billing Provider NPI");
    await expect(billingNpi).toBeVisible();
    await expect(billingNpi).toBeFocused();
    await expect(
      page.getByText(/field that needs attention is highlighted below/i)
    ).toBeVisible();

    await billingNpi.fill("1234567890");
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();

    await expect(
      page.getByTestId("readiness-issue-US_NPI_VALID")
    ).toHaveCount(0);
    await expect(page.getByTestId("readiness-stale")).toBeVisible();

    await page.getByRole("button", { name: "Recheck Readiness", exact: true }).click();
    const cptIssue = page.getByTestId("readiness-issue-US_CPT_PRESENT");
    await expect(cptIssue).toContainText(/CPT\/HCPCS/i);
    await cptIssue.getByRole("button", { name: "Edit Service Line" }).click();

    const cpt = page.getByLabel("CPT / HCPCS");
    await expect(cpt).toBeVisible();
    await expect(cpt).toBeFocused();
  } finally {
    await apiContext.delete(`/api/claims/${claim.id}`, { headers });
  }
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
    // A completed transmission is proven by the payer activity transaction.
    // The UI may hide or replace a completed action rather than keeping a
    // disabled "Sent to Payer" button rendered.
    await expect(page.getByTestId("payer-connection-card")).toContainText("Claim Submission");

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

      await expect(remittance.getByRole("button", { name: "Check Remittance" })).toBeDisabled();
      return;
    }

    if (expectedKey === "APEX") {
      await expect(status).toContainText("Partially Approved");
    } else {
      await expect(status).toContainText("Approved");
    }

    // Connected-payer remittance is retrieval-based, not an editable disabled form.
    await expect(remittance).toContainText("Expected payer payment");
    await expect(remittance.getByLabel("Allowed Amount")).toHaveCount(0);
    await expect(remittance.getByLabel("Paid Amount")).toHaveCount(0);
    await expect(remittance.getByLabel("Payment Reference")).toHaveCount(0);

    await expect(status.getByRole("button", { name: "Final Status" })).toBeDisabled();

    await clickStageButton(remittance, "Check Remittance");
    const remittanceDialog = page.getByRole("dialog", { name: "Remittance Received" });
    await expect(remittanceDialog).toBeVisible();
    await expect(remittanceDialog).toContainText("Payer-reported values have been posted and locked");
    await expect(remittanceDialog).toContainText("Allowed Amount");
    await expect(remittanceDialog).toContainText("Payer Paid");
    await remittanceDialog.getByRole("button", { name: "Done" }).click();

    await expect(remittance).toContainText("Posted");
    await expect(remittance).toContainText("Payer Paid");
    const remittanceDetailsButton = remittance.getByRole("button", {
      name: "View Remittance Details"
    });
    await expect(remittanceDetailsButton).toBeVisible();
    await expect(remittanceDetailsButton).toBeEnabled();
    await expect(remittance).toHaveCSS("opacity", "1");

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

    if (expectedKey === "BLUE") {
      await page.goto(`/claims/${scenario.id}`);

      const paidButton = page.getByRole("button", { name: "Paid", exact: true });
      await expect(paidButton).toBeVisible();
      await expect(paidButton).toBeDisabled();
      await expect(page.getByRole("button", { name: "Submit Claim", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Delete Claim", exact: true })).toHaveCount(0);

      const completeness = page.getByTestId("claim-completeness-card");
      await expect(completeness).toBeVisible();
      await completeness.getByRole("button", { name: "Expand", exact: true }).click();
      await expect(completeness.getByRole("button", { name: /Fix|Review codes|Edit service line/ })).toHaveCount(0);
    }

    console.log(`✓ ${expectedKey} full payer lifecycle passed`);
  });
}

test("payer Journey keeps connected payer locked and activity collapsed", async ({ page }) => {
  const scenario = scenarios.find((item) => item.key === "BLUE");
  await page.goto(`/journey?claimId=${scenario.id}`);

  const connectionCard = page.getByTestId("payer-connection-card");
  await expect(connectionCard).toBeVisible();

  if (await page.getByTestId("connected-payer").count()) {
    await expect(page.getByTestId("payer-select")).toHaveCount(0);
    await expect(connectionCard.getByRole("button", { name: "Change payer" })).toBeVisible();
  }

  const history = connectionCard.getByTestId("payer-activity-history");
  await expect(history).toHaveCount(0);

  const toggle = connectionCard.getByTestId("payer-activity-toggle");
  if (await toggle.count()) {
    await expect(toggle).toContainText(/Show activity/);
    await toggle.click();
    await expect(connectionCard.getByTestId("payer-activity-history")).toBeVisible();
    await expect(toggle).toHaveText("Hide activity");
    await toggle.click();
    await expect(connectionCard.getByTestId("payer-activity-history")).toHaveCount(0);
  }
});


test("payer switch invalidates old coverage and authorization without reusing old transactions", async ({ page }) => {
  const scenario = scenarios.find((item) => item.key === "SWITCH");
  expect(scenario).toBeTruthy();
  await page.goto(`/journey?claimId=${scenario.id}`);
  await expect(page.getByText(scenario.patientName, { exact: true })).toBeVisible();
  await selectPayer(page, payerNames.BLUE_HORIZON);
  await expect(page.getByTestId("payer-select")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change payer", exact: true })).toBeVisible();

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

  const beforeDuplicate = await apiContext.get(
    `/api/claims/${scenario.id}/journey`,
    { headers: { Authorization: `Bearer ${auth.accessToken}` } }
  );
  const beforeTransactions = (await beforeDuplicate.json()).claim.payerTransactions.length;

  await clickStageButton(eligibility, "Check Eligibility");

  const afterDuplicate = await apiContext.get(
    `/api/claims/${scenario.id}/journey`,
    { headers: { Authorization: `Bearer ${auth.accessToken}` } }
  );
  const afterTransactions = (await afterDuplicate.json()).claim.payerTransactions.length;
  expect(afterTransactions).toBe(beforeTransactions);
  const blockedAuth = await apiContext.post(
    `/api/claims/${scenario.id}/payer-simulation/prior-auth`,
    { headers: { Authorization: `Bearer ${auth.accessToken}` } }
  );
  expect(blockedAuth.status()).toBe(409);
});
