import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";

// This file is one localization workflow: later checks intentionally reuse
// claims created by earlier steps. Keep it serial so a failed setup step does
// not restart the worker and create misleading cascade failures.
test.describe.configure({ mode: "serial" });
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

const PRIMARY_PATIENT = "E2E-US-LOCALIZATION-PROVIDER";
const MEMBER_PATIENT = "E2E-US-LOCALIZATION-MEMBER";

const stateIdPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl1sAAAAASUVORK5CYII=",
  "base64"
);
const driverLicensePng = Buffer.concat([
  stateIdPng,
  Buffer.from("driver-license-e2e")
]);

let apiContext;
let auth;
let primaryClaimId;
let memberClaimId;

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

async function getClaim(id) {
  const response = await apiContext.get(`/api/claims/${id}`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` }
  });
  return apiJson(response, "claim get");
}

async function findClaimByPatient(patientName) {
  const response = await apiContext.get(
    `/api/claims/search?q=${encodeURIComponent(patientName)}&limit=10`,
    { headers: { Authorization: `Bearer ${auth.accessToken}` } }
  );
  const body = await apiJson(response, "claim search");
  return body.items.find((item) => item.patientName === patientName) || null;
}

async function cleanupTestClaims() {
  const response = await apiContext.get("/api/claims", {
    headers: { Authorization: `Bearer ${auth.accessToken}` }
  });
  if (!response.ok()) return;

  const claims = await response.json();
  const ids = (Array.isArray(claims) ? claims : [])
    .filter((claim) => claim.patientName?.startsWith("E2E-US-LOCALIZATION-"))
    .map((claim) => claim.id);

  for (const id of ids) {
    await apiContext.delete(`/api/claims/${id}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    });
  }
}

async function uploadDocument({ claimId, name, buffer }) {
  const form = new FormData();
  form.append("claimId", claimId);
  form.append(
    "file",
    new Blob([buffer], { type: "image/png" }),
    name
  );

  const response = await fetch(`${backendURL}/api/documents/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    body: form
  });

  return {
    status: () => response.status,
    ok: () => response.ok,
    json: () => response.json(),
    text: () => response.text()
  };
}

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });

  const login = await apiContext.post("/api/auth/login", {
    data: { email, password }
  });
  auth = await apiJson(login, "E2E login");

  await cleanupTestClaims();
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

test("1 - create U.S. claim with U.S. claim types, fields and USD labels", async ({ page }) => {
  await page.goto("/claims/new");
  await expect(page.getByRole("heading", { name: "New Medical Claim" })).toBeVisible();

  await page.getByLabel("Claim Form").click();
  await page.getByRole("option", { name: "Professional (837P)" }).click();
  await page.getByLabel("Patient Name").fill(PRIMARY_PATIENT);
  await page.getByLabel("Hospital Name").fill("Seattle General Hospital");
  await page.getByLabel("Billing Provider NPI").fill("1234567890");
  await page.getByLabel("Rendering Provider NPI").fill("1987654321");
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Diagnosis").fill("Routine outpatient evaluation");
  await page.getByLabel("ICD-10 Codes (comma separated)").fill("Z00.00");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByLabel("Medical Record Number (MRN, optional)")).toBeVisible();
  await page.getByLabel("Medical Record Number (MRN, optional)").fill("MRN-US-1001");
  await page.getByLabel("Insurance Company").fill("Blue Horizon Health");
  await page.getByLabel("Policy Number (optional)").fill("POL-US-1001");
  await page.getByLabel("Member ID (optional)").fill("MEM-US-1001");
  await page.getByLabel("Plan Administrator (optional)").fill("Northwest Benefit Services");
  await page.getByLabel("Payer Reference Number (optional)").fill("PAYER-REF-1001");
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Claim Type").click();
  await expect(page.getByRole("option", { name: "Member Reimbursement" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Provider Billed" })).toBeVisible();
  await page.getByRole("option", { name: "Provider Billed" }).click();

  await expect(page.getByLabel("Total Billed Amount (USD)")).toBeVisible();
  await expect(page.getByLabel("Total Claimed Amount (USD)")).toBeVisible();
  await expect(page.getByLabel("Coverage Limit (USD, optional)", { exact: true })).toBeVisible();
  await page.getByLabel("Total Billed Amount (USD)").fill("1500");
  await page.getByLabel("Coverage Limit (USD, optional)", { exact: true }).fill("10000");
  await page.getByLabel("Remaining Coverage Limit (USD, optional)", { exact: true }).fill("8765.44");
  await page.getByLabel("Total Claimed Amount (USD)").fill("1234.56");

  await page.getByRole("button", { name: "Add Service Line" }).click();
  await page.getByLabel("CPT / HCPCS").fill("99213");
  await page.getByLabel("Units").fill("1");
  await page.getByLabel("Charge (USD)").fill("1234.56");
  await page.getByLabel("Place of Service").fill("11");

  await expect(page.getByText("₹")).toHaveCount(0);
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText("$1,500.00")).toBeVisible();
  await expect(page.getByText("$1,234.56")).toBeVisible();
  await expect(page.getByText("$10,000.00")).toBeVisible();

  await page.getByRole("button", { name: "Create Claim" }).click();
  await expect(page).toHaveURL(/\/claims$/);

  const created = await findClaimByPatient(PRIMARY_PATIENT);
  expect(created).toBeTruthy();
  primaryClaimId = created.id;

  const claim = await getClaim(primaryClaimId);
  expect(claim.claimType).toBe("PROVIDER_BILLED");
  expect(claim.medicalRecordNumber).toBe("MRN-US-1001");
  expect(claim.memberId).toBe("MEM-US-1001");
  expect(claim.planAdministratorName).toBe("Northwest Benefit Services");
  expect(claim.payerReferenceNo).toBe("PAYER-REF-1001");
  expect(Number(claim.coverageLimit)).toBe(10000);
  expect(Number(claim.remainingCoverageLimit)).toBe(8765.44);
  expect(Number(claim.amount)).toBe(1234.56);
});

test("2 - claim detail renders U.S. terminology and USD formatting", async ({ page }) => {
  expect(primaryClaimId).toBeTruthy();

  await page.goto(`/claims/${primaryClaimId}`);
  await expect(page.getByText(PRIMARY_PATIENT, { exact: true })).toBeVisible();

  await expect(page.getByText("Provider Billed", { exact: true })).toBeVisible();
  await expect(page.getByText(/MRN:\s*MRN-US-1001/)).toBeVisible();
  await expect(page.getByText(/Plan Administrator:\s*Northwest Benefit Services/)).toBeVisible();
  await expect(page.getByText("Claimed Amount:", { exact: true }).locator("..")).toContainText("$1,234.56");
  await expect(page.getByText("Coverage Limit:", { exact: true }).locator("..")).toContainText("$10,000.00");

  await expect(page.getByText("TPA:", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Cashless", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Reimbursement", { exact: true })).toHaveCount(0);
  await expect(page.getByText("₹")).toHaveCount(0);
  await expect(page.getByText("INR", { exact: true })).toHaveCount(0);
});

test("3 - edit U.S. claim fields and confirm they persist after reload", async ({ page }) => {
  await page.goto(`/claims/${primaryClaimId}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  await page.getByLabel("Medical Record Number (MRN)").fill("MRN-US-2002");
  await page.getByLabel("Plan Administrator").fill("Pacific Plan Administrators");
  await page.getByLabel("Payer Reference Number").fill("PAYER-REF-2002");
  await page.getByLabel("Coverage Limit (USD)", { exact: true }).fill("12500.50");
  await page.getByLabel("Remaining Coverage Limit (USD)", { exact: true }).fill("11000.25");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Plan Administrator:\s*Pacific Plan Administrators/)).toBeVisible();

  await page.reload();
  await expect(page.getByText(/MRN:\s*MRN-US-2002/)).toBeVisible();
  await expect(page.getByText(/Plan Administrator:\s*Pacific Plan Administrators/)).toBeVisible();
  await expect(page.getByText("Coverage Limit:", { exact: true }).locator("..")).toContainText("$12,500.50");
  await expect(page.getByText("Remaining Coverage:", { exact: true }).locator("..")).toContainText("$11,000.25");

  const claim = await getClaim(primaryClaimId);
  expect(claim.medicalRecordNumber).toBe("MRN-US-2002");
  expect(claim.planAdministratorName).toBe("Pacific Plan Administrators");
  expect(claim.payerReferenceNo).toBe("PAYER-REF-2002");
  expect(Number(claim.coverageLimit)).toBe(12500.5);
  expect(Number(claim.remainingCoverageLimit)).toBe(11000.25);
});

test("4 - document duplicate scope and U.S. ID classification", async () => {
  const memberClaim = await createClaim({
    patientName: MEMBER_PATIENT,
    payerName: "SummitCare Insurance",
    policyNo: "POL-US-2002",
    memberId: "MEM-US-2002",
    medicalRecordNumber: "MRN-US-3003",
    claimType: "MEMBER_REIMBURSEMENT",
    amount: 900.25,
    totalBilledAmount: 1000
  });
  memberClaimId = memberClaim.id;

  const first = await uploadDocument({
    claimId: primaryClaimId,
    name: "state_id.png",
    buffer: stateIdPng
  });
  expect(first.status()).toBe(201);
  const firstBody = await first.json();
  expect(firstBody.type).toBe("ID_PROOF");
  expect(firstBody.suggestedType).toBe("ID_PROOF");

  const duplicateSameClaim = await uploadDocument({
    claimId: primaryClaimId,
    name: "state_id-copy.png",
    buffer: stateIdPng
  });
  expect(duplicateSameClaim.status()).toBe(409);
  const duplicateBody = await duplicateSameClaim.json();
  expect(duplicateBody.code).toBe("DOCUMENT_DUPLICATE");

  const sameFileDifferentClaim = await uploadDocument({
    claimId: memberClaimId,
    name: "state_id.png",
    buffer: stateIdPng
  });
  expect(sameFileDifferentClaim.status()).toBe(201);

  const driverLicense = await uploadDocument({
    claimId: primaryClaimId,
    name: "drivers_license.png",
    buffer: driverLicensePng
  });
  expect(driverLicense.status()).toBe(201);
  const driverBody = await driverLicense.json();
  expect(driverBody.suggestedType).toBe("ID_PROOF");
});

test("5 - Journey, Approval and Denials render USD with no legacy enum leakage", async ({ page }) => {
  await page.goto(`/journey?claimId=${primaryClaimId}`);
  await expect(page.getByRole("heading", { name: "Claim Journey" })).toBeVisible();
  await expect(page.getByText("Claimed *:", { exact: true }).locator("..")).toContainText("$1,234.56");
  await expect(page.getByText("₹")).toHaveCount(0);

  await page.goto("/approval");
  await expect(page.getByRole("heading", { name: "Approval Intelligence" })).toBeVisible();
  const approvalSearch = page.getByPlaceholder(
    "Search patient, payer, policy, member or claim number..."
  );
  await approvalSearch.fill(PRIMARY_PATIENT);
  const approvalRow = page.getByRole("row").filter({ hasText: PRIMARY_PATIENT });
  await expect(approvalRow).toBeVisible();
  await expect(approvalRow).toContainText("$1,234.56");

  const denialCreate = await apiContext.post(
    `/api/denials/from-claim/${primaryClaimId}`,
    {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: {
        source: "MANUAL",
        denialCategory: "CODING",
        reasonText: "Synthetic E2E U.S. localization denial"
      }
    }
  );
  expect([201, 409]).toContain(denialCreate.status());

  await page.goto("/denials");
  await expect(
    page.getByRole("heading", { name: "Denial & Appeal Intelligence" })
  ).toBeVisible();
  const denialSearch = page.getByPlaceholder(
    "Search patient, payer, policy, claim number, CARC/RARC or category..."
  );
  await denialSearch.fill(PRIMARY_PATIENT);
  const denialRow = page.getByRole("row").filter({ hasText: PRIMARY_PATIENT });
  await expect(denialRow).toBeVisible();
  await expect(denialRow).toContainText("$1,234.56");

  for (const legacy of ["CASHLESS", "REIMBURSEMENT", "INR", "₹"]) {
    await expect(page.getByText(legacy, { exact: true })).toHaveCount(0);
  }
});

test("6 - post-migration existing claim types render as U.S. labels", async ({ page }) => {
  expect(primaryClaimId).toBeTruthy();
  expect(memberClaimId).toBeTruthy();

  await page.goto(`/claims/${primaryClaimId}`);
  await expect(page.getByText("Provider Billed", { exact: true })).toBeVisible();

  await page.goto(`/claims/${memberClaimId}`);
  await expect(page.getByText("Member Reimbursement", { exact: true })).toBeVisible();

  const memberClaim = await getClaim(memberClaimId);
  expect(memberClaim.claimType).toBe("MEMBER_REIMBURSEMENT");
});
