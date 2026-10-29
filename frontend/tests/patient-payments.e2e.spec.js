import { expect, request, test } from "@playwright/test";

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
    await api.post("/api/claims/e2e/patient-payments/seed", {
      headers: headers()
    }),
    "seed patient payments"
  );
});

test.afterAll(async () => {
  if (api && auth?.accessToken) {
    await api.delete("/api/claims/e2e/patient-payments/cleanup", {
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

test("Patient Payments uses real API mutations and keeps long charge lists collapsed", async ({ page }) => {
  await page.goto(`/patient-payments/${fixture.patientBalanceId}`);

  await expect(page.getByText("E2E CHIP JOHNSON")).toBeVisible();
  await expect(page.getByRole("button", { name: `Show all ${fixture.chargeCount} charges` })).toBeVisible();
  await expect(page.getByTestId("statement-status")).toHaveText("Not sent");
  await expect(page.getByTestId("payment-plan-status")).toHaveText("No plan");

  await page.getByRole("button", { name: "Mark as Sent" }).click();
  await expect(page.getByTestId("statement-status")).toHaveText("Sent");
  await expect(page.getByTestId("patient-payment-action-message")).toContainText(
    "Statement status updated to Sent"
  );

  await page.getByRole("button", { name: "Mark as Active" }).click();
  await expect(page.getByTestId("payment-plan-status")).toHaveText("Active");
  await expect(page.getByTestId("patient-payment-action-message")).toContainText(
    "Payment plan status updated to Active"
  );

  await page.getByRole("button", { name: "Record Payment" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount").fill("250");
  await dialog.getByLabel("Payment method").click();
  await page.getByRole("option", { name: "CASH" }).click();
  await dialog.getByRole("button", { name: "Record Payment" }).click();

  await expect(page.getByTestId("patient-payment-action-message")).toContainText(
    "Payment of $250.00 recorded"
  );
  await expect(
    page.getByRole("heading", { name: "Payment history" }).locator("..").getByText("CASH").first()
  ).toBeVisible();

  await page.getByRole("button", { name: `Show all ${fixture.chargeCount} charges` }).click();
  await expect(page.getByRole("button", { name: "Hide charges" })).toBeVisible();
  await expect(page.getByText("99213").first()).toBeVisible();
});
