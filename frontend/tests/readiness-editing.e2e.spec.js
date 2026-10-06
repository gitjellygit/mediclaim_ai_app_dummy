import { test, expect } from "@playwright/test";
import { observeBrowser } from "./support/browser-observability.js";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

async function login(page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/claims/);
}

async function browserApi(page, path, { method = "GET", body } = {}) {
  return page.evaluate(async ({ backendURL, path, method, body }) => {
    const token = localStorage.getItem("accessToken");
    const response = await fetch(`${backendURL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      data: text ? JSON.parse(text) : null
    };
  }, { backendURL, path, method, body });
}

test("readiness is gated until payer eligibility is verified", async ({ page }, testInfo) => {
  const browser = observeBrowser(page, testInfo);
  await login(page);

  const created = await browserApi(page, "/api/claims", {
    method: "POST",
    body: {
      patientName: "E2E Eligibility Gate",
      payerName: "Gate Health",
      policyNo: "GATE-POL-1",
      memberId: "GATE-MEM-1",
      amount: 100
    }
  });
  expect(created.ok).toBe(true);
  const claimId = created.data.id;

  try {
    await page.goto(`/claims/${claimId}`);
    const readiness = page.getByRole("heading", { name: "Claim Readiness for Submission" });
    await expect(readiness).toBeVisible();

    const checkButton = page.getByRole("button", { name: "Check Readiness", exact: true });
    await expect(checkButton).toBeDisabled();
    await expect(
      page.getByText(/Payer eligibility must be verified before readiness can be run/i)
    ).toBeVisible();

    await page.getByRole("button", { name: "Verify Eligibility", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/journey\\?claimId=${claimId}&stage=eligibility`));
    await browser.assertClean();
  } finally {
    await browserApi(page, `/api/claims/${claimId}`, { method: "DELETE" });
  }
});

test("readiness diagnosis linkage stays truthful through edit, save, recheck and reload", async ({ page }, testInfo) => {
  const browser = observeBrowser(page, testInfo, {
    allowConsoleError: (entry) =>
      entry.text.includes("400 (Bad Request)") &&
      /\/api\/claims\/[^/]+$/.test(entry.location?.url || "")
  });
  await login(page);

  const created = await browserApi(page, "/api/claims", {
    method: "POST",
    body: {
      patientName: "E2E Readiness Link",
      payerName: "Readiness Health",
      policyNo: "READY-LINK-1",
      memberId: "READY-MEMBER-1",
      amount: 100,
      billingProviderNpi: "1234567890",
      diagnosisText: "Low back pain",
      icd10Codes: ["M54.50"],
      serviceLines: [{
        cptHcpcsCode: "99213",
        units: 1,
        charge: 100,
        diagnosisPointers: []
      }]
    }
  });
  expect(created.ok).toBe(true);
  const claimId = created.data.id;

  try {
    const payerConnect = await browserApi(
      page,
      `/api/claims/${claimId}/payer-simulation/connect`,
      { method: "POST", body: { payerCode: "BLUE_HORIZON" } }
    );
    expect(payerConnect.ok).toBe(true);
    const eligibility = await browserApi(
      page,
      `/api/claims/${claimId}/payer-simulation/eligibility`,
      { method: "POST", body: {} }
    );
    expect(eligibility.ok).toBe(true);
    expect(eligibility.data.result.status).toBe("ACTIVE");

    const checked = await browserApi(page, `/api/claims/${claimId}/check`, {
      method: "POST",
      body: {}
    });
    expect(checked.ok).toBe(true);

    await page.goto(`/claims/${claimId}`);
    await expect(page.getByRole("heading", { name: "Claim Readiness for Submission" })).toBeVisible();
    const linkIssue = page.getByTestId("readiness-issue-US_DIAGNOSIS_CPT_LINK");
    await expect(linkIssue).toBeVisible();

    // Fix the service-line pointer using the readiness action.
    await linkIssue.getByRole("button", { name: "Edit Service Line" }).click();
    const pointer = page.getByLabel("Linked Diagnosis Codes").first();
    await expect(pointer).toBeVisible();
    await pointer.fill("M54.50");
    await expect(page.getByText(/not one of the claim ICD-10 codes/i)).toHaveCount(0);
    await page.getByRole("button", { name: "Save", exact: true }).first().click();

    // An edit makes the previous check stale. Old blockers must not masquerade
    // as current red/green results before the real engine recalculates.
    await expect(page.getByTestId("readiness-stale")).toBeVisible();
    await expect(page.getByTestId("readiness-issue-US_DIAGNOSIS_CPT_LINK")).toHaveCount(0);

    await page.getByRole("button", { name: "Recheck Readiness" }).click();
    await expect(page.getByTestId("readiness-stale")).toHaveCount(0);
    await expect(page.getByTestId("readiness-issue-US_DIAGNOSIS_CPT_LINK")).toHaveCount(0);
    const fixedScore = Number((await page.getByTestId("readiness-score").textContent()).replace("%", ""));
    expect(fixedScore).toBeGreaterThan(0);

    // Reload must preserve the resolved state.
    await page.reload();
    await expect(page.getByTestId("readiness-issue-US_DIAGNOSIS_CPT_LINK")).toHaveCount(0);

    // Changing only the claim ICD would make the persisted service-line
    // diagnosis link invalid, so the editor should surface that immediately and
    // the backend must reject saving the inconsistent intermediate state.
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await page.getByLabel("ICD-10 Codes (comma separated)").fill("E11.9");
    await expect(page.getByText(/M54\.50 is not one of the claim ICD-10 codes/i)).toBeVisible();

    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    const updateDialog = page.getByRole("dialog", { name: "Claim update failed" });
    await expect(updateDialog).toContainText(/Service-line diagnosis codes must match ICD-10-CM diagnoses/i);
    await updateDialog.getByRole("button", { name: "OK", exact: true }).click();

    // Fix the pointer in the same edit session, then save atomically.
    await page.getByLabel("Linked Diagnosis Codes").first().fill("E11.9");
    await expect(page.getByText(/not one of the claim ICD-10 codes/i)).toHaveCount(0);
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await expect(page.getByTestId("readiness-stale")).toBeVisible();

    await page.getByRole("button", { name: "Recheck Readiness" }).click();
    await expect(page.getByTestId("readiness-issue-US_DIAGNOSIS_CPT_LINK")).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("readiness-issue-US_DIAGNOSIS_CPT_LINK")).toHaveCount(0);
    await browser.assertClean();
  } finally {
    await browserApi(page, `/api/claims/${claimId}`, { method: "DELETE" });
  }
});
