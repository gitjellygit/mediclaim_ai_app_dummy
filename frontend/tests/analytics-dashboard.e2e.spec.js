import { expect, request, test } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const adminEmail = process.env.E2E_EMAIL || "admin@hospital.com";
const adminPassword = process.env.E2E_PASSWORD || "admin123";

let apiContext;
let auth;
let analytics;

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });

  const login = await apiContext.post("/api/auth/login", {
    data: { email: adminEmail, password: adminPassword }
  });
  if (!login.ok()) {
    throw new Error("Analytics login failed: " + (await login.text()));
  }
  auth = await login.json();
  const headers = { Authorization: "Bearer " + auth.accessToken };

  const seed = await apiContext.post("/api/claims/e2e/final-uat/seed", { headers });
  if (!seed.ok()) {
    throw new Error("Analytics seed failed: " + (await seed.text()));
  }

  const response = await apiContext.get("/api/analytics?range=ALL", { headers });
  if (!response.ok()) {
    throw new Error("Analytics API failed: " + (await response.text()));
  }
  analytics = await response.json();
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

test("Analytics API returns reconciled dashboard sections", async () => {
  expect(analytics.kpis.totalClaims).toBeGreaterThan(0);
  expect(analytics.kpis.totalBilled).toBeGreaterThanOrEqual(0);
  expect(analytics.kpis.totalPaid).toBeGreaterThanOrEqual(0);
  expect(analytics.kpis.outstanding).toBeGreaterThanOrEqual(0);
  expect(analytics.kpis.denialRate).toBeGreaterThanOrEqual(0);
  expect(analytics.kpis.denialRate).toBeLessThanOrEqual(100);
  expect(analytics.funnel.length).toBe(5);
  expect(analytics.aging.length).toBe(4);
  expect(Array.isArray(analytics.payerPerformance)).toBeTruthy();
  expect(Array.isArray(analytics.denialCauses)).toBeTruthy();
  expect(Array.isArray(analytics.trend)).toBeTruthy();
  expect(analytics.methodology.denialRate).toMatch(/adjudicated claims/i);
});

test("Analytics dashboard renders operational KPIs and filters", async ({ page }) => {
  await page.goto("/analytics");

  await expect(
    page.getByRole("heading", { name: "Analytics & Operations" })
  ).toBeVisible();

  await expect(page.getByTestId("analytics-total-billed")).toBeVisible();
  await expect(page.getByTestId("analytics-paid")).toBeVisible();
  await expect(page.getByTestId("analytics-outstanding")).toBeVisible();
  await expect(page.getByTestId("analytics-recovered")).toBeVisible();
  await expect(page.getByTestId("analytics-denial-rate")).toBeVisible();
  await expect(page.getByText("Claim Funnel")).toBeVisible();
  await expect(page.getByTestId("analytics-disposition-donut")).toBeVisible();
  await expect(page.getByTestId("analytics-aging-columns")).toBeVisible();
  // Use the heading role so helper/methodology text containing "A/R Aging" does not violate Playwright strict mode.
  await expect(page.getByRole("heading", { name: "A/R Aging" })).toBeVisible();
  await expect(page.getByText("Top Denial Causes")).toBeVisible();
  await expect(page.getByText("Payer Performance")).toBeVisible();

  await page.getByTestId("analytics-range").click();
  await page.getByRole("option", { name: "Last 90 days" }).click();
  await expect(page.getByTestId("analytics-range")).toContainText("Last 90 days");
});

test("Analytics rejects a user without financial view permission", async () => {
  const login = await apiContext.post("/api/auth/login", {
    data: { email: "reception@hospital.com", password: "recep123" }
  });
  expect(login.ok()).toBeTruthy();
  const user = await login.json();

  const response = await apiContext.get("/api/analytics", {
    headers: { Authorization: "Bearer " + user.accessToken }
  });
  expect(response.status()).toBe(403);
});
