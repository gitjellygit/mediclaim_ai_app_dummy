import { expect, request, test } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

test("recurring denials become an admin-reviewed disabled prevention rule", async ({ page }) => {
  const api = await request.newContext({ baseURL: backendURL });
  const login = await api.post("/api/auth/login", { data: { email, password } });
  expect(login.ok()).toBeTruthy();
  const auth = await login.json();
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  const suffix = String(Date.now());
  const payerName = `Prevention Health ${suffix}`;

  for (let index = 0; index < 3; index += 1) {
    const claimResponse = await api.post("/api/claims", {
      headers,
      data: {
        patientName: `Prevention Synthetic ${index + 1}`,
        payerName,
        amount: 1000 + index * 100
      }
    });
    expect(claimResponse.ok()).toBeTruthy();
    const claim = await claimResponse.json();

    const denialResponse = await api.post(`/api/denials/from-claim/${claim.id}`, {
      headers,
      data: {
        source: "MANUAL",
        denialCategory: "AUTHORIZATION",
        carcCode: "197",
        reasonText: "Synthetic recurring authorization denial"
      }
    });
    expect(denialResponse.status()).toBe(201);
  }

  const refreshed = await api.post("/api/rules/recommendations/refresh", {
    headers,
    data: { minimumOccurrences: 3 }
  });
  expect(refreshed.ok()).toBeTruthy();
  const refreshBody = await refreshed.json();
  const recommendation = refreshBody.items.find(
    (item) =>
      item.denialCategory === "AUTHORIZATION" &&
      item.payerName === payerName &&
      item.status === "PENDING"
  );
  expect(recommendation).toBeTruthy();
  expect(recommendation.occurrenceCount).toBe(3);
  expect(recommendation.proposedRule.definition).toEqual({
    field: "authorizationNo",
    operator: "REQUIRED"
  });

  const approved = await api.post(
    `/api/rules/recommendations/${recommendation.id}/approve`,
    { headers, data: {} }
  );
  expect(approved.status()).toBe(201);
  const approvedBody = await approved.json();
  expect(approvedBody.activationRequired).toBe(true);
  expect(approvedBody.rule.enabled).toBe(false);
  expect(approvedBody.rule.source).toBe("DENIAL_PATTERN");

  const rulesResponse = await api.get("/api/rules", { headers });
  expect(rulesResponse.ok()).toBeTruthy();
  const rules = await rulesResponse.json();
  const draftRule = rules.items.find((item) => item.id === approvedBody.rule.id);
  expect(draftRule).toBeTruthy();
  expect(draftRule.enabled).toBe(false);

  const activate = await api.patch(`/api/rules/${draftRule.id}`, {
    headers,
    data: { enabled: true }
  });
  expect(activate.ok()).toBeTruthy();
  expect((await activate.json()).enabled).toBe(true);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/claims/);
  await page.goto("/rules");

  const panel = page.getByTestId("denial-prevention-recommendations");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(payerName);
  await expect(panel).toContainText("APPROVED");
  await expect(panel).toContainText("Draft rule created. Activation is controlled separately in Rules.");

  await api.dispose();
});
