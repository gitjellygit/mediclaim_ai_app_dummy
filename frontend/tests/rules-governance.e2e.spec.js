import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

let apiContext;
let auth;

async function json(response, label) {
  if (!response.ok()) {
    throw new Error(`${label} failed (${response.status()}): ${await response.text()}`);
  }
  return response.json();
}

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });
  auth = await json(
    await apiContext.post("/api/auth/login", {
      data: { email, password }
    }),
    "login"
  );
});

test.afterAll(async () => {
  await apiContext?.dispose();
});

test("Rules governance - metadata exposes supported categories fields and operators", async () => {
  const meta = await json(
    await apiContext.get("/api/rules/meta", {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    }),
    "rule metadata"
  );

  expect(meta.categories.some((item) => item.id === "PATIENT_COVERAGE")).toBe(true);
  expect(meta.categories.some((item) => item.id === "NCCI_MUE")).toBe(true);
  expect(meta.fields.some((item) => item.id === "memberId")).toBe(true);
  expect(meta.fields.some((item) => item.id === "verifiedServiceLineCount")).toBe(true);
  expect(meta.operators.some((item) => item.id === "REQUIRED")).toBe(true);
  expect(meta.operators.some((item) => item.id === "GREATER_OR_EQUAL")).toBe(true);
  expect(meta.externalSources.some((item) => item.id === "CMS_NCCI_PTP")).toBe(true);
});

test("Rules governance - malformed custom rule is rejected", async () => {
  const response = await apiContext.post("/api/rules", {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {
      code: "RULE_BAD_DEFINITION",
      name: "Bad definition",
      category: "CLAIM",
      severity: "WARN",
      enabled: true,
      scope: "ORGANIZATION",
      definition: {
        field: "notARealClaimField",
        operator: "REQUIRED"
      },
      version: "1.0"
    }
  });

  expect(response.status()).toBe(400);
});

test("Rules governance - payer scope requires payer identity", async () => {
  const response = await apiContext.post("/api/rules", {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {
      code: "RULE_PAYER_WITHOUT_IDENTITY",
      name: "Payer rule without payer",
      category: "PAYER",
      severity: "WARN",
      enabled: true,
      scope: "PAYER",
      definition: {
        field: "groupNumber",
        operator: "REQUIRED"
      },
      version: "1.0"
    }
  });

  expect(response.status()).toBe(400);
  expect((await response.json()).error).toContain("payer");
});

test("Rules governance - system rule code cannot be shadowed by custom rule", async () => {
  const response = await apiContext.post("/api/rules", {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {
      code: "US_MEMBER_ID",
      name: "Shadow member rule",
      category: "PATIENT_COVERAGE",
      severity: "WARN",
      enabled: true,
      scope: "ORGANIZATION",
      definition: {
        field: "memberId",
        operator: "REQUIRED"
      },
      version: "1.0"
    }
  });

  expect(response.status()).toBe(409);
});

test("Rules governance - mandatory system rule cannot be edited or deleted", async () => {
  const listed = await json(
    await apiContext.get("/api/rules", {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    }),
    "list rules"
  );

  const mandatory = listed.items.find(
    (item) => item.code === "US_MEMBER_ID" && item.mandatory === true
  );
  expect(mandatory).toBeTruthy();

  const patch = await apiContext.patch(`/api/rules/${mandatory.id}`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: { enabled: false }
  });
  expect(patch.status()).toBe(409);

  const remove = await apiContext.delete(`/api/rules/${mandatory.id}`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` }
  });
  expect(remove.status()).toBe(409);
});

test("Rules governance - custom rule can be created and archived without disappearing from audit semantics", async () => {
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  const created = await json(
    await apiContext.post("/api/rules", {
      headers,
      data: {
        code: "RULE_GOVERNANCE_ARCHIVE",
        name: "Archive governance rule",
        description: "Archive lifecycle test",
        category: "DOCUMENTATION",
        severity: "INFO",
        enabled: true,
        scope: "ORGANIZATION",
        definition: {
          field: "documentCount",
          operator: "GREATER_OR_EQUAL",
          value: 1
        },
        version: "1.0"
      }
    }),
    "create governance rule"
  );

  expect(created.systemManaged).toBe(false);

  const remove = await apiContext.delete(`/api/rules/${created.id}`, { headers });
  expect(remove.ok()).toBe(true);

  const listed = await json(
    await apiContext.get("/api/rules", { headers }),
    "list rules after archive"
  );
  expect(listed.items.some((item) => item.id === created.id)).toBe(false);
});
