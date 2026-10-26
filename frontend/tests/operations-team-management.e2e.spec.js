import { expect, request, test } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const adminEmail = process.env.E2E_EMAIL || "admin@hospital.com";
const adminPassword = process.env.E2E_PASSWORD || "admin123";

async function login(api, email, password) {
  const response = await api.post("/api/auth/login", { data: { email, password } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test("hospital operations workflow supports users, assignment, clinical response and approvals", async ({ page }) => {
  const api = await request.newContext({ baseURL: backendURL });
  const adminAuth = await login(api, adminEmail, adminPassword);
  const adminHeaders = { Authorization: `Bearer ${adminAuth.accessToken}` };
  const suffix = String(Date.now());

  const teamResponse = await api.post("/api/operations/teams", {
    headers: adminHeaders,
    data: { name: `Commercial Follow-up ${suffix}`, description: "Synthetic E2E team" }
  });
  expect(teamResponse.status()).toBe(201);
  const team = await teamResponse.json();

  async function invite(email, role, displayName) {
    const response = await api.post("/api/operations/users/invite", {
      headers: adminHeaders,
      data: { email, role, displayName, teamId: team.id }
    });
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.user.status).toBe("INVITED");
    expect(body.setupToken).toBeTruthy();
    return body;
  }

  const specialistEmail = `claims-${suffix}@example.test`;
  const providerEmail = `provider-${suffix}@example.test`;
  const specialistInvite = await invite(specialistEmail, "CLAIMS_SPECIALIST", "E2E Claims Specialist");
  const providerInvite = await invite(providerEmail, "PROVIDER", "E2E Provider");

  const specialistPassword = "Strong!Pass123";
  const providerPassword = "Strong!Pass124";
  for (const [token, password] of [
    [specialistInvite.setupToken, specialistPassword],
    [providerInvite.setupToken, providerPassword]
  ]) {
    const accept = await api.post("/api/auth/accept-invite", {
      data: { setupToken: token, password }
    });
    expect(accept.ok()).toBeTruthy();
  }

  const specialistAuth = await login(api, specialistEmail, specialistPassword);
  const providerAuth = await login(api, providerEmail, providerPassword);
  expect(specialistAuth.user.role).toBe("CLAIMS_SPECIALIST");
  expect(providerAuth.user.role).toBe("PROVIDER");
  expect(providerAuth.user.permissions).toContain("OPERATIONS_VIEW");
  expect(providerAuth.user.permissions).not.toContain("CLAIM_VIEW");

  const claimResponse = await api.post("/api/claims", {
    headers: adminHeaders,
    data: { patientName: "Operations Synthetic", payerName: "Synthetic Health", amount: 25000 }
  });
  expect(claimResponse.ok()).toBeTruthy();
  const claim = await claimResponse.json();

  const followUp = new Date(Date.now() + 2 * 86400000).toISOString();
  const holdUntil = new Date(Date.now() + 3 * 86400000).toISOString();
  const bulk = await api.post("/api/operations/claims/bulk-work", {
    headers: adminHeaders,
    data: {
      claimIds: [claim.id],
      assignedToUserId: specialistInvite.user.id,
      workTeam: team.name,
      managerPriority: "URGENT",
      managerPriorityReason: "High-dollar claim needs immediate follow-up",
      nextFollowUpAt: followUp,
      holdReason: "Waiting for payer response",
      holdUntil,
      escalated: true
    }
  });
  expect(bulk.ok()).toBeTruthy();

  const comment = await api.post(`/api/operations/claims/${claim.id}/comments`, {
    headers: adminHeaders,
    data: {
      body: "Please review this high-dollar claim today.",
      mentionUserIds: [specialistInvite.user.id]
    }
  });
  expect(comment.status()).toBe(201);

  const clinical = await api.post("/api/operations/clinical-requests", {
    headers: adminHeaders,
    data: {
      claimId: claim.id,
      assignedToUserId: providerInvite.user.id,
      requestType: "MEDICAL_NECESSITY",
      requestText: "Please provide medical necessity clarification."
    }
  });
  expect(clinical.status()).toBe(201);
  const clinicalItem = await clinical.json();

  const providerHeaders = { Authorization: `Bearer ${providerAuth.accessToken}` };
  const providerRequests = await api.get("/api/operations/clinical-requests?mine=true", { headers: providerHeaders });
  expect(providerRequests.ok()).toBeTruthy();
  expect((await providerRequests.json()).items.some((item) => item.id === clinicalItem.id)).toBe(true);

  const response = await api.patch(`/api/operations/clinical-requests/${clinicalItem.id}/respond`, {
    headers: providerHeaders,
    data: { responseText: "Documentation confirms medical necessity.", status: "RESPONDED" }
  });
  expect(response.ok()).toBeTruthy();

  const specialistHeaders = { Authorization: `Bearer ${specialistAuth.accessToken}` };
  const approval = await api.post("/api/operations/approvals", {
    headers: specialistHeaders,
    data: {
      claimId: claim.id,
      requestType: "EXCEPTION_OVERRIDE",
      amount: 25000,
      reason: "Manager review requested for high-dollar exception."
    }
  });
  expect(approval.status()).toBe(201);
  const approvalItem = await approval.json();

  const decision = await api.patch(`/api/operations/approvals/${approvalItem.id}/decision`, {
    headers: adminHeaders,
    data: { decision: "APPROVED", reason: "Approved for E2E workflow" }
  });
  expect(decision.ok()).toBeTruthy();

  const queue = await api.post("/api/operations/saved-queues", {
    headers: specialistHeaders,
    data: {
      name: `Urgent Claims ${suffix}`,
      sharedWithTeam: true,
      filters: { owner: "ME", followUp: "DUE_7", sort: "priority", direction: "desc" }
    }
  });
  expect(queue.status()).toBe(201);

  const notifications = await api.get("/api/operations/notifications", { headers: specialistHeaders });
  expect(notifications.ok()).toBeTruthy();
  expect((await notifications.json()).unread).toBeGreaterThan(0);

  const history = await api.get(`/api/operations/claims/${claim.id}/ownership-history`, { headers: specialistHeaders });
  expect(history.ok()).toBeTruthy();
  const historyItems = (await history.json()).items;
  expect(historyItems.length).toBeGreaterThan(0);
  expect(historyItems[0].newAssigneeName).toContain("E2E Claims Specialist");

  const workload = await api.get("/api/operations/workload", { headers: adminHeaders });
  expect(workload.ok()).toBeTruthy();
  const specialistWorkload = (await workload.json()).items.find((item) => item.id === specialistInvite.user.id);
  expect(specialistWorkload.open).toBeGreaterThan(0);
  expect(specialistWorkload.urgent).toBeGreaterThan(0);

  await page.goto("/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/operations/);
  await expect(page.getByRole("heading", { name: "Operations & Team Management" })).toBeVisible();
  await expect(page.getByText(team.name)).toBeVisible();

  await page.goto("/approval");
  await page.getByPlaceholder(/Search patient, payer/).fill("Operations Synthetic");
  const row = page.locator("tbody tr").filter({ hasText: "Operations Synthetic" }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("Manager URGENT");
  await expect(row).toContainText("On Hold");

  await api.dispose();
});
