import { expect, request, test } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

let apiContext;
let auth;
let scenarios = [];

function scenario(key) {
  const item = scenarios.find((entry) => entry.key === key);
  if (!item) throw new Error(`Missing Claim Work Queue scenario ${key}`);
  return item;
}

async function openQueue(page) {
  await page.goto("/approval");
  await expect(page.getByRole("heading", { name: "Claim Work Queue" })).toBeVisible();
  const search = page.getByPlaceholder(
    "Search patient, payer, member, policy, claim or authorization..."
  );
  await search.fill("UAT-APPROVAL-");
  await expect(page.getByRole("row").filter({ hasText: scenario("01-READY").patientName })).toBeVisible();
}

function queueRow(page, key) {
  return page.getByRole("row").filter({ hasText: scenario(key).patientName });
}

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });

  const login = await apiContext.post("/api/auth/login", {
    data: { email, password }
  });
  if (!login.ok()) throw new Error(`Claim Work Queue login failed: ${await login.text()}`);
  auth = await login.json();

  const seed = await apiContext.post("/api/claims/e2e/approval-intelligence/seed", {
    headers: { Authorization: `Bearer ${auth.accessToken}` }
  });
  if (!seed.ok()) throw new Error(`Claim Work Queue seed failed: ${await seed.text()}`);
  const seeded = await seed.json();
  scenarios = seeded.scenarios;
  expect(scenarios).toHaveLength(15);
});

test.afterAll(async () => {
  if (apiContext && auth?.accessToken) {
    await apiContext.delete("/api/claims/e2e/approval-intelligence/cleanup", {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    });
  }
  await apiContext?.dispose();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ accessToken, user }) => {
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("user", JSON.stringify(user));
    },
    auth
  );
});

test("Claim Work Queue renders the renamed work queue and compact smart filters", async ({ page }) => {
  await openQueue(page);

  const filters = page.getByTestId("claim-work-queue-filters");
  await expect(filters).toBeVisible();
  await filters.click();
  await page.getByRole("menuitem", { name: "Prior authorization issues" }).click();
  await page.keyboard.press("Escape");

  await expect(queueRow(page, "04-AUTH-REQUIRED")).toBeVisible();
  await expect(queueRow(page, "05-AUTH-DENIED")).toBeVisible();
  await expect(queueRow(page, "06-AUTH-EXPIRED")).toBeVisible();
  await expect(queueRow(page, "01-READY")).toHaveCount(0);

  await filters.click();
  await page.getByRole("menuitem", { name: "All work" }).click();
  await page.keyboard.press("Escape");

  await filters.click();
  await page.getByRole("menuitem", { name: "Due within 7 days" }).click();
  await page.keyboard.press("Escape");

  await expect(queueRow(page, "08-FILING-URGENT")).toBeVisible();
  await expect(queueRow(page, "09-FILING-SOON")).toHaveCount(0);
});

test("Review & Submit opens Submission Readiness and highlights Submit Claim", async ({ page }) => {
  await openQueue(page);
  await queueRow(page, "01-READY").getByRole("button", { name: "Review & Submit" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/claims/${scenario("01-READY").id}\\?section=readiness&focus=submit-claim-action`)
  );
  await expect(page.getByTestId("submission-readiness-card")).toBeVisible();
  const submit = page.getByTestId("submit-claim-action");
  await expect(submit).toBeVisible();
  await expect(submit).toHaveCSS("outline-style", "solid");

  await page.getByTestId("submission-readiness-card").click({ position: { x: 12, y: 12 } });
  await expect(page).not.toHaveURL(/focus=submit-claim-action/);
  await expect(submit).not.toHaveCSS("outline-style", "solid");
});

test("Check Eligibility opens the exact Journey stage and highlights the eligibility action", async ({ page }) => {
  await openQueue(page);
  await queueRow(page, "02-ELIG-REVIEW").getByRole("button", { name: "Check Eligibility" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/journey\\?claimId=${scenario("02-ELIG-REVIEW").id}&stage=eligibility&focus=eligibility-action`)
  );
  await expect(page.getByTestId("journey-stage-eligibility")).toBeVisible();
  const action = page.getByTestId("eligibility-action");
  await expect(action).toBeVisible();
  await expect(action).toHaveCSS("outline-style", "solid");

  await page.getByTestId("journey-stage-eligibility").click({ position: { x: 12, y: 12 } });
  await expect(page).not.toHaveURL(/focus=eligibility-action/);
  await expect(action).not.toHaveCSS("outline-style", "solid");
});

test("Review Prior Auth opens the exact Journey stage and highlights the prior-auth action", async ({ page }) => {
  await openQueue(page);
  await queueRow(page, "04-AUTH-REQUIRED").getByRole("button", { name: "Review Prior Auth" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/journey\\?claimId=${scenario("04-AUTH-REQUIRED").id}&stage=prior-auth&focus=prior-auth-action`)
  );
  await expect(page.getByTestId("journey-stage-prior-auth")).toBeVisible();
  const action = page.getByTestId("prior-auth-action");
  await expect(action).toBeVisible();
  await expect(action).toHaveCSS("outline-style", "solid");

  await page.getByTestId("journey-stage-prior-auth").click({ position: { x: 12, y: 12 } });
  await expect(page).not.toHaveURL(/focus=prior-auth-action/);
  await expect(action).not.toHaveCSS("outline-style", "solid");
});

test("Refresh Readiness opens Submission Readiness and highlights the readiness control", async ({ page }) => {
  await openQueue(page);
  await queueRow(page, "10-STALE").getByRole("button", { name: "Refresh Readiness" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/claims/${scenario("10-STALE").id}\\?section=readiness&focus=readiness-action`)
  );
  const action = page.getByTestId("readiness-action");
  await expect(action).toBeVisible();
  await expect(action).toHaveCSS("outline-style", "solid");

  await page.getByTestId("submission-readiness-card").click({ position: { x: 12, y: 12 } });
  await expect(page).not.toHaveURL(/focus=readiness-action/);
  await expect(action).not.toHaveCSS("outline-style", "solid");
});

test("Resolve Issue opens edit mode on the exact blocking Billing Provider NPI field", async ({ page }) => {
  await openQueue(page);
  await queueRow(page, "11-BLOCKED").getByRole("button", { name: "Resolve Issue" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/claims/${scenario("11-BLOCKED").id}\\?edit=1&focus=billingProviderNpi`)
  );
  const field = page.locator('[data-fix-field="billingProviderNpi"]');
  await expect(field).toBeVisible();
  await expect(field.locator("input")).toBeFocused();

  await field.click();
  await expect(page).not.toHaveURL(/focus=billingProviderNpi/);
});

test("Resolve Filing Risk opens edit mode on the Timely Filing Deadline field", async ({ page }) => {
  await openQueue(page);
  await queueRow(page, "07-FILING-EXPIRED").getByRole("button", { name: "Resolve Filing Risk" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/claims/${scenario("07-FILING-EXPIRED").id}\\?edit=1&focus=timelyFilingDeadline`)
  );
  const field = page.locator('[data-fix-field="timelyFilingDeadline"]');
  await expect(field).toBeVisible();
  await expect(field.locator("input")).toBeFocused();

  await field.click();
  await expect(page).not.toHaveURL(/focus=timelyFilingDeadline/);
});

test("Track Claim opens Claim Status and highlights the status action", async ({ page }) => {
  await openQueue(page);
  await queueRow(page, "13-SUBMITTED").getByRole("button", { name: "Track Claim" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/journey\\?claimId=${scenario("13-SUBMITTED").id}&stage=claim-status&focus=status-action`)
  );
  const stage = page.getByTestId("journey-stage-claim-status");
  const action = page.getByTestId("status-action");
  await expect(stage).toBeVisible();
  await expect(action).toBeVisible();

  await stage.click({ position: { x: 12, y: 12 } });
  await expect(page).not.toHaveURL(/focus=status-action/);
});

test("Review Denial opens the denied claim status context", async ({ page }) => {
  await openQueue(page);
  await queueRow(page, "14-DENIED").getByRole("button", { name: "Review Denial" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/journey\\?claimId=${scenario("14-DENIED").id}&stage=claim-status&focus=status-action`)
  );
  await expect(page.getByTestId("journey-stage-claim-status")).toBeVisible();
});

test("View Remittance opens Remittance and highlights the remittance action", async ({ page }) => {
  await openQueue(page);
  await queueRow(page, "15-PAID").getByRole("button", { name: "View Remittance" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/journey\\?claimId=${scenario("15-PAID").id}&stage=remittance&focus=remittance-action`)
  );
  const stage = page.getByTestId("journey-stage-remittance");
  const action = page.getByTestId("remittance-action");
  await expect(stage).toBeVisible();
  await expect(action).toBeVisible();

  await stage.click({ position: { x: 12, y: 12 } });
  await expect(page).not.toHaveURL(/focus=remittance-action/);
});

test("View Claim remains available as the secondary action", async ({ page }) => {
  await openQueue(page);
  await queueRow(page, "01-READY").getByRole("button", { name: "View Claim" }).click();

  await expect(page).toHaveURL(new RegExp(`/claims/${scenario("01-READY").id}$`));
});
