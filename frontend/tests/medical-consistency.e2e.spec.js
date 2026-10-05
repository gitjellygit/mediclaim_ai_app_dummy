import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

const scenarios = [
  {
    patient: "E2E-MC-01-CLEAN",
    status: "CONSISTENT",
    finding: null
  },
  {
    patient: "E2E-MC-02-DATE-ORDER",
    status: "BLOCKED",
    finding: "Admission is after discharge"
  },
  {
    patient: "E2E-MC-03-DOS-OUTSIDE",
    status: "NEEDS REVIEW",
    finding: "Service date outside encounter"
  },
  {
    patient: "E2E-MC-04-PROCEDURE-OUTSIDE",
    status: "BLOCKED",
    finding: "Procedure date outside encounter"
  },
  {
    patient: "E2E-MC-05-ICU-EXCEEDS-STAY",
    status: "BLOCKED",
    finding: "ICU days exceed length of stay"
  },
  {
    patient: "E2E-MC-06-ICU-ROOM-CONFLICT",
    status: "NEEDS REVIEW",
    finding: "ICU utilization conflicts with room category"
  },
  {
    patient: "E2E-MC-07-ICU-DAYS-MISSING",
    status: "NEEDS REVIEW",
    finding: "ICU days not confirmed"
  },
  {
    patient: "E2E-MC-08-MISSING-DISCHARGE",
    status: "NEEDS REVIEW",
    finding: "Discharge summary not found"
  },
  {
    patient: "E2E-MC-09-PROCEDURE-NO-SUPPORT",
    status: "NEEDS REVIEW",
    finding: "Procedure lacks supporting clinical document"
  },
  {
    patient: "E2E-MC-10-CONFLICTING-DOS",
    status: "NEEDS REVIEW",
    finding: "Documents disagree on date of service"
  },
  {
    patient: "E2E-MC-11-CONFLICTING-ADMISSION",
    status: "NEEDS REVIEW",
    finding: "Documents disagree on admission date"
  },
  {
    patient: "E2E-MC-12-CONFLICTING-DIAGNOSIS",
    status: "NEEDS REVIEW",
    finding: "Diagnosis text differs across documents"
  }
];

let apiContext;
let auth;

test.beforeAll(async () => {
  apiContext = await request.newContext({
    baseURL: backendURL
  });

  const login = await apiContext.post("/api/auth/login", {
    data: { email, password }
  });

  if (!login.ok()) {
    const body = await login.text();
    throw new Error(
      `E2E login failed for ${email}. Run "node prisma/seed.js" in backend first. Backend response: ${body}`
    );
  }

  auth = await login.json();

  const seed = await apiContext.post(
    "/api/claims/e2e/medical-consistency/seed",
    {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`
      }
    }
  );

  if (!seed.ok()) {
    throw new Error(
      `Unable to seed medical consistency scenarios: ${await seed.text()}`
    );
  }

  const seeded = await seed.json();
  expect(seeded.count).toBe(12);
});

test.afterAll(async () => {
  if (apiContext && auth?.accessToken) {
    await apiContext.delete(
      "/api/claims/e2e/medical-consistency/cleanup",
      {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`
        }
      }
    );
  }

  await apiContext?.dispose();
});

test("12 medical consistency scenarios run end-to-end in the browser", async ({
  page
}) => {
  await page.addInitScript(
    ({ accessToken, refreshToken, user }) => {
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
      localStorage.setItem("user", JSON.stringify(user));
    },
    auth
  );

  await page.goto("/medical-ai");

  await expect(
    page.getByRole("heading", { name: "Medical Consistency" })
  ).toBeVisible();

  const search = page.getByPlaceholder(
    "Search patient, payer, policy, member ID, or claim ID"
  );
  await search.fill("E2E-MC-");

  const rows = page.getByTestId("medical-claim-row");
  await expect(rows).toHaveCount(12);

  for (const scenario of scenarios) {
    await test.step(
      `${scenario.patient} → ${scenario.status}`,
      async () => {
        const row = rows.filter({ hasText: scenario.patient });

        await expect(row).toBeVisible();
        await expect(row).toContainText(scenario.status);

        await row.scrollIntoViewIfNeeded();
        await row.click();

        const drawer = page.getByTestId("medical-consistency-drawer");
        await expect(drawer).toBeVisible();
        await expect(drawer).toContainText(scenario.patient);

        if (scenario.finding) {
          await expect(drawer.getByText(scenario.finding, { exact: true }))
            .toBeVisible();
        } else {
          await expect(
            drawer.getByText(
              "No internal consistency issues were detected by the current rule set."
            )
          ).toBeVisible();
          await expect(drawer).toContainText("100%");
        }

        console.log(
          `✓ ${scenario.patient}: ${scenario.status}${scenario.finding ? ` — ${scenario.finding}` : " — clean claim"}`
        );

        await page.keyboard.press("Escape");
        await expect(drawer).toBeHidden();
      }
    );
  }

  await test.step("finding Fix in Claim opens edit mode at the exact encounter fields", async () => {
    const row = rows.filter({ hasText: "E2E-MC-02-DATE-ORDER" });
    await row.scrollIntoViewIfNeeded();
    await row.click();

    const drawer = page.getByTestId("medical-consistency-drawer");
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByText("Admission is after discharge", { exact: true })
    ).toBeVisible();

    await drawer.getByRole("button", { name: "Fix in Claim" }).first().click();

    await expect(page).toHaveURL(/\/claims\/.*edit=1/);
    await expect(page).toHaveURL(/focus=admissionDate%2CdischargeDate/);
    await expect(
      page.getByText(/Fixing: Admission is after discharge/)
    ).toBeVisible();
    await expect(page.getByLabel("Admission Date")).toBeVisible();
    await expect(page.getByLabel("Discharge Date")).toBeVisible();

    console.log("✓ Medical Consistency fix deep-link opens the exact encounter fields");
  });

  await page.getByRole("button", { name: /Back to Medical Consistency/ }).click();
  await expect(page).toHaveURL(/\/medical-ai/);

  await test.step("document finding Fix in Claim jumps directly to Documents", async () => {
    const searchAgain = page.getByPlaceholder(
      "Search patient, payer, policy, member ID, or claim ID"
    );
    await searchAgain.fill("E2E-MC-08-MISSING-DISCHARGE");

    const row = page.getByTestId("medical-claim-row").filter({
      hasText: "E2E-MC-08-MISSING-DISCHARGE"
    });
    await expect(row).toBeVisible();
    await row.click();

    const drawer = page.getByTestId("medical-consistency-drawer");
    await expect(
      drawer.getByText("Discharge summary not found", { exact: true })
    ).toBeVisible();

    await drawer.getByRole("button", { name: "Fix in Claim" }).first().click();

    await expect(page).toHaveURL(/section=documents/);
    await expect(page).toHaveURL(/focus=documents/);
    await expect(page.getByRole("button", { name: "Upload Document" })).toBeVisible();

    console.log("✓ Medical Consistency document fix deep-link opens Documents");
  });

  console.log("✓ Medical Consistency browser automation: 12/12 scenarios + fix deep-links passed");
});
