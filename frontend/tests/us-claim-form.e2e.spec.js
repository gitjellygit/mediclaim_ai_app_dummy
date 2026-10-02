import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

let apiContext;
let auth;
const createdClaimIds = [];

async function apiJson(response, label) {
  if (!response.ok()) {
    throw new Error(`${label} failed (${response.status()}): ${await response.text()}`);
  }
  return response.json();
}

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });
  const login = await apiContext.post("/api/auth/login", {
    data: { email, password }
  });
  auth = await apiJson(login, "E2E login");
});

test.afterAll(async () => {
  for (const id of createdClaimIds) {
    await apiContext.delete(`/api/claims/${id}`, {
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

test("U4-1 - 837P professional claim requires rendering NPI", async ({ page }) => {
  await page.goto("/claims/new");

  await page.getByLabel("Claim Form").click();
  await page.getByRole("option", { name: "Professional (837P)" }).click();

  await page.getByLabel("Patient Name").fill("E2E-U4-PROFESSIONAL");
  await page.getByLabel("Billing Provider NPI").fill("1234567890");

  await expect(page.getByLabel("Rendering Provider NPI")).toBeVisible();
  await expect(page.getByLabel("Referring Provider NPI")).toBeVisible();

  await page.getByRole("button", { name: "Next" }).click();
  await expect(
    page.getByText("Rendering provider NPI is required for 837P", { exact: true })
  ).toBeVisible();

  await page.getByLabel("Rendering Provider NPI").fill("1987654321");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByLabel("Diagnosis")).toBeVisible();
});

test("U4-2 - 837I institutional claim hides rendering NPI and requires Type of Bill + revenue code", async ({ page }) => {
  await page.goto("/claims/new");

  await page.getByLabel("Claim Form").click();
  await page.getByRole("option", { name: "Institutional (837I)" }).click();

  await page.getByLabel("Patient Name").fill("E2E-U4-INSTITUTIONAL");
  await page.getByLabel("Billing Provider NPI").fill("1234567890");

  await expect(page.getByLabel("Rendering Provider NPI")).toHaveCount(0);
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Insurance Company").fill("Institutional Health");
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Total Billed Amount (USD)").fill("500");
  await page.getByLabel("Total Claimed Amount (USD)").fill("450");

  await page.getByRole("button", { name: "Add Service Line" }).click();
  await page.getByLabel("CPT / HCPCS").fill("0450");
  await page.getByLabel("Units").fill("1");
  await page.getByLabel("Charge (USD)").fill("450");

  await page.getByRole("button", { name: "Next" }).click();

  await expect(
    page.getByText("Type of Bill is required for 837I", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Revenue Code is required on every 837I service line", { exact: true })
  ).toBeVisible();

  await page.getByLabel("Type of Bill").fill("131");
  await page.getByLabel("Revenue Code").fill("0450");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText(/Claim Form:/).locator("..")).toContainText("Institutional (837I)");
});

test("U4-3 - readiness applies form-specific blockers only to explicitly classified claims", async () => {
  const create = async (data) => {
    const response = await apiContext.post("/api/claims", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data
    });
    const claim = await apiJson(response, "claim create");
    createdClaimIds.push(claim.id);
    return claim;
  };

  const professional = await create({
    patientName: "E2E-U4-READINESS-P",
    payerName: "U4 Health",
    policyNo: "U4-POL-P",
    amount: 100,
    claimForm: "PROFESSIONAL"
  });

  const institutional = await create({
    patientName: "E2E-U4-READINESS-I",
    payerName: "U4 Health",
    policyNo: "U4-POL-I",
    amount: 100,
    claimForm: "INSTITUTIONAL"
  });

  const runCheck = async (claimId) => {
    const response = await apiContext.post(`/api/claims/${claimId}/check`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: {}
    });
    return apiJson(response, "claim readiness");
  };

  const professionalCheck = await runCheck(professional.id);
  const pMessages = professionalCheck.issues.map((issue) => issue.message);
  expect(pMessages).toContain("837P professional claim requires billing provider NPI");
  expect(pMessages).toContain("837P professional claim requires rendering provider NPI");
  expect(pMessages).toContain("837P professional claim requires at least one CPT/HCPCS service line");
  expect(pMessages.some((message) => message.includes("837I institutional"))).toBeFalsy();

  const institutionalCheck = await runCheck(institutional.id);
  const iMessages = institutionalCheck.issues.map((issue) => issue.message);
  expect(iMessages).toContain("837I institutional claim requires billing provider NPI");
  expect(iMessages).toContain("837I institutional claim requires Type of Bill");
  expect(iMessages).toContain("837I institutional claim requires at least one service line");
  expect(iMessages.some((message) => message.includes("837P professional"))).toBeFalsy();
});
