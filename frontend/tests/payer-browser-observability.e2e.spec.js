import { test, expect } from "@playwright/test";
import { observeBrowser } from "./support/browser-observability.js";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

async function loginThroughBrowser(page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/claims/);
  await expect
    .poll(() => page.evaluate(() => Boolean(localStorage.getItem("accessToken"))))
    .toBe(true);
}

async function browserApi(page, path, {
  method = "GET",
  body
} = {}) {
  return page.evaluate(
    async ({ backendURL, path, method, body }) => {
      const token = localStorage.getItem("accessToken");
      const response = await fetch(`${backendURL}${path}`, {
        method,
        credentials: "include",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });

      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      return {
        ok: response.ok,
        status: response.status,
        data
      };
    },
    { backendURL, path, method, body }
  );
}

async function createClaimInBrowser(page, overrides = {}) {
  const response = await browserApi(page, "/api/claims", {
    method: "POST",
    body: {
      patientName: "E2E Browser Payer",
      payerName: "Browser Test Health",
      policyNo: "BROWSER-POL-100",
      memberId: "BROWSER-MEM-100",
      patientDob: "1985-05-05",
      amount: 175,
      totalBilledAmount: 175,
      claimForm: "PROFESSIONAL",
      billingProviderNpi: "1234567890",
      renderingProviderNpi: "1987654321",
      diagnosisText: "Routine office visit",
      icd10Codes: ["Z00.00"],
      dateOfService: "2026-10-01",
      serviceLines: [
        {
          cptHcpcsCode: "99213",
          units: 1,
          charge: 175,
          placeOfService: "11"
        }
      ],
      ...overrides
    }
  });

  expect(response.ok, JSON.stringify(response.data)).toBe(true);
  return response.data;
}

async function cleanupClaim(page, claimId) {
  if (!claimId) return;
  await browserApi(page, `/api/claims/${claimId}`, { method: "DELETE" });
}

test("browser smoke - simulated payer connects and verifies eligibility without browser errors", async ({ page }, testInfo) => {
  const browser = observeBrowser(page, testInfo);
  let claimId = null;

  try {
    await loginThroughBrowser(page);
    const claim = await createClaimInBrowser(page, {
      patientName: "E2E Browser Simulated"
    });
    claimId = claim.id;

    await page.goto(`/journey?claimId=${claim.id}`);
    await expect(page.getByTestId("payer-connection-card")).toContainText(
      "Payer connection required"
    );

    await page.getByTestId("payer-select").click();
    await page.getByRole("option", { name: "Blue Horizon Health" }).click();
    await page.getByRole("button", { name: "Connect", exact: true }).click();

    await expect(page.getByText("Connected", { exact: true }).first()).toBeVisible();

    const eligibility = page.getByTestId("journey-stage-eligibility");
    await eligibility.getByRole("button", { name: "Check Eligibility" }).click();
    await expect(eligibility).toContainText("Verified");

    const journey = await browserApi(page, `/api/claims/${claim.id}/journey`);
    expect(journey.ok).toBe(true);
    expect(journey.data.claim.payerConnectionMode).toBe("SIMULATED");
    expect(journey.data.claim.eligibilityStatus).toBe("VERIFIED");
    expect(
      journey.data.claim.payerTransactions.some(
        (tx) => tx.transactionType === "ELIGIBILITY" && tx.mode === "SIMULATED"
      )
    ).toBe(true);
  } finally {
    await cleanupClaim(page, claimId);
    await browser.assertClean();
  }
});

test("browser smoke - STEDI_TEST payer discovery, connection and eligibility are visible in Claim Journey", async ({ page }, testInfo) => {
  const browser = observeBrowser(page, testInfo);
  let claimId = null;

  try {
    await loginThroughBrowser(page);

    const payerSearch = await browserApi(
      page,
      "/api/payer-connectors/stedi/payers?query=Aetna&pageSize=20"
    );
    expect(payerSearch.ok, JSON.stringify(payerSearch.data)).toBe(true);
    expect(payerSearch.data.items.length).toBeGreaterThan(0);
    expect(payerSearch.data.items[0].primaryPayerId).toBe("60054");

    const claim = await createClaimInBrowser(page, {
      patientName: "Jane Doe",
      subscriberName: "Jane Doe",
      subscriberId: "STEDI-E2E-MEMBER",
      memberId: "STEDI-E2E-MEMBER",
      payerName: "Aetna E2E",
      payerEdiId: "60054",
      patientDob: "1975-05-05"
    });
    claimId = claim.id;

    const connected = await browserApi(
      page,
      `/api/claims/${claim.id}/journey/payer-connection`,
      {
        method: "POST",
        body: {
          connectorId: "STEDI_TEST",
          payerCode: "60054",
          payerName: "Aetna E2E"
        }
      }
    );
    expect(connected.ok, JSON.stringify(connected.data)).toBe(true);
    expect(connected.data.connector.id).toBe("STEDI_TEST");

    await page.goto(`/journey?claimId=${claim.id}`);
    const connectionCard = page.getByTestId("payer-connection-card");
    await expect(connectionCard.getByText("Connected", { exact: true })).toBeVisible();
    await expect(connectionCard).toContainText("STEDI test connector");
    await expect(connectionCard).toContainText(
      "Test environment · Responses are not production payer verification"
    );

    const eligibility = page.getByTestId("journey-stage-eligibility");
    await eligibility.getByRole("button", { name: "Check Eligibility" }).click();
    await expect(eligibility).toContainText("Verified");

    const priorAuth = page.getByTestId("journey-stage-prior-auth");
    await expect(
      priorAuth.getByRole("button", { name: "Not Available" })
    ).toBeDisabled();

    const claimStage = page.getByTestId("journey-stage-claim");
    await expect(
      claimStage.getByRole("button", { name: "Submit to Payer" })
    ).toBeVisible();

    const journey = await browserApi(page, `/api/claims/${claim.id}/journey`);
    expect(journey.ok).toBe(true);
    expect(journey.data.payerConnection.connector.id).toBe("STEDI_TEST");
    expect(journey.data.payerConnection.connector.environment).toBe("TEST");
    expect(journey.data.claim.eligibilityStatus).toBe("VERIFIED");

    const eligibilityTransaction = journey.data.claim.payerTransactions.find(
      (tx) => tx.transactionType === "ELIGIBILITY"
    );
    expect(eligibilityTransaction).toBeTruthy();
    expect(eligibilityTransaction.mode).toBe("TEST");
    expect(eligibilityTransaction.payerCode).toBe("60054");
    expect(eligibilityTransaction.responsePayload.status).toBe("ACTIVE");
    expect(eligibilityTransaction.responsePayload.testMode).toBe(true);
  } finally {
    await cleanupClaim(page, claimId);
    await browser.assertClean();
  }
});
