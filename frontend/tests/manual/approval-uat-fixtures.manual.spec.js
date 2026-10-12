import { expect, request, test } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";
const action = String(process.env.APPROVAL_UAT_ACTION || "seed").toLowerCase();

async function login() {
  const api = await request.newContext({ baseURL: backendURL });
  const response = await api.post("/api/auth/login", { data: { email, password } });
  if (!response.ok()) {
    const detail = await response.text();
    await api.dispose();
    throw new Error(`UAT login failed for ${email} (${response.status()}): ${detail}. Set E2E_EMAIL and E2E_PASSWORD to your local ADMIN credentials.`);
  }
  return { api, auth: await response.json() };
}

test("prepare Approval Intelligence manual UAT scenarios", async ({ page }) => {
  const { api, auth } = await login();
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  try {
    if (action === "cleanup") {
      const cleanup = await api.delete("/api/claims/e2e/approval-intelligence/cleanup", { headers });
      expect(cleanup.ok()).toBeTruthy();
      const result = await cleanup.json();
      console.log(`Approval Intelligence UAT cleanup complete: ${result.deleted} synthetic claim(s) removed.`);
      return;
    }

    const seed = await api.post("/api/claims/e2e/approval-intelligence/seed", { headers });
    if (!seed.ok()) throw new Error(`Approval UAT seed failed (${seed.status()}): ${await seed.text()}`);
    const seeded = await seed.json();
    expect(seeded.count).toBe(15);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();

    await expect(page).toHaveURL(/\/claims$/);
    await page.goto("/approval");
    await expect(
      page.getByRole("heading", { name: "Approval Intelligence" })
    ).toBeVisible();
    const search = page.getByPlaceholder("Search patient, payer, member, policy, claim or authorization...");
    await search.fill(seeded.prefix);

    for (const scenario of seeded.scenarios) {
      await expect(page.getByRole("row").filter({ hasText: scenario.patientName })).toBeVisible();
    }

    const row = (key) => {
      const scenario = seeded.scenarios.find((item) => item.key === key);
      if (!scenario) throw new Error(`Missing seeded scenario ${key}`);
      return page.getByRole("row").filter({ hasText: scenario.patientName });
    };

    await expect(row("01-READY")).toContainText("READY");
    await expect(row("01-READY")).toContainText("96/100");
    await expect(row("01-READY").getByRole("button", { name: "Review & Submit" })).toBeVisible();
    await expect(row("02-ELIG-REVIEW")).toContainText("Needs review");
    await expect(row("03-ELIG-FAILED")).toContainText("Failed");
    await expect(row("04-AUTH-REQUIRED")).toContainText("Required");
    await expect(row("05-AUTH-DENIED")).toContainText("Denied");
    await expect(row("06-AUTH-EXPIRED")).toContainText("Authorization expired");
    await expect(row("07-FILING-EXPIRED")).toContainText(/Expired \d+d ago/);
    await expect(row("08-FILING-URGENT")).toContainText("3d remaining");
    await expect(row("09-FILING-SOON")).toContainText("21d remaining");
    await expect(row("10-STALE")).toContainText("Stale");
    await expect(row("11-BLOCKED")).toContainText(/1 blocker/);
    await expect(row("12-CODING-PENDING")).toContainText("1 suggestion pending");
    await expect(row("13-SUBMITTED")).toContainText("SUBMITTED");
    await expect(row("14-DENIED")).toContainText("DENIED");
    await expect(row("15-PAID")).toContainText("PAID");
    await expect(row("15-PAID")).toContainText("Recorded");

    console.log("\nApproval Intelligence UAT data is ready.");
    console.log(`Created ${seeded.count} synthetic claims with prefix ${seeded.prefix}`);
    console.log("Open your normal local app and go to /approval.");
    console.log("Search for: UAT-APPROVAL-");
    console.log("Fixtures are intentionally left in the database for manual review.");
    console.log("Run npm run uat:approval:cleanup when finished.");
  } finally {
    await api.dispose();
  }
});
