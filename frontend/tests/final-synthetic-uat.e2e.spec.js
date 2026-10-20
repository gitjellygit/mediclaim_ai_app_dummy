
import { expect, request, test } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

let apiContext;
let auth;
let seeded;

function scenario(index) {
  const item = seeded.scenarios.find((entry) => entry.index === index);
  if (!item) throw new Error("Missing Final UAT scenario " + index);
  return item;
}

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });

  const login = await apiContext.post("/api/auth/login", {
    data: { email, password }
  });
  if (!login.ok()) {
    throw new Error("Final UAT login failed: " + (await login.text()));
  }
  auth = await login.json();
  const headers = { Authorization: "Bearer " + auth.accessToken };

  const reset = await apiContext.delete("/api/claims/e2e/final-uat/reset", {
    headers
  });
  if (!reset.ok()) {
    throw new Error("Final UAT local reset failed: " + (await reset.text()));
  }

  const resetBody = await reset.json();
  expect(resetBody.scope).toBe("LOCAL_TEST_ORGANIZATION");
  expect(resetBody.preserved).toEqual(
    expect.arrayContaining(["users", "organization", "rules"])
  );

  const seed = await apiContext.post("/api/claims/e2e/final-uat/seed", {
    headers
  });
  if (!seed.ok()) {
    throw new Error("Final UAT seed failed: " + (await seed.text()));
  }
  seeded = await seed.json();

  expect(seeded.synthetic).toBe(true);
  expect(seeded.prefix).toBe("UAT-FINAL-");
  expect(seeded.count).toBe(100);
});

test.afterAll(async () => {
  // Intentionally keep the 100 UAT-FINAL claims in the local database so they
  // can be inspected manually after the visible run.
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

test("Final UAT seeds 100 realistic synthetic patients with stable demographics", async () => {
  expect(seeded.categories).toHaveLength(10);
  for (const category of seeded.categories) {
    expect(category.count).toBe(10);
  }

  const headers = { Authorization: "Bearer " + auth.accessToken };
  const names = new Set();

  for (const item of seeded.scenarios) {
    expect(item.patientName).toMatch(
      /^UAT-FINAL-\d{3} [A-Za-z]+ [A-Za-z]+$/
    );
    names.add(item.patientName);

    const response = await apiContext.get("/api/claims/" + item.id, {
      headers
    });
    expect(response.ok()).toBeTruthy();
    const claim = await response.json();

    expect(claim.patientName).toBe(item.patientName);
    expect(claim.patientDob).toBeTruthy();
    expect(Number.isInteger(claim.patientAge)).toBeTruthy();
    expect(claim.patientAge).toBeGreaterThanOrEqual(18);
    expect(claim.patientAge).toBeLessThan(100);
    expect(claim.payerName).toBeTruthy();
    expect(claim.claimForm).toMatch(/PROFESSIONAL|INSTITUTIONAL/);
  }

  expect(names.size).toBe(100);
});

test("Final UAT contains the intended lifecycle and human-error scenario families", async () => {
  const categories = new Set(seeded.scenarios.map((item) => item.category));
  expect(categories).toEqual(
    new Set([
      "CLEAN_READY",
      "MISSING_DATA",
      "ELIGIBILITY",
      "PRIOR_AUTH",
      "TIMELY_FILING",
      "SUBMITTED_STATUS",
      "DENIAL_REJECTION",
      "PAYMENT_REMITTANCE",
      "DOCUMENT_CODING",
      "EDGE_SEARCH_FILTER"
    ])
  );

  expect(
    seeded.scenarios.some(
      (item) => item.expected.persistedStatus === "DENIED"
    )
  ).toBeTruthy();
  expect(
    seeded.scenarios.some(
      (item) => item.expected.persistedStatus === "PAID"
    )
  ).toBeTruthy();
  expect(
    seeded.scenarios.some(
      (item) => item.expected.payerStatus === "REJECTED"
    )
  ).toBeTruthy();
  expect(
    seeded.scenarios.some(
      (item) => item.expected.payerStatus === "PARTIALLY_APPROVED"
    )
  ).toBeTruthy();
});

test("Claims list can search and sort the fresh 100-claim dataset", async ({ page }) => {
  await page.goto("/claims");
  await expect(page.getByRole("heading", { name: /Claims/ })).toBeVisible();

  const search = page.getByPlaceholder("Search by Claim ID, patient, payer, member ID, policy number, or amount...");
  await search.fill("UAT-FINAL-001");
  await expect(page.getByText(scenario(1).patientName, { exact: true })).toBeVisible();

  await search.fill("");
  await page.getByRole("button", { name: /Patient Name/i }).click();

  const rows = page.locator("tbody tr");
  await expect(rows.first()).toContainText(/UAT-FINAL-/);
});

test("Claim Work Queue searches filters and sorts across the Final UAT dataset", async ({ page }) => {
  await page.goto("/approval");
  await expect(
    page.getByRole("heading", { name: "Claim Work Queue" })
  ).toBeVisible();

  const search = page.getByPlaceholder(
    "Search patient, payer, member, policy, claim or authorization..."
  );
  await search.fill("UAT-FINAL-");
  await expect(page.locator("tbody tr").first()).toContainText("UAT-FINAL-");

  await page.getByRole("button", { name: /Pre-Submit Risk/i }).click();
  await expect(page.locator("tbody tr").first()).toContainText("UAT-FINAL-");

  const filters = page.getByTestId("claim-work-queue-filters");
  await filters.click();
  await page.getByRole("menuitem", { name: "Ready to submit" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("tbody tr").first()).toContainText("UAT-FINAL-");

  await filters.click();
  await page.getByRole("menuitem", { name: "All work" }).click();
  await page.keyboard.press("Escape");

  await filters.click();
  await page.getByRole("menuitem", { name: "Paid" }).click();
  await page.keyboard.press("Escape");

  await expect(page.locator("tbody tr").first()).toContainText("PAID");
});

test("representative ready missing submitted rejected denied and paid claims open correctly", async ({ page }) => {
  const representatives = [
    scenario(1),
    scenario(11),
    scenario(51),
    seeded.scenarios.find((item) => item.expected.payerStatus === "REJECTED"),
    seeded.scenarios.find((item) => item.expected.persistedStatus === "DENIED"),
    seeded.scenarios.find((item) => item.expected.persistedStatus === "PAID")
  ].filter(Boolean);

  for (const item of representatives) {
    await page.goto("/claims/" + item.id);
    await expect(page.getByText(item.patientName, { exact: true }).first()).toBeVisible();
  }
});

test("paid claims stay finalized while denied claims remain recovery-oriented in the Work Queue", async ({ page }) => {
  const paid = seeded.scenarios.find(
    (item) => item.expected.persistedStatus === "PAID"
  );
  const denied = seeded.scenarios.find(
    (item) => item.expected.persistedStatus === "DENIED"
  );
  expect(paid).toBeTruthy();
  expect(denied).toBeTruthy();

  await page.goto("/approval");
  const search = page.getByPlaceholder(
    "Search patient, payer, member, policy, claim or authorization..."
  );

  await search.fill(paid.patientName);
  let row = page.getByRole("row").filter({ hasText: paid.patientName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Finalized");
  await expect(row).toContainText("Pre-submit only");
  await expect(row).toContainText("Paid");

  await search.fill(denied.patientName);
  row = page.getByRole("row").filter({ hasText: denied.patientName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Revenue at risk");
  await expect(row).toContainText("Review Denial");
});
