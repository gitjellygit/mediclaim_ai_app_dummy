import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";
const PATIENT = "E2E-U3-US-DATA-MODEL";

let apiContext;
let auth;
let claimId;

async function apiJson(response, label) {
  if (!response.ok()) {
    throw new Error(`${label} failed (${response.status()}): ${await response.text()}`);
  }
  return response.json();
}

async function findClaim() {
  const response = await apiContext.get(
    `/api/claims/search?q=${encodeURIComponent(PATIENT)}&limit=10`,
    { headers: { Authorization: `Bearer ${auth.accessToken}` } }
  );
  const body = await apiJson(response, "claim search");
  return body.items.find((item) => item.patientName === PATIENT) || null;
}

async function getClaim(id) {
  const response = await apiContext.get(`/api/claims/${id}`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` }
  });
  return apiJson(response, "claim get");
}

async function cleanup() {
  const existing = await findClaim();
  if (!existing) return;
  await apiContext.delete(`/api/claims/${existing.id}`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` }
  });
}

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });
  const login = await apiContext.post("/api/auth/login", {
    data: { email, password }
  });
  auth = await apiJson(login, "E2E login");
  await cleanup();
});

test.afterAll(async () => {
  if (apiContext && auth?.accessToken) await cleanup();
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

test("U3-1 - create US claim with provider coverage institutional and service-line data", async ({ page }) => {
  await page.goto("/claims/new");

  await page.getByLabel("Claim Form").click();
  await page.getByRole("option", { name: "Institutional (837I)" }).click();
  await page.getByLabel("Patient Name").fill(PATIENT);
  await page.getByLabel("Hospital Name").fill("Seattle General Hospital");
  await page.getByLabel("Billing Provider NPI").fill("1234567890");
  await page.getByLabel("Provider TIN").fill("91-1234567");
  await page.getByLabel("Provider Taxonomy Code").fill("207Q00000X");
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Diagnosis").fill("Low back pain");
  await page.getByLabel("ICD-10 Codes (comma separated)").fill("M54.50");
  await page.getByLabel("ICD-10-PCS Codes (inpatient, comma separated)").fill("0SG00ZZ");
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Medical Record Number (MRN, optional)").fill("U3-MRN-1001");
  await page.getByLabel("Insurance Company").fill("Blue Horizon Health");
  await page.getByLabel("Policy Number (optional)").fill("U3-POL-1001");
  await page.getByLabel("Member ID (optional)").fill("U3-MEM-1001");
  await page.getByLabel("Plan Administrator (optional)").fill("Northwest Benefit Services");
  await page.getByLabel("Payer Reference Number (optional)").fill("U3-REF-1001");
  await page.getByLabel("Group Number (optional)").fill("GRP-777");
  await page.getByLabel("Subscriber ID (optional)").fill("SUB-1001");
  await page.getByLabel("Subscriber Name (optional)").fill("Jordan Example");
  await page.getByLabel("Subscriber Relationship").click();
  await page.getByRole("option", { name: "Self" }).click();
  await page.getByLabel("Coordination of Benefits").click();
  await page.getByRole("option", { name: "Primary" }).click();
  await page.getByLabel("Payer EDI ID (optional)").fill("842610001");
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Claim Type").click();
  await page.getByRole("option", { name: "Provider Billed" }).click();
  await page.getByLabel("Total Billed Amount (USD)").fill("1500");
  await page.getByLabel("Coverage Limit (USD, optional)", { exact: true }).fill("10000");
  await page.getByLabel("Remaining Coverage Limit (USD, optional)", { exact: true }).fill("8765.44");
  await page.getByLabel("Total Claimed Amount (USD)").fill("1234.56");
  await page.getByLabel("Claim Frequency").click();
  await page.getByRole("option", { name: "Original" }).click();
  await page.getByLabel("Timely Filing Deadline").fill("2026-12-31");
  await page.getByLabel("Type of Bill").fill("131");
  await page.getByLabel("DRG").fill("470");

  await page.getByRole("button", { name: "Add Service Line" }).click();
  await page.getByLabel("CPT / HCPCS").fill("99213");
  await page.getByLabel("Modifiers (comma separated)").fill("25");
  await page.getByLabel("Units").fill("2");
  await page.getByLabel("Charge (USD)").fill("1234.56");
  await page.getByLabel("Linked Diagnosis Codes").fill("M54.50");
  await page.getByLabel("Service Date From").fill("2026-10-01");
  await page.getByLabel("Service Date To").fill("2026-10-01");
  await page.getByLabel("Revenue Code").fill("0450");
  await page.getByLabel("POA Indicator").click();
  await page.getByRole("option", { name: /Y - Present at admission/i }).click();

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText(/Service Lines:/).locator("..")).toContainText("1");
  await page.getByRole("button", { name: "Create Claim" }).click();
  await expect(page).toHaveURL(/\/claims$/);

  const created = await findClaim();
  expect(created).toBeTruthy();
  claimId = created.id;

  const claim = await getClaim(claimId);
  expect(claim.billingProviderNpi).toBe("1234567890");
  expect(claim.claimForm).toBe("INSTITUTIONAL");
  expect(claim.groupNumber).toBe("GRP-777");
  expect(claim.subscriberRelationship).toBe("SELF");
  expect(claim.coordinationOfBenefits).toBe("PRIMARY");
  expect(claim.payerEdiId).toBe("842610001");
  expect(claim.typeOfBill).toBe("0131");
  expect(claim.drgCode).toBe("470");
  expect(claim.claimFrequencyCode).toBe("ORIGINAL");
  expect(claim.inpatientProcedureCodes).toContain("0SG00ZZ");
  expect(claim.serviceLines).toHaveLength(1);
  expect(claim.serviceLines[0].cptHcpcsCode).toBe("99213");
  expect(claim.serviceLines[0].modifiers).toEqual(["25"]);
  expect(Number(claim.serviceLines[0].units)).toBe(2);
  expect(Number(claim.serviceLines[0].charge)).toBe(1234.56);
});

test("U3-2 - claim detail displays US provider coverage and service-line data", async ({ page }) => {
  expect(claimId).toBeTruthy();
  await page.goto(`/claims/${claimId}`);

  await expect(page.getByText(/Billing NPI:/).locator("..")).toContainText("1234567890");
  await expect(page.getByText(/Claim Form:/).locator("..")).toContainText("Institutional (837I)");
  await expect(page.getByText(/Group Number:/).locator("..")).toContainText("GRP-777");
  await expect(page.getByText(/Subscriber ID:/).locator("..")).toContainText("SUB-1001");
  await expect(page.getByText(/Payer EDI ID:/).locator("..")).toContainText("842610001");
  await expect(page.getByText(/ICD-10-PCS:/).locator("..")).toContainText("0SG00ZZ");
  await expect(page.getByText(/Type of Bill:/).locator("..")).toContainText("131");
  await expect(page.getByText(/DRG:/).locator("..")).toContainText("470");
  await expect(page.getByText("99213", { exact: false })).toBeVisible();
  await expect(page.getByText(/Charge:/).locator("..")).toContainText("$1,234.56");
});

test("U3-3 - edit US claim metadata and replace service lines", async ({ page }) => {
  await page.goto(`/claims/${claimId}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  await page.getByLabel("Group Number").fill("GRP-888");
  await page.getByLabel("DRG").fill("871");
  await page.getByLabel("Claim Frequency").click();
  await page.getByRole("option", { name: "Corrected" }).click();

  await page.getByLabel("CPT / HCPCS").fill("99214");
  await page.getByLabel("Units").fill("1");
  await page.getByLabel("Charge (USD)").fill("999.99");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Group Number:/).locator("..")).toContainText("GRP-888");
  await expect(page.getByText(/DRG:/).locator("..")).toContainText("871");
  await expect(page.getByText("99214", { exact: false })).toBeVisible();

  const claim = await getClaim(claimId);
  expect(claim.groupNumber).toBe("GRP-888");
  expect(claim.drgCode).toBe("871");
  expect(claim.claimFrequencyCode).toBe("CORRECTED");
  expect(claim.serviceLines).toHaveLength(1);
  expect(claim.serviceLines[0].cptHcpcsCode).toBe("99214");
  expect(Number(claim.serviceLines[0].charge)).toBe(999.99);
});
