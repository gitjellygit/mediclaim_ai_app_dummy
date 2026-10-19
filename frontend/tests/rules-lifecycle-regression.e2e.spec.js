import { test, expect, request } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const backendURL = "http://127.0.0.1:4101";
const adminEmail = process.env.E2E_EMAIL || "admin@hospital.com";
const adminPassword = process.env.E2E_PASSWORD || "admin123";
const runTag = String(process.env.GITHUB_RUN_ID || Date.now()).replace(/\D/g, "").slice(-10) || "LOCAL";

let api;
let admin;
let counter = 0;
let createdRuleIds = [];

function code(prefix) {
  counter += 1;
  return `${prefix}_${runTag}_${counter}`.toUpperCase().slice(0, 78);
}

async function apiJson(response, label) {
  if (!response.ok()) {
    throw new Error(`${label} failed (${response.status()}): ${await response.text()}`);
  }
  return response.json();
}

function headers(token = admin.accessToken) {
  return { Authorization: `Bearer ${token}` };
}

async function seedClaims() {
  return apiJson(
    await api.post("/api/claims/e2e/rules-lifecycle/seed", {
      headers: headers()
    }),
    "seed rules lifecycle claims"
  );
}

async function getClaim(id) {
  return apiJson(
    await api.get(`/api/claims/${id}`, { headers: headers() }),
    "get claim"
  );
}

async function checkClaim(id) {
  return apiJson(
    await api.post(`/api/claims/${id}/check`, {
      headers: headers(),
      data: {}
    }),
    "run readiness"
  );
}

async function ensureReady(id) {
  await checkClaim(id);
  const claim = await getClaim(id);
  expect(claim.status).toBe("READY");
  expect(claim.checks[0].isStale).toBe(false);
  expect(claim.checks[0].rulesetFingerprint).toMatch(/^[a-f0-9]{64}$/);
  return claim;
}

async function createRule(payload) {
  const created = await apiJson(
    await api.post("/api/rules", {
      headers: headers(),
      data: payload
    }),
    "create rule"
  );
  createdRuleIds.push(created.id);
  return created;
}

function rulePayload(overrides = {}) {
  return {
    code: code("E2E_RULE"),
    name: "E2E lifecycle rule",
    description: "Synthetic Rules v1 lifecycle test.",
    category: "PATIENT_COVERAGE",
    severity: "BLOCK",
    enabled: true,
    scope: "ORGANIZATION",
    payerName: null,
    payerEdiId: null,
    definition: {
      field: "groupNumber",
      operator: "REQUIRED"
    },
    version: "1.0",
    effectiveFrom: null,
    effectiveTo: null,
    ...overrides
  };
}

async function archiveCreatedRules() {
  for (const id of createdRuleIds) {
    const response = await api.delete(`/api/rules/${id}`, { headers: headers() });
    if (![200, 404, 409].includes(response.status())) {
      throw new Error(`cleanup rule ${id} failed: ${response.status()} ${await response.text()}`);
    }
  }
  createdRuleIds = [];
}

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: backendURL });
  admin = await apiJson(
    await api.post("/api/auth/login", {
      data: { email: adminEmail, password: adminPassword }
    }),
    "admin login"
  );
});

test.beforeEach(async () => {
  createdRuleIds = [];
  await seedClaims();
});

test.afterEach(async () => {
  await archiveCreatedRules();
  await api.delete("/api/claims/e2e/rules-lifecycle/cleanup", {
    headers: headers()
  });
});

test.afterAll(async () => {
  await api?.dispose();
});

test("Rules lifecycle - creating an organization BLOCK rule stales READY claims and forces recheck", async () => {
  const fixture = await seedClaims();
  await ensureReady(fixture.aetnaClaimId);
  await ensureReady(fixture.cignaClaimId);

  const created = await createRule(rulePayload({
    definition: {
      field: "providerTaxonomyCode",
      operator: "EQUALS",
      value: "9999999999"
    }
  }));

  expect(created.invalidation.affectedClaims).toBeGreaterThanOrEqual(2);
  expect(created.invalidation.readyClaimsReopened).toBeGreaterThanOrEqual(2);

  const aetna = await getClaim(fixture.aetnaClaimId);
  const cigna = await getClaim(fixture.cignaClaimId);
  expect(aetna.status).toBe("NEEDS_REVIEW");
  expect(cigna.status).toBe("NEEDS_REVIEW");
  expect(aetna.checks[0].isStale).toBe(true);
  expect(cigna.checks[0].isStale).toBe(true);

  const rechecked = await checkClaim(fixture.aetnaClaimId);
  expect((rechecked.issues || []).some((issue) => issue.rule === created.code)).toBe(true);
});

test("Rules lifecycle - modifying a rule preserves immutable old snapshot and invalidates current readiness", async () => {
  const fixture = await seedClaims();
  const created = await createRule(rulePayload({
    definition: { field: "groupNumber", operator: "REQUIRED" }
  }));

  await ensureReady(fixture.aetnaClaimId);

  const updated = await apiJson(
    await api.patch(`/api/rules/${created.id}`, {
      headers: headers(),
      data: {
        version: "1.1",
        severity: "BLOCK",
        definition: {
          field: "groupNumber",
          operator: "EQUALS",
          value: "DOES-NOT-MATCH"
        }
      }
    }),
    "modify rule"
  );

  expect(updated.revision).toBe(2);
  const claim = await getClaim(fixture.aetnaClaimId);
  expect(claim.checks[0].isStale).toBe(true);
  expect(claim.status).toBe("NEEDS_REVIEW");

  const versions = await apiJson(
    await api.get(`/api/rules/${created.id}/versions`, { headers: headers() }),
    "get rule history"
  );
  expect(versions.items.map((item) => item.revision)).toEqual([2, 1]);
  expect(versions.items[0].snapshot.definition.value).toBe("DOES-NOT-MATCH");
  expect(versions.items[1].snapshot.definition.operator).toBe("REQUIRED");

  const rechecked = await checkClaim(fixture.aetnaClaimId);
  expect((rechecked.issues || []).some((issue) => issue.rule === created.code)).toBe(true);
});

test("Rules lifecycle - saving an unchanged rule is idempotent and does not stale claims", async () => {
  const fixture = await seedClaims();
  const created = await createRule(rulePayload({
    code: code("NOOP_SAVE"),
    definition: { field: "groupNumber", operator: "REQUIRED" }
  }));

  const ready = await ensureReady(fixture.aetnaClaimId);
  const versionsBefore = await apiJson(
    await api.get(`/api/rules/${created.id}/versions`, { headers: headers() }),
    "get versions before no-op"
  );

  const unchanged = await apiJson(
    await api.patch(`/api/rules/${created.id}`, {
      headers: headers(),
      data: {
        name: created.name,
        description: created.description,
        category: created.category,
        severity: created.severity,
        enabled: created.enabled,
        scope: created.scope,
        payerName: created.payerName,
        payerEdiId: created.payerEdiId,
        definition: created.definition,
        version: created.version,
        effectiveFrom: created.effectiveFrom,
        effectiveTo: created.effectiveTo
      }
    }),
    "save unchanged rule"
  );

  expect(unchanged.unchanged).toBe(true);
  expect(unchanged.invalidation.affectedClaims).toBe(0);

  const claim = await getClaim(fixture.aetnaClaimId);
  expect(claim.status).toBe("READY");
  expect(claim.checks[0].isStale).toBe(false);
  expect(claim.checks[0].rulesetFingerprint).toBe(ready.checks[0].rulesetFingerprint);

  const versionsAfter = await apiJson(
    await api.get(`/api/rules/${created.id}/versions`, { headers: headers() }),
    "get versions after no-op"
  );
  expect(versionsAfter.items.length).toBe(versionsBefore.items.length);
  expect(versionsAfter.items[0].revision).toBe(1);
});

test("Rules lifecycle - disabling a failing custom rule stales the old result and removes issue after recheck", async () => {
  const fixture = await seedClaims();
  const created = await createRule(rulePayload({
    definition: { field: "groupNumber", operator: "EQUALS", value: "NOPE" }
  }));

  const first = await checkClaim(fixture.aetnaClaimId);
  expect((first.issues || []).some((issue) => issue.rule === created.code)).toBe(true);

  const disabled = await apiJson(
    await api.patch(`/api/rules/${created.id}`, {
      headers: headers(),
      data: { enabled: false, version: "1.1" }
    }),
    "disable rule"
  );
  expect(disabled.enabled).toBe(false);

  const stale = await getClaim(fixture.aetnaClaimId);
  expect(stale.checks[0].isStale).toBe(true);

  const second = await checkClaim(fixture.aetnaClaimId);
  expect((second.issues || []).some((issue) => issue.rule === created.code)).toBe(false);
});

test("Rules lifecycle - archiving a rule keeps history but removes future readiness effect", async () => {
  const fixture = await seedClaims();
  const created = await createRule(rulePayload({
    definition: { field: "groupNumber", operator: "EQUALS", value: "ARCHIVE-MISS" }
  }));

  const first = await checkClaim(fixture.aetnaClaimId);
  expect((first.issues || []).some((issue) => issue.rule === created.code)).toBe(true);

  const archived = await api.delete(`/api/rules/${created.id}`, { headers: headers() });
  expect(archived.ok()).toBe(true);
  createdRuleIds = createdRuleIds.filter((id) => id !== created.id);

  const stale = await getClaim(fixture.aetnaClaimId);
  expect(stale.checks[0].isStale).toBe(true);

  const second = await checkClaim(fixture.aetnaClaimId);
  expect((second.issues || []).some((issue) => issue.rule === created.code)).toBe(false);

  const versions = await apiJson(
    await api.get(`/api/rules/${created.id}/versions`, { headers: headers() }),
    "get archived rule history"
  );
  expect(versions.items[0].changeType).toBe("ARCHIVED");
  expect(versions.items[0].snapshot.deletedAt).toBeTruthy();
});

test("Rules lifecycle - payer rule invalidates only matching payer while unrelated payer remains READY", async () => {
  const fixture = await seedClaims();
  const aetnaBefore = await ensureReady(fixture.aetnaClaimId);
  const cignaBefore = await ensureReady(fixture.cignaClaimId);

  await createRule(rulePayload({
    code: code("AETNA_ONLY"),
    scope: "PAYER",
    payerName: "Aetna",
    payerEdiId: "60054",
    definition: {
      field: "groupNumber",
      operator: "EQUALS",
      value: "NO-MATCH"
    }
  }));

  const aetna = await getClaim(fixture.aetnaClaimId);
  const cigna = await getClaim(fixture.cignaClaimId);
  expect(aetna.status).toBe("NEEDS_REVIEW");
  expect(aetna.checks[0].isStale).toBe(true);
  expect(cigna.status).toBe("READY");
  expect(cigna.checks[0].isStale).toBe(false);
  expect(cigna.checks[0].rulesetFingerprint).toBe(cignaBefore.checks[0].rulesetFingerprint);
  expect(aetnaBefore.checks[0].rulesetFingerprint).not.toBe("");
});

test("Rules lifecycle - changing payer scope invalidates claims covered by both old and new scope", async () => {
  const fixture = await seedClaims();
  const created = await createRule(rulePayload({
    code: code("PAYER_MOVE"),
    scope: "PAYER",
    payerName: "Aetna",
    payerEdiId: "60054",
    definition: { field: "groupNumber", operator: "REQUIRED" }
  }));

  await ensureReady(fixture.aetnaClaimId);
  await ensureReady(fixture.cignaClaimId);

  await apiJson(
    await api.patch(`/api/rules/${created.id}`, {
      headers: headers(),
      data: {
        payerName: "Cigna",
        payerEdiId: "62308",
        version: "1.1"
      }
    }),
    "move payer scope"
  );

  const aetna = await getClaim(fixture.aetnaClaimId);
  const cigna = await getClaim(fixture.cignaClaimId);
  expect(aetna.checks[0].isStale).toBe(true);
  expect(cigna.checks[0].isStale).toBe(true);
  expect(aetna.status).toBe("NEEDS_REVIEW");
  expect(cigna.status).toBe("NEEDS_REVIEW");
});

test("Rules lifecycle - rule changes do not retroactively stale already submitted claims", async () => {
  const fixture = await seedClaims();
  const before = await getClaim(fixture.submittedClaimId);
  expect(before.status).toBe("SUBMITTED");
  expect(before.checks[0].isStale).toBe(false);

  await createRule(rulePayload({
    code: code("POST_SUBMISSION"),
    definition: { field: "groupNumber", operator: "EQUALS", value: "NEW-POLICY" }
  }));

  const after = await getClaim(fixture.submittedClaimId);
  expect(after.status).toBe("SUBMITTED");
  expect(after.checks[0].isStale).toBe(false);
  expect(after.checks[0].rulesetFingerprint).toBe(before.checks[0].rulesetFingerprint);
});

test("Rules lifecycle - impact simulation is non-mutating", async () => {
  const fixture = await seedClaims();
  const beforeAetna = await getClaim(fixture.aetnaClaimId);
  const beforeCigna = await getClaim(fixture.cignaClaimId);

  const preview = await apiJson(
    await api.post("/api/rules/simulate", {
      headers: headers(),
      data: rulePayload({
        code: code("SIMULATE"),
        scope: "PAYER",
        payerName: "Aetna",
        payerEdiId: "60054",
        definition: { field: "groupNumber", operator: "EQUALS", value: "NOPE" }
      })
    }),
    "simulate rule"
  );

  expect(preview.testedClaims).toBeGreaterThanOrEqual(2);
  expect(preview.affectedClaims).toBeGreaterThanOrEqual(1);
  expect(preview.blockCount).toBeGreaterThanOrEqual(1);

  const afterAetna = await getClaim(fixture.aetnaClaimId);
  const afterCigna = await getClaim(fixture.cignaClaimId);
  expect(afterAetna.status).toBe(beforeAetna.status);
  expect(afterCigna.status).toBe(beforeCigna.status);
  expect(afterAetna.checks.length).toBe(beforeAetna.checks.length);
  expect(afterCigna.checks.length).toBe(beforeCigna.checks.length);
});

test("Rules lifecycle - backend rejects operator and field type mismatches plus removed regex", async () => {
  const invalidCases = [
    { field: "amount", operator: "CONTAINS", value: "10" },
    { field: "priorAuthRequired", operator: "GREATER_THAN", value: 1 },
    { field: "patientName", operator: "BEFORE", value: "2026-01-01" },
    { field: "memberId", operator: "MATCHES", value: "^ABC" }
  ];

  for (const [index, definition] of invalidCases.entries()) {
    const response = await api.post("/api/rules", {
      headers: headers(),
      data: rulePayload({
        code: code("TYPE_INVALID_" + index),
        definition
      })
    });
    expect(response.status()).toBe(400);
  }
});

test("Rules lifecycle - configured payer EDI overrides matching display name", async () => {
  const fixture = await seedClaims();
  const wrongEdiRule = await createRule(rulePayload({
    code: code("EDI_AUTHORITY"),
    scope: "PAYER",
    payerName: "Aetna",
    payerEdiId: "99999",
    definition: { field: "groupNumber", operator: "EQUALS", value: "NOPE" }
  }));

  const check = await checkClaim(fixture.aetnaClaimId);
  expect((check.issues || []).some((issue) => issue.rule === wrongEdiRule.code)).toBe(false);
});

test("Rules lifecycle - disabled rule creation is draft-like and enabling it invalidates matching readiness", async () => {
  const fixture = await seedClaims();
  const before = await ensureReady(fixture.aetnaClaimId);

  const created = await createRule(rulePayload({
    code: code("DISABLED_DRAFT"),
    enabled: false,
    definition: { field: "groupNumber", operator: "EQUALS", value: "NOPE" }
  }));

  expect(created.invalidation.affectedClaims).toBe(0);
  const unchanged = await getClaim(fixture.aetnaClaimId);
  expect(unchanged.status).toBe("READY");
  expect(unchanged.checks[0].isStale).toBe(false);
  expect(unchanged.checks[0].rulesetFingerprint).toBe(before.checks[0].rulesetFingerprint);

  const enabled = await apiJson(
    await api.patch(`/api/rules/${created.id}`, {
      headers: headers(),
      data: { enabled: true, version: "1.1" }
    }),
    "enable rule"
  );
  expect(enabled.enabled).toBe(true);
  expect(enabled.invalidation.affectedClaims).toBeGreaterThanOrEqual(1);

  const after = await getClaim(fixture.aetnaClaimId);
  expect(after.status).toBe("NEEDS_REVIEW");
  expect(after.checks[0].isStale).toBe(true);
});

test("Rules lifecycle - severity change WARN to BLOCK creates a revision and invalidates current readiness", async () => {
  const fixture = await seedClaims();
  const created = await createRule(rulePayload({
    code: code("SEVERITY_CHANGE"),
    severity: "WARN",
    definition: { field: "groupNumber", operator: "EQUALS", value: "NOPE" }
  }));

  await checkClaim(fixture.aetnaClaimId);
  const before = await getClaim(fixture.aetnaClaimId);
  expect(before.checks[0].issues.some((issue) => issue.rule === created.code && issue.severity === "WARN")).toBe(true);

  const updated = await apiJson(
    await api.patch(`/api/rules/${created.id}`, {
      headers: headers(),
      data: { severity: "BLOCK", version: "1.1" }
    }),
    "raise severity"
  );
  expect(updated.revision).toBe(2);

  const stale = await getClaim(fixture.aetnaClaimId);
  expect(stale.checks[0].isStale).toBe(true);

  const rechecked = await checkClaim(fixture.aetnaClaimId);
  expect(rechecked.issues.some((issue) => issue.rule === created.code && issue.severity === "BLOCK")).toBe(true);
});

test("Rules lifecycle - future rule does not stale current readiness until activation, then blocks stale submission", async () => {
  const fixture = await seedClaims();
  const readyBefore = await ensureReady(fixture.aetnaClaimId);
  const activatesAt = new Date(Date.now() + 3000).toISOString();

  const created = await createRule(rulePayload({
    code: code("FUTURE_BOUNDARY"),
    definition: { field: "groupNumber", operator: "REQUIRED" },
    effectiveFrom: activatesAt
  }));

  expect(created.invalidation.affectedClaims).toBe(0);
  expect(created.invalidation.readyClaimsReopened).toBe(0);

  const stillReady = await getClaim(fixture.aetnaClaimId);
  expect(stillReady.status).toBe("READY");
  expect(stillReady.checks[0].isStale).toBe(false);
  expect(stillReady.checks[0].rulesetFingerprint).toBe(readyBefore.checks[0].rulesetFingerprint);

  await new Promise((resolve) => setTimeout(resolve, 3400));

  const response = await api.post(`/api/claims/${fixture.aetnaClaimId}/submit`, {
    headers: headers(),
    data: {}
  });
  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.code).toBe("READINESS_RULESET_STALE");
});

test("Rules lifecycle - CASHIER and RECEPTIONIST cannot view or mutate admin rules", async () => {
  const cashier = await apiJson(
    await api.post("/api/auth/login", {
      data: { email: "cashier@hospital.com", password: "cashier123" }
    }),
    "cashier login"
  );
  const reception = await apiJson(
    await api.post("/api/auth/login", {
      data: { email: "reception@hospital.com", password: "recep123" }
    }),
    "reception login"
  );

  const cashierList = await api.get("/api/rules", { headers: headers(cashier.accessToken) });
  const receptionList = await api.get("/api/rules", { headers: headers(reception.accessToken) });
  expect(cashierList.status()).toBe(403);
  expect(receptionList.status()).toBe(403);

  const cashierCreate = await api.post("/api/rules", {
    headers: headers(cashier.accessToken),
    data: rulePayload({ code: code("CASHIER_DENIED") })
  });
  expect(cashierCreate.status()).toBe(403);
});

test("Rules lifecycle - archived rule code is reserved and cannot be silently reused", async () => {
  const payload = rulePayload({ code: code("ARCHIVED_IDENTITY") });
  const created = await createRule(payload);
  const remove = await api.delete(`/api/rules/${created.id}`, { headers: headers() });
  expect(remove.ok()).toBe(true);
  createdRuleIds = createdRuleIds.filter((id) => id !== created.id);

  const recreate = await api.post("/api/rules", {
    headers: headers(),
    data: payload
  });
  expect(recreate.status()).toBe(409);
  expect((await recreate.json()).error).toMatch(/archived rule|immutable identities/i);
});


test("Rules UI - admin can preview impact before saving a custom rule", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/claims/);

  await page.goto("/rules/new");
  await expect(page.getByRole("heading", { name: "Add Rule" })).toBeVisible();

  await page.getByLabel("Rule Code").fill(code("UI_PREVIEW"));
  await page.getByLabel("Name").fill("UI preview regression rule");

  await page.getByRole("button", { name: "Test Against Claims" }).click();
  await expect(page.getByText(/Impact preview: tested/i)).toBeVisible();
  await expect(page.getByText(/No claim data was changed by this preview/i)).toBeVisible();

  // Preview must not persist the rule.
  const listed = await apiJson(
    await api.get("/api/rules", { headers: headers() }),
    "list rules after UI preview"
  );
  expect(listed.items.some((item) => item.name === "UI preview regression rule")).toBe(false);
});
