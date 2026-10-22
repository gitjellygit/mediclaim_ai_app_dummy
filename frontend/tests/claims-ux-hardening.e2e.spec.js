import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

let api;
let auth;
let fixture;

async function json(response, label) {
  if (!response.ok()) {
    throw new Error(`${label} failed (${response.status()}): ${await response.text()}`);
  }
  return response.json();
}

function headers() {
  return { Authorization: `Bearer ${auth.accessToken}` };
}

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: backendURL });
  auth = await json(
    await api.post("/api/auth/login", {
      data: { email, password }
    }),
    "login"
  );

  fixture = await json(
    await api.post("/api/claims/e2e/claims-ux/seed", {
      headers: headers()
    }),
    "seed claims UX"
  );
});

test.afterAll(async () => {
  if (api && auth?.accessToken) {
    await api.delete("/api/claims/e2e/claims-ux/cleanup", {
      headers: headers()
    });
  }
  await api?.dispose();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ accessToken, refreshToken, user }) => {
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken || "");
      localStorage.setItem("user", JSON.stringify(user));
    },
    auth
  );
});

test("Claims UX - list API supports server pagination and exact Claim ID search", async () => {
  const pageOne = await json(
    await api.get(
      `/api/claims?paginated=1&page=1&pageSize=10&q=${encodeURIComponent(fixture.prefix)}&sort=createdAt&direction=desc`,
      { headers: headers() }
    ),
    "page one"
  );

  expect(pageOne.total).toBe(32);
  expect(pageOne.items).toHaveLength(10);
  expect(pageOne.page).toBe(1);
  expect(pageOne.pageSize).toBe(10);

  const byId = await json(
    await api.get(
      `/api/claims?paginated=1&page=1&pageSize=25&q=${encodeURIComponent(fixture.firstClaimId)}`,
      { headers: headers() }
    ),
    "claim ID search"
  );

  expect(byId.total).toBe(1);
  expect(byId.items).toHaveLength(1);
  expect(byId.items[0].id).toBe(fixture.firstClaimId);
});

test("Claims UX - list shows real pagination and rows-per-page controls", async ({ page }) => {
  await page.goto("/claims");

  const search = page.getByPlaceholder(
    "Search by Claim ID, patient, payer, member ID, policy number, or amount..."
  );
  await expect(search).toBeVisible();
  await search.fill(fixture.prefix);

  await expect(page.getByText("1–10 of 32")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(10);

  await page.getByLabel("Go to next page").click();
  await expect(page.getByText("11–20 of 32")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(10);

  await expect(page.getByText(/Rows per page/i)).toBeVisible();
});

test("Claims UX - Claim ID is visible, copyable, and searchable from the main list", async ({ page }) => {
  await page.goto("/claims");

  const search = page.getByPlaceholder(
    "Search by Claim ID, patient, payer, member ID, policy number, or amount..."
  );
  await search.fill(fixture.firstClaimId);

  const row = page.locator("tbody tr").filter({ hasText: "E2E-CLAIMS-UX-001" });
  await expect(row).toBeVisible();
  await expect(row).toContainText(fixture.firstClaimId);
  await expect(
    row.getByRole("button", { name: `Copy Claim ID ${fixture.firstClaimId}` })
  ).toBeVisible();
});

test("Claims UX - sortable columns visibly advertise sorting", async ({ page }) => {
  await page.goto("/claims");
  await page.getByPlaceholder(
    "Search by Claim ID, patient, payer, member ID, policy number, or amount..."
  ).fill(fixture.prefix);

  const sortIcons = page.locator(".MuiTableSortLabel-icon");
  await expect(sortIcons).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) {
    await expect(sortIcons.nth(index)).toBeVisible();
  }

  const patientSort = page.getByRole("button", { name: /Patient Name/i });
  await patientSort.click();
  const patientHeader = patientSort.locator("xpath=ancestor::th");
  await expect(patientHeader).toHaveAttribute("aria-sort", /ascending|descending/);
});

test("Claims UX - PAID claim documents are historical read-only records", async ({ page }) => {
  await page.goto(`/claims/${fixture.paidClaimId}`);

  await expect(page.getByTestId("documents-read-only")).toBeVisible();
  await expect(page.getByTestId("documents-read-only")).toContainText(
    /Supporting claim documents are read-only/i
  );

  await expect(page.getByRole("button", { name: "Upload Document" })).toHaveCount(0);
  await expect(page.getByLabel("Document Type")).toHaveCount(0);
  await expect(page.getByText("paid-claim-eob.pdf")).toBeVisible();

  const documentsCard = page.getByText(/Documents \(1\)/).locator("..").locator("..");
  await expect(documentsCard.getByText("Use AI Type")).toHaveCount(0);
  await expect(documentsCard.locator('input[type="checkbox"]')).toHaveCount(0);
});
