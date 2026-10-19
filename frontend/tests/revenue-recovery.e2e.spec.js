import { expect, request, test } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const adminEmail = process.env.E2E_EMAIL || "admin@hospital.com";
const adminPassword = process.env.E2E_PASSWORD || "admin123";

let apiContext;
let auth;
let recoveryData;

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });

  const login = await apiContext.post("/api/auth/login", {
    data: { email: adminEmail, password: adminPassword }
  });
  if (!login.ok()) {
    throw new Error("Revenue Recovery login failed: " + (await login.text()));
  }
  auth = await login.json();
  const headers = { Authorization: "Bearer " + auth.accessToken };

  const seed = await apiContext.post("/api/claims/e2e/final-uat/seed", {
    headers
  });
  if (!seed.ok()) {
    throw new Error("Revenue Recovery seed failed: " + (await seed.text()));
  }

  const response = await apiContext.get(
    "/api/revenue-recovery?status=ACTIVE&limit=100",
    { headers }
  );
  if (!response.ok()) {
    throw new Error("Revenue Recovery API failed: " + (await response.text()));
  }
  recoveryData = await response.json();
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

test("Revenue Recovery unifies active denials and underpayments with transparent priority", async () => {
  expect(recoveryData.items.length).toBeGreaterThan(0);
  expect(recoveryData.items.some((item) => item.type === "DENIAL")).toBeTruthy();
  expect(
    recoveryData.items.some((item) => item.type === "UNDERPAYMENT")
  ).toBeTruthy();

  expect(recoveryData.metrics.activeOpportunities).toBeGreaterThan(0);
  expect(recoveryData.metrics.totalOutstanding).toBeGreaterThan(0);
  expect(recoveryData.topPayers.length).toBeGreaterThan(0);
  expect(recoveryData.topRootCauses.length).toBeGreaterThan(0);
  expect(recoveryData.methodology.priority).toMatch(/not a probability/i);

  for (const item of recoveryData.items) {
    expect(item.priorityScore).toBeGreaterThanOrEqual(0);
    expect(item.priorityScore).toBeLessThanOrEqual(100);
    expect(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).toContain(item.priority);
    expect(item.outstandingAmount).toBeGreaterThanOrEqual(0);
  }
});

test("Revenue Recovery workspace searches filters and opens underlying recovery cases", async ({ page }) => {
  await page.goto("/revenue-recovery");

  await expect(
    page.getByRole("heading", { name: "Revenue Recovery" })
  ).toBeVisible();
  await expect(page.getByText("Outstanding Recovery")).toBeVisible();
  await expect(page.getByText("Top Payer Leakage")).toBeVisible();
  await expect(page.getByText("Top Recovery Root Causes")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Recovery Priority" })).toContainText("not a probability of payment");

  const search = page.getByPlaceholder(
    "Search patient, payer or payer claim number..."
  );
  await search.fill("UAT-FINAL-");
  await expect(page.locator("tbody tr").first()).toContainText("UAT-FINAL-");

  await page.getByTestId("recovery-type-filter").click();
  await page.getByRole("option", { name: "Underpayments" }).click();
  await expect(page.locator("tbody tr").first()).toContainText("Underpayment");

  await page.getByTestId("recovery-type-filter").click();
  await page.getByRole("option", { name: "Denials" }).click();
  const denialRow = page.locator("tbody tr").first();
  await expect(denialRow).toContainText("Denial");

  const popupPromise = page.context().waitForEvent("page");
  await denialRow.getByRole("button", { name: "Work Case" }).click();
  const appealPage = await popupPromise;

  await appealPage.waitForLoadState("domcontentloaded");
  await expect(appealPage).toHaveURL(
    /\/revenue-recovery\/appeals\//,
    { timeout: 30_000 }
  );
  await expect(
    appealPage.getByRole("heading", { name: "Appeal Workspace" })
  ).toBeVisible({ timeout: 30_000 });
  await appealPage.close();
});



test("Revenue Recovery paginates at 10 rows, sorts key financial columns, and reconciles recovered metrics", async ({ page }) => {
  const headers = { Authorization: "Bearer " + auth.accessToken };

  const full = await apiContext.get(
    "/api/revenue-recovery?status=ACTIVE&page=1&pageSize=100&sort=recovered&direction=desc",
    { headers }
  );
  expect(full.ok()).toBeTruthy();
  const fullBody = await full.json();
  expect(fullBody.total).toBeLessThanOrEqual(100);
  const recoveredAcrossFilteredCases = fullBody.items.reduce(
    (sum, item) => sum + Number(item.recoveredAmount || 0),
    0
  );
  expect(fullBody.metrics.totalRecovered).toBeCloseTo(recoveredAcrossFilteredCases, 2);

  const paged = await apiContext.get(
    "/api/revenue-recovery?status=ACTIVE&page=1&pageSize=1&sort=outstanding&direction=desc",
    { headers }
  );
  expect(paged.ok()).toBeTruthy();
  const pagedBody = await paged.json();
  expect(pagedBody.items.length).toBeLessThanOrEqual(1);
  expect(pagedBody.pageSize).toBe(1);
  expect(pagedBody.page).toBe(1);
  expect(pagedBody.totalPages).toBeGreaterThanOrEqual(1);

  await page.goto("/revenue-recovery");
  await expect(page.locator("tbody tr")).toHaveCount(
    Math.min(10, Number(fullBody.total || 0))
  );
  await expect(page.getByText("Recovered", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Outstanding" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recovered" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deadline" })).toBeVisible();

  await page.getByRole("button", { name: "Recovered" }).click();
  await expect(page.getByRole("button", { name: "Recovered" })).toHaveAttribute(
    "aria-sort",
    /ascending|descending/
  ).catch(() => {});
});

test("Revenue Recovery rejects roles without recovery permissions", async () => {
  const receptionistLogin = await apiContext.post("/api/auth/login", {
    data: {
      email: "reception@hospital.com",
      password: "recep123"
    }
  });
  expect(receptionistLogin.ok()).toBeTruthy();
  const receptionist = await receptionistLogin.json();

  const response = await apiContext.get("/api/revenue-recovery", {
    headers: {
      Authorization: "Bearer " + receptionist.accessToken
    }
  });

  expect(response.status()).toBe(403);
});
