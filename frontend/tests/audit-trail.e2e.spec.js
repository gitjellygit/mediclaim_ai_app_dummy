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

async function api(page, path) {
  return page.evaluate(async ({ backendURL, path }) => {
    const token = localStorage.getItem("accessToken");
    const response = await fetch(`${backendURL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "include"
    });
    return {
      status: response.status,
      data: await response.json()
    };
  }, { backendURL, path });
}

test("Audit CSV export requires a safe scope and rejects unfiltered API export", async ({ page }, testInfo) => {
  const browser = observeBrowser(page, testInfo);

  await login(page);
  await page.goto("/audit");
  await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();

  const download = page.getByRole("button", { name: "Download CSV" });
  await expect(download).toBeDisabled();
  await expect(
    page.getByText(/CSV export is limited for safety/i)
  ).toBeVisible();

  const unfiltered = await api(page, "/api/audit/export");
  expect(unfiltered.status).toBe(400);
  expect(unfiltered.data.code).toBe("AUDIT_EXPORT_SCOPE_REQUIRED");

  const claimId = page.getByLabel("Claim ID");
  await claimId.fill("claim-e2e-export-scope");
  await expect(download).toBeEnabled();

  const scoped = await api(
    page,
    "/api/audit/export?claimId=claim-e2e-export-scope"
  );
  expect(scoped.status).toBe(200);
  expect(scoped.data.exported).toBeGreaterThanOrEqual(0);
  expect(scoped.data.limit).toBe(10000);

  await claimId.fill("");
  await expect(download).toBeDisabled();

  const from = page.getByLabel("From");
  const to = page.getByLabel("To");
  await from.fill("2026-10-01T00:00");
  await to.fill("2026-10-15T23:59");
  await expect(download).toBeEnabled();

  await to.fill("2026-12-15T23:59");
  await expect(download).toBeDisabled();
  await expect(
    page.getByText(/date range cannot exceed 31 days/i)
  ).toBeVisible();

  const tooWide = await api(
    page,
    "/api/audit/export?from=2026-10-01T00%3A00%3A00.000Z&to=2026-12-15T23%3A59%3A00.000Z"
  );
  expect(tooWide.status).toBe(400);
  expect(tooWide.data.code).toBe("AUDIT_EXPORT_RANGE_TOO_LARGE");

  await browser.assertClean();
});

test("Audit Clear filters resets query without creating repeated viewed/access events", async ({ page }, testInfo) => {
  const browser = observeBrowser(page, testInfo);

  await login(page);
  await page.goto("/audit");
  await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();
  await expect(page.getByText("Audit Trail Accessed", { exact: true }).first()).toBeVisible();

  const before = await api(
    page,
    "/api/audit?action=AUDIT_TRAIL_ACCESSED&page=1&pageSize=25"
  );
  expect(before.status).toBe(200);
  const initialAccessCount = before.data.total;
  expect(initialAccessCount).toBeGreaterThanOrEqual(1);

  const action = page.getByLabel("Action");
  await action.fill("CLAIM");
  await expect(action).toHaveValue("CLAIM");

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(action).toHaveValue("");

  const after = await api(
    page,
    "/api/audit?action=AUDIT_TRAIL_ACCESSED&page=1&pageSize=25"
  );
  expect(after.status).toBe(200);
  expect(after.data.total).toBe(initialAccessCount);

  await expect(page.getByText("Audit Trail Viewed", { exact: true })).toHaveCount(0);
  await browser.assertClean();
});
