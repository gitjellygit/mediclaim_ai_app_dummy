import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

const ADVANCED_PATIENT = "E2E-US-ADVANCED-PROVIDER";
const SEARCH_PATIENT = "E2E-US-ADVANCED-SEARCH";

let apiContext;
let auth;
let seededClaimId;

async function apiJson(response, label) {
  if (!response.ok()) {
    throw new Error(`${label} failed (${response.status()}): ${await response.text()}`);
  }
  return response.json();
}

async function createClaim(data) {
  const response = await apiContext.post("/api/claims", {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data
  });
  return apiJson(response, "claim create");
}

async function cleanupTestClaims() {
  const response = await apiContext.get("/api/claims", {
    headers: { Authorization: `Bearer ${auth.accessToken}` }
  });
  if (!response.ok()) return;

  const claims = await response.json();
  const ids = (Array.isArray(claims) ? claims : [])
    .filter((claim) => claim.patientName?.startsWith("E2E-US-ADVANCED-"))
    .map((claim) => claim.id);

  for (const id of ids) {
    await apiContext.delete(`/api/claims/${id}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    });
  }
}

async function seedClaim() {
  const claim = await createClaim({
    patientName: ADVANCED_PATIENT,
    payerName: "Advanced Blue Health",
    policyNo: "ADV-POL-1001",
    memberId: "ADV-MEMBER-1001",
    medicalRecordNumber: "ADV-MRN-1001",
    planAdministratorName: "Advanced Plan Services",
    payerReferenceNo: "ADV-PAYER-REF-1001",
    claimType: "PROVIDER_BILLED",
    amount: 1234.5,
    totalBilledAmount: 1500,
    coverageLimit: 999999.99,
    remainingCoverageLimit: 998765.49
  });
  seededClaimId = claim.id;

  await createClaim({
    patientName: SEARCH_PATIENT,
    payerName: "Searchable Summit Health",
    policyNo: "ADV-POL-2002",
    memberId: "ADV-MEMBER-2002",
    medicalRecordNumber: "ADV-MRN-2002",
    claimType: "MEMBER_REIMBURSEMENT",
    amount: 987.65,
    totalBilledAmount: 1000
  });
}

async function gotoFinancialStep(page, { patientName = "E2E-US-ADVANCED-VALIDATION", payerName = "Validation Health" } = {}) {
  await page.goto("/claims/new");
  await expect(page.getByRole("heading", { name: "New Medical Claim" })).toBeVisible();

  await page.getByLabel("Claim Form").click();
  await page.getByRole("option", { name: "Professional (837P)" }).click();
  await page.getByLabel("Patient Name").fill(patientName);
  await page.getByLabel("Billing Provider NPI").fill("1234567890");
  await page.getByLabel("Rendering Provider NPI").fill("1987654321");
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Insurance Company").fill(payerName);
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByLabel("Total Claimed Amount (USD)")).toBeVisible();
  await page.getByRole("button", { name: "Add Service Line" }).click();
  await page.getByLabel("CPT / HCPCS").fill("99213");
  await page.getByLabel("Units").fill("1");
  await page.getByLabel("Charge (USD)").fill("100");
  await page.getByLabel("Place of Service").fill("11");
}

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });

  const login = await apiContext.post("/api/auth/login", {
    data: { email, password }
  });
  auth = await apiJson(login, "E2E login");

  await cleanupTestClaims();
  await seedClaim();
});

test.afterAll(async () => {
  if (apiContext && auth?.accessToken) {
    await cleanupTestClaims();
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

test("A1 - required patient and payer fields block progression", async ({ page }) => {
  await page.goto("/claims/new");

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Patient name is required", { exact: true })).toBeVisible();

  await page.getByLabel("Claim Form").click();
  await page.getByRole("option", { name: "Professional (837P)" }).click();
  await page.getByLabel("Patient Name").fill("E2E-US-ADVANCED-REQUIRED");
  await page.getByLabel("Billing Provider NPI").fill("1234567890");
  await page.getByLabel("Rendering Provider NPI").fill("1987654321");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Insurance company is required", { exact: true })).toBeVisible();
});

test("A2 - invalid ICD-10 code blocks clinical step", async ({ page }) => {
  await page.goto("/claims/new");
  await page.getByLabel("Claim Form").click();
  await page.getByRole("option", { name: "Professional (837P)" }).click();
  await page.getByLabel("Patient Name").fill("E2E-US-ADVANCED-ICD");
  await page.getByLabel("Billing Provider NPI").fill("1234567890");
  await page.getByLabel("Rendering Provider NPI").fill("1987654321");
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("ICD-10 Codes (comma separated)").fill("NOT-A-CODE");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText(/Invalid ICD-10 codes:/)).toContainText("NOT-A-CODE");
  await expect(page.getByLabel("ICD-10 Codes (comma separated)")).toBeVisible();
});

test("A3 - zero and over-billed claimed amounts are blocked", async ({ page }) => {
  await gotoFinancialStep(page);

  await page.getByLabel("Total Claimed Amount (USD)").fill("0");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Claimed amount must be greater than 0", { exact: true })).toBeVisible();

  await page.getByLabel("Total Billed Amount (USD)").fill("100");
  await page.getByLabel("Total Claimed Amount (USD)").fill("101");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Claimed amount cannot exceed billed amount", { exact: true })).toBeVisible();
});

test("A4 - review formats decimal and large U.S. dollar amounts correctly", async ({ page }) => {
  await gotoFinancialStep(page, {
    patientName: "E2E-US-ADVANCED-CURRENCY",
    payerName: "Currency Health"
  });

  await page.getByLabel("Total Billed Amount (USD)").fill("999999.99");
  await page.getByLabel("Coverage Limit (USD, optional)", { exact: true }).fill("999999.99");
  await page.getByLabel("Total Claimed Amount (USD)").fill("1234.5");
  await page.getByRole("button", { name: "Next" }).click();

  const financialSummary = page.getByText("Billed:", { exact: true }).locator("..");
  await expect(financialSummary).toContainText("$999,999.99");
  await expect(financialSummary).toContainText("$1,234.50");
  await expect(page.getByText("₹")).toHaveCount(0);
  await expect(page.getByText("INR", { exact: true })).toHaveCount(0);
});

test("A5 - backend rejects retired legacy claim type enums", async () => {
  for (const claimType of ["CASHLESS", "REIMBURSEMENT"]) {
    const response = await apiContext.post("/api/claims", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: {
        patientName: `E2E-US-ADVANCED-LEGACY-${claimType}`,
        payerName: "Legacy Enum Health",
        claimType,
        amount: 100
      }
    });

    expect(response.ok()).toBeFalsy();
    expect([400, 422]).toContain(response.status());
  }
});

test("A6 - protected claim API rejects an unauthenticated request", async () => {
  const anonymous = await request.newContext({ baseURL: backendURL });
  try {
    const response = await anonymous.get(`/api/claims/${seededClaimId}`);
    expect([401, 403]).toContain(response.status());
  } finally {
    await anonymous.dispose();
  }
});

test("A7 - direct claim URL and browser refresh preserve authenticated claim detail", async ({ page }) => {
  const directClaim = await apiContext.get(`/api/claims/${seededClaimId}`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` }
  });
  expect(directClaim.status()).toBe(200);
  const directBody = await directClaim.json();
  expect(directBody.patientName).toBe(ADVANCED_PATIENT);

  page.on("pageerror", (error) => {
    console.log("[A7 pageerror]", error?.stack || error?.message || String(error));
  });

  await page.goto(`/claims/${seededClaimId}`);

  await expect(page.getByText(ADVANCED_PATIENT, { exact: true })).toBeVisible();
  await expect(page.getByText("Provider Billed", { exact: true })).toBeVisible();
  await expect(page.getByText("Claimed Amount:", { exact: true }).locator("..")).toContainText("$1,234.50");

  await page.reload();

  await expect(page).toHaveURL(new RegExp(`/claims/${seededClaimId}$`));
  await expect(page.getByText(ADVANCED_PATIENT, { exact: true })).toBeVisible();
  await expect(page.getByText(/MRN:\s*ADV-MRN-1001/)).toBeVisible();
});

test("A8 - direct journey URL survives refresh and stays in USD", async ({ page }) => {
  await page.goto(`/journey?claimId=${seededClaimId}`);

  await expect(page.getByRole("heading", { name: "Claim Journey" })).toBeVisible();
  await expect(page.getByText("Claimed *:", { exact: true }).locator("..")).toContainText("$1,234.50");

  await page.reload();

  await expect(page.getByRole("heading", { name: "Claim Journey" })).toBeVisible();
  await expect(page.getByText("₹")).toHaveCount(0);
});

test("A9 - claims list searches supported patient, payer and amount fields", async ({ page }) => {
  await page.goto("/claims");
  const search = page.getByPlaceholder("Search claims...");

  await search.fill(SEARCH_PATIENT);
  let row = page.getByRole("row").filter({ hasText: SEARCH_PATIENT });
  await expect(row).toBeVisible();
  await expect(row).toContainText("$987.65");

  await search.fill("Searchable Summit Health");
  row = page.getByRole("row").filter({ hasText: SEARCH_PATIENT });
  await expect(row).toBeVisible();

  await search.fill("987.65");
  row = page.getByRole("row").filter({ hasText: SEARCH_PATIENT });
  await expect(row).toBeVisible();

  await search.fill("definitely-no-such-claim");
  await expect(page.getByText("No claims found", { exact: true })).toBeVisible();
});

test("A10 - unsupported document type is rejected by the AI claim upload UI", async ({ page }) => {
  await page.goto("/claims");
  await page.getByRole("button", { name: "Create Claim from Documents" }).click();

  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: "not-supported.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a supported medical document")
  });

  await expect(page.getByText("Unsupported document type", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Only PDF, PNG, JPG, and JPEG files are supported for AI claim creation.", { exact: true })
  ).toBeVisible();
});
