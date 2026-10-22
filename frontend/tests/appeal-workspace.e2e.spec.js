import { expect, request, test } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

let apiContext;
let auth;
let denial;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });

  const login = await apiContext.post("/api/auth/login", {
    data: { email, password }
  });
  expect(login.ok()).toBeTruthy();
  auth = await login.json();
  const headers = { Authorization: "Bearer " + auth.accessToken };

  const seed = await apiContext.post("/api/claims/e2e/final-uat/seed", {
    headers
  });
  expect(seed.ok()).toBeTruthy();

  const recovery = await apiContext.get(
    "/api/revenue-recovery?type=DENIAL&status=ACTIVE&limit=100",
    { headers }
  );
  expect(recovery.ok()).toBeTruthy();
  const body = await recovery.json();
  denial = body.items.find((item) => item.type === "DENIAL");
  expect(denial).toBeTruthy();
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

test("Appeal Workspace uses a new tab and syncs submitted status back to Revenue Recovery", async ({ page, context }) => {
  await page.goto("/revenue-recovery");

  const search = page.getByPlaceholder(
    "Search patient, payer or payer claim number..."
  );
  await search.fill(denial.patientName);

  const row = page.getByRole("row").filter({ hasText: denial.patientName });
  await expect(row).toBeVisible();

  const popupPromise = context.waitForEvent("page");
  await row.getByTestId("recovery-next-action").click();
  const appealPage = await popupPromise;

  await appealPage.waitForLoadState("domcontentloaded");
  await expect(appealPage).toHaveURL(
    new RegExp("/revenue-recovery/appeals/" + denial.id)
  );
  await expect(
    appealPage.getByRole("heading", { name: "Appeal Workspace" })
  ).toBeVisible();

  await expect(
    appealPage.getByText(/Appeal Eligible:/)
  ).toBeVisible();
  await expect(
    appealPage.getByText(/Correctable:/)
  ).toBeVisible();

  const appealEligibleSelects = appealPage.getByRole("combobox", {
    name: "Appeal Eligible"
  });
  await expect(appealEligibleSelects).toHaveCount(0);

  const runAnalysis = appealPage.getByRole("button", {
    name: /Analyze Denial|Re-run analysis/
  });
  await runAnalysis.click();

  const analysisProgress = appealPage.getByRole("dialog", {
    name: /Running Recovery Analysis|Re-running Recovery Analysis/
  });
  await expect(analysisProgress).toBeVisible();
  await expect(
    appealPage.getByRole("dialog", { name: "Recovery Analysis Complete" })
  ).toBeVisible();
  await expect(
    appealPage.getByRole("dialog", { name: "Recovery Analysis Complete" })
  ).toBeHidden();

  await appealPage.getByRole("button", { name: "View analysis details" }).click();
  await expect(
    appealPage.getByText("Recovery Rules", { exact: true })
  ).toBeVisible();

  const eligibilityRecheck = appealPage.getByRole("button", {
    name: "Re-check Eligibility"
  });
  if (await eligibilityRecheck.count()) {
    await eligibilityRecheck.click();
    await expect(
      appealPage.getByTestId("eligibility-reconciliation")
    ).toContainText(/read-only and does not resubmit or alter the claim/i);
  }

  const rationale = appealPage.getByPlaceholder(
    /Explain the factual basis for the appeal/i
  );
  await rationale.fill("Too short");
  await expect(
    appealPage.getByTestId("appeal-step-3")
  ).toContainText("Build Appeal Package");
  await expect(
    appealPage.getByRole("button", { name: "Save Rationale" })
  ).toBeDisabled();

  await rationale.fill(
    "The appeal is supported by the payer denial facts and the claim record. Please reconsider the denied claim based on the documented eligibility, authorization, coding, and billing information available in the record."
  );

  await appealPage.getByRole("button", { name: "Save Rationale" }).click();
  await expect(
    appealPage.getByTestId("appeal-step-3")
  ).toContainText("Complete");

  await appealPage.getByRole("button", { name: "Review Package", exact: true }).first().click();
  const packagePreview = appealPage.getByRole("dialog", {
    name: "Appeal Package Preview"
  });
  await expect(packagePreview).toBeVisible();
  await packagePreview.getByRole("button", { name: "Close" }).click();

  await appealPage.getByRole("button", { name: "Approve Package" }).click();
  await appealPage.getByRole("button", { name: "Prepare Appeal" }).last().click();

  await expect(
    appealPage.getByTestId("appeal-step-4")
  ).toContainText("Complete");

  await rationale.fill(
    "The appeal is supported by the payer denial facts and the claim record. This revised rationale changes the prepared package and therefore requires a new preparation step before submission."
  );
  const saveRevisedRationale = appealPage.getByRole("button", { name: "Save Rationale" });
  await expect(saveRevisedRationale).toBeEnabled();
  await saveRevisedRationale.click();
  await expect(appealPage.getByTestId("appeal-package-changed")).toContainText(
    /package changed after review/i
  );
  await expect(
    appealPage.getByRole("button", { name: "Re-approve Package" })
  ).toBeVisible();

  await appealPage.getByRole("button", { name: "Re-approve Package" }).click();
  await appealPage.getByRole("button", { name: "Prepare Appeal" }).last().click();
  await expect(
    appealPage.getByTestId("appeal-step-4")
  ).toContainText("Complete");

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const futureSubmission = await apiContext.post(
    "/api/denials/" + denial.id + "/appeal-submit",
    {
      headers: { Authorization: "Bearer " + auth.accessToken },
      data: {
        confirmed: true,
        submissionChannel: "FAX",
        submissionDate: tomorrow
      }
    }
  );
  expect(futureSubmission.status()).toBe(400);
  expect(await futureSubmission.json()).toMatchObject({
    error: "Submission date cannot be in the future"
  });

  await appealPage.getByRole("button", {
    name: "Record External Submission"
  }).click();

  const submissionDialog = appealPage.getByRole("dialog", {
    name: "Record External Submission"
  });
  await expect(submissionDialog).toBeVisible();
  await expect(submissionDialog.getByText("Payer Portal", { exact: true })).toBeVisible();
  await submissionDialog
    .getByRole("textbox", { name: "Submission / Tracking Reference" })
    .fill("E2E-APPEAL-123");
  await appealPage.getByRole("button", {
    name: "Continue to Confirmation"
  }).click();

  await appealPage.getByRole("button", {
    name: "Yes, Record Submission"
  }).click();

  await expect(
    appealPage.getByText(/No external payer transmission was performed/i)
  ).toBeVisible();

  await appealPage.close();
  await page.bringToFront();

  const refreshedRow = page.getByRole("row").filter({
    hasText: denial.patientName
  });
  await expect(refreshedRow).toContainText("APPEAL SUBMITTED", {
    timeout: 30_000
  });
});

test("Appeal Workspace assessment override requires an explicit reason and is auditable", async () => {
  const headers = { Authorization: "Bearer " + auth.accessToken };

  const rejected = await apiContext.post(
    "/api/denials/" + denial.id + "/assessment-override",
    {
      headers,
      data: { appealEligible: false, reason: "short" }
    }
  );
  expect(rejected.status()).toBe(400);

  const accepted = await apiContext.post(
    "/api/denials/" + denial.id + "/assessment-override",
    {
      headers,
      data: {
        appealEligible: false,
        reason:
          "Payer documentation confirms the applicable appeal route is unavailable for this test case."
      }
    }
  );
  expect(accepted.ok()).toBeTruthy();

  const workspace = await apiContext.get(
    "/api/denials/" + denial.id + "/appeal-workspace",
    { headers }
  );
  expect(workspace.ok()).toBeTruthy();
  const body = await workspace.json();

  expect(body.appealEligible).toBe(false);
  expect(body.assessmentOverrideReason).toMatch(/Payer documentation confirms/);
  expect(body.assessmentOverriddenAt).toBeTruthy();
});
