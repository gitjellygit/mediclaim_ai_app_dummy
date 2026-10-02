import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

let apiContext;
let auth;
const claimIds = [];

async function apiJson(response, label) {
  if (!response.ok()) {
    throw new Error(`${label} failed (${response.status()}): ${await response.text()}`);
  }
  return response.json();
}

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });
  auth = await apiJson(
    await apiContext.post("/api/auth/login", { data: { email, password } }),
    "login"
  );
});

test.afterAll(async () => {
  for (const id of claimIds) {
    await apiContext.delete(`/api/claims/${id}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    });
  }
  await apiContext?.dispose();
});

test("U8 - denial creation classifies CARC and computes appeal deadline", async () => {
  const claim = await apiJson(
    await apiContext.post("/api/claims", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: {
        patientName: "E2E-U8-DENIAL",
        payerName: "U8 Health",
        policyNo: "U8-POL-1",
        memberId: "U8-MEM-1",
        amount: 250
      }
    }),
    "create claim"
  );
  claimIds.push(claim.id);

  const denial = await apiJson(
    await apiContext.post(`/api/denials/from-claim/${claim.id}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: {
        denialDate: "2026-10-02",
        carcCode: "197",
        rarcCode: "N115",
        appealWindowDays: 180
      }
    }),
    "create denial"
  );

  expect(denial.denialCategory).toBe("AUTHORIZATION");
  expect(String(denial.appealDeadline).slice(0, 10)).toBe("2027-03-31");

  const detail = await apiJson(
    await apiContext.get(`/api/denials/${denial.id}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    }),
    "get denial"
  );

  expect(detail.codeReference.carc.code).toBe("197");
  expect(detail.codeReference.carc.category).toBe("AUTHORIZATION");
  expect(detail.deadline.state).toBe("OPEN");
});

test("U8 - CARC lookup returns grounded local reference data", async () => {
  const lookup = await apiJson(
    await apiContext.get("/api/denials/reference/codes?carc=29&rarc=N390", {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    }),
    "lookup denial codes"
  );

  expect(lookup.carc.code).toBe("29");
  expect(lookup.category).toBe("TIMELY_FILING");
  expect(lookup.rarc.code).toBe("N390");
});

test("U8 - appeal deadline preview is configurable and clearly operational", async () => {
  const preview = await apiJson(
    await apiContext.post("/api/denials/deadline-preview", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: { denialDate: "2026-10-02", appealWindowDays: 60 }
    }),
    "preview deadline"
  );

  expect(String(preview.appealDeadline).slice(0, 10)).toBe("2026-12-01");
  expect(preview.appealWindowDays).toBe(60);
  expect(preview.note).toMatch(/verify the payer/i);
});

test("U8 - denial state machine rejects skipped appeal transitions", async () => {
  const claim = await apiJson(
    await apiContext.post("/api/claims", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: {
        patientName: "E2E-U8-STATE",
        payerName: "U8 Health",
        policyNo: "U8-POL-2",
        amount: 100
      }
    }),
    "create state claim"
  );
  claimIds.push(claim.id);

  const denial = await apiJson(
    await apiContext.post(`/api/denials/from-claim/${claim.id}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: { denialDate: "2026-10-02", carcCode: "16" }
    }),
    "create state denial"
  );

  const skipped = await apiContext.patch(`/api/denials/${denial.id}`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: { status: "APPEAL_SUBMITTED" }
  });

  expect(skipped.status()).toBe(409);
});
