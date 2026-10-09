import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";
const PATIENT = "E2E-U5-DATE-BOUNDARY";

let apiContext;
let auth;
let claimId;

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

  const existing = await apiContext.get(
    `/api/claims/search?q=${encodeURIComponent(PATIENT)}&limit=10`,
    { headers: { Authorization: `Bearer ${auth.accessToken}` } }
  );
  if (existing.ok()) {
    const body = await existing.json();
    for (const item of body.items || []) {
      if (item.patientName === PATIENT) {
        await apiContext.delete(`/api/claims/${item.id}`, {
          headers: { Authorization: `Bearer ${auth.accessToken}` }
        });
      }
    }
  }

  const create = await apiContext.post("/api/claims", {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {
      patientName: PATIENT,
      payerName: "U5 Date Health",
      policyNo: "U5-DATE-1",
      amount: 125,
      claimForm: "PROFESSIONAL",
      billingProviderNpi: "1234567890",
      renderingProviderNpi: "1987654321",
      patientDob: "03/04/1980",
      dateOfService: "10/01/2026",
      admissionDate: "09/30/2026",
      dischargeDate: "10/02/2026",
      procedureDate: "10/01/2026",
      timelyFilingDeadline: "12/31/2026",
      serviceLines: [
        {
          cptHcpcsCode: "99213",
          units: 1,
          charge: 125,
          placeOfService: "11",
          serviceDateFrom: "10/01/2026",
          serviceDateTo: "10/01/2026"
        }
      ]
    }
  });
  const claim = await apiJson(create, "U5 claim create");
  claimId = claim.id;
});

test.afterAll(async () => {
  if (claimId) {
    await apiContext.delete(`/api/claims/${claimId}`, {
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

test.describe("U5 timezone boundary rendering", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("U5-1 - claim date-only fields do not shift to previous day", async ({ page }) => {
    await page.goto(`/claims/${claimId}`);

    await expect(page.getByText(/^DOB:/).locator("..")).toContainText("03/04/1980");
    await expect(page.getByText(/Date of Service:/).locator("..")).toContainText("10/01/2026");
    await expect(page.getByText(/Admission:/).locator("..")).toContainText("09/30/2026");
    await expect(page.getByText(/Discharge:/).locator("..")).toContainText("10/02/2026");
    await expect(page.getByText(/Timely Filing Deadline:/).locator("..")).toContainText("12/31/2026");
  });

  test("U5-2 - edit form preserves exact date input values in negative timezone", async ({ page }) => {
    await page.goto(`/claims/${claimId}`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();

    await expect(page.getByLabel("Patient Date of Birth")).toHaveValue("1980-03-04");
    await expect(page.getByLabel("Date of Service")).toHaveValue("2026-10-01");
    await expect(page.getByLabel("Admission Date")).toHaveValue("2026-09-30");
    await expect(page.getByLabel("Discharge Date")).toHaveValue("2026-10-02");
    await expect(page.getByLabel("Timely Filing Deadline")).toHaveValue("2026-12-31");
    await expect(page.getByLabel("Service Date From")).toHaveValue("2026-10-01");
    await expect(page.getByLabel("Service Date To")).toHaveValue("2026-10-01");
  });
});

test("U5-3 - invalid US dates are rejected by API", async () => {
  const invalid = await apiContext.post("/api/claims", {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {
      patientName: "E2E-U5-INVALID-DATE",
      payerName: "U5 Date Health",
      amount: 100,
      patientDob: "13/01/2026"
    }
  });

  expect(invalid.status()).toBe(400);
  const body = await invalid.json();
  expect(body.code).toBe("INVALID_DATE");
});
