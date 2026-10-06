import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

const U7_RULES = [
  ["US_NPI_VALID", "Provider NPI present and valid", "BLOCK"],
  ["US_CPT_PRESENT", "CPT/HCPCS service code present", "BLOCK"],
  ["US_DIAGNOSIS_CPT_LINK", "Diagnosis linked to service line", "BLOCK"],
  ["US_TIMELY_FILING", "Claim is within timely filing window", "BLOCK"],
  ["US_MEMBER_ID", "Member ID present", "BLOCK"],
  ["US_PRIOR_AUTH", "Required prior authorization resolved", "BLOCK"]
];

let apiContext;
let auth;
const claimIds = [];
const originalRules = new Map();

async function apiJson(response, label) {
  if (!response.ok()) {
    throw new Error(`${label} failed (${response.status()}): ${await response.text()}`);
  }
  return response.json();
}

async function ensureRules() {
  const listed = await apiJson(
    await apiContext.get("/api/rules", {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    }),
    "list rules"
  );

  const byCode = new Map(listed.map((rule) => [rule.code, rule]));
  for (const [code, name, severity] of U7_RULES) {
    let rule = byCode.get(code);
    if (!rule) {
      rule = await apiJson(
        await apiContext.post("/api/rules", {
          headers: { Authorization: `Bearer ${auth.accessToken}` },
          data: { code, name, severity }
        }),
        `create rule ${code}`
      );
    }
    originalRules.set(code, { ...rule });
  }
}

async function createClaim(data) {
  const claim = await apiJson(
    await apiContext.post("/api/claims", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data
    }),
    "create claim"
  );
  claimIds.push(claim.id);
  return claim;
}

async function runCheck(id) {
  return apiJson(
    await apiContext.post(`/api/claims/${id}/check`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: {}
    }),
    "run readiness check"
  );
}

async function updateClaim(id, data) {
  return apiJson(
    await apiContext.patch(`/api/claims/${id}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data
    }),
    "update claim"
  );
}

function rulesFrom(check) {
  return new Map(
    (check.issues || [])
      .filter((issue) => issue.rule)
      .map((issue) => [issue.rule, issue])
  );
}

test.beforeAll(async () => {
  apiContext = await request.newContext({ baseURL: backendURL });
  auth = await apiJson(
    await apiContext.post("/api/auth/login", { data: { email, password } }),
    "login"
  );
  await ensureRules();

  for (const [code] of U7_RULES) {
    const rule = originalRules.get(code);
    if (rule.enabled !== true || rule.severity !== "BLOCK") {
      await apiJson(
        await apiContext.patch(`/api/rules/${rule.id}`, {
          headers: { Authorization: `Bearer ${auth.accessToken}` },
          data: { enabled: true, severity: "BLOCK" }
        }),
        `normalize rule ${code}`
      );
    }
  }
});

test.afterAll(async () => {
  for (const id of claimIds) {
    await apiContext.delete(`/api/claims/${id}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` }
    });
  }

  for (const [code, original] of originalRules.entries()) {
    await apiContext.patch(`/api/rules/${original.id}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: {
        enabled: original.enabled,
        severity: original.severity,
        name: original.name
      }
    });
  }

  await apiContext?.dispose();
});

test("U7-1 - configured US rules drive NPI, diagnosis linkage, timely filing and member ID issues", async () => {
  const claim = await createClaim({
    patientName: "E2E-U7-RULES",
    payerName: "U7 Health",
    policyNo: "U7-POL-1",
    amount: 100,
    claimForm: "PROFESSIONAL",
    billingProviderNpi: "1234567890",
    renderingProviderNpi: "1987654321",
    icd10Codes: ["M54.50"],
    timelyFilingDeadline: "01/01/2020",
    serviceLines: [
      {
        cptHcpcsCode: "99213",
        units: 1,
        charge: 100,
        diagnosisPointers: [],
        placeOfService: "11"
      }
    ]
  });

  const check = await runCheck(claim.id);
  const issues = rulesFrom(check);

  expect(issues.has("US_NPI_VALID")).toBe(false);
  expect(issues.get("US_DIAGNOSIS_CPT_LINK")?.severity).toBe("BLOCK");
  expect(issues.get("US_TIMELY_FILING")?.severity).toBe("BLOCK");
  expect(issues.get("US_MEMBER_ID")?.severity).toBe("BLOCK");
  expect(issues.has("US_CPT_PRESENT")).toBe(false);
});

test("U7-2 - missing CPT/HCPCS is enforced through configured rule", async () => {
  const claim = await createClaim({
    patientName: "E2E-U7-CPT",
    payerName: "U7 Health",
    policyNo: "U7-POL-2",
    memberId: "U7-MEM-2",
    amount: 100,
    billingProviderNpi: "1234567890",
    icd10Codes: ["M54.50"],
    serviceLines: []
  });

  const issues = rulesFrom(await runCheck(claim.id));
  expect(issues.get("US_CPT_PRESENT")?.severity).toBe("BLOCK");
});

test("U7-3 - disabling and downgrading a Rule changes live readiness output", async () => {
  const claim = await createClaim({
    patientName: "E2E-U7-CONFIG",
    payerName: "U7 Health",
    policyNo: "U7-POL-3",
    amount: 100,
    billingProviderNpi: "1234567890",
    icd10Codes: ["M54.50"],
    serviceLines: [
      {
        cptHcpcsCode: "99213",
        units: 1,
        charge: 100,
        diagnosisPointers: ["M54.50"]
      }
    ]
  });

  const memberRule = originalRules.get("US_MEMBER_ID");

  let issues = rulesFrom(await runCheck(claim.id));
  expect(issues.get("US_MEMBER_ID")?.severity).toBe("BLOCK");

  await apiJson(
    await apiContext.patch(`/api/rules/${memberRule.id}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: { enabled: false }
    }),
    "disable member rule"
  );
  issues = rulesFrom(await runCheck(claim.id));
  expect(issues.has("US_MEMBER_ID")).toBe(false);

  await apiJson(
    await apiContext.patch(`/api/rules/${memberRule.id}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: { enabled: true, severity: "WARN" }
    }),
    "downgrade member rule"
  );
  issues = rulesFrom(await runCheck(claim.id));
  expect(issues.get("US_MEMBER_ID")?.severity).toBe("WARN");

  await apiJson(
    await apiContext.patch(`/api/rules/${memberRule.id}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: { enabled: true, severity: "BLOCK" }
    }),
    "restore member rule"
  );
});

test("U7-4 - payer-required prior auth must be approved with authorization number", async () => {
  const claim = await createClaim({
    patientName: "E2E-U7-AUTH",
    payerName: "U7 Health",
    policyNo: "U7-POL-4",
    memberId: "U7-MEM-4",
    amount: 100,
    billingProviderNpi: "1234567890",
    icd10Codes: ["M54.50"],
    serviceLines: [
      {
        cptHcpcsCode: "99213",
        units: 1,
        charge: 100,
        diagnosisPointers: ["M54.50"]
      }
    ]
  });

  const eligibility = await apiContext.post(
    `/api/claims/${claim.id}/journey/eligibility/precheck`,
    {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: {}
    }
  );
  expect(eligibility.ok()).toBeTruthy();

  const required = await apiContext.post(
    `/api/claims/${claim.id}/journey/prior-auth/evaluate`,
    {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: { required: true }
    }
  );
  expect(required.ok()).toBeTruthy();

  let issues = rulesFrom(await runCheck(claim.id));
  expect(issues.get("US_PRIOR_AUTH")?.severity).toBe("BLOCK");

  const approved = await apiContext.post(
    `/api/claims/${claim.id}/journey/prior-auth/evaluate`,
    {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: { required: true, authorizationNo: "AUTH-U7-100" }
    }
  );
  expect(approved.ok()).toBeTruthy();

  issues = rulesFrom(await runCheck(claim.id));
  expect(issues.has("US_PRIOR_AUTH")).toBe(false);
});


test("U7-5 - diagnosis/service-line linkage stays correct across edit-order permutations", async () => {
  const claim = await createClaim({
    patientName: "E2E-U7-LINK-PERMUTATIONS",
    payerName: "U7 Health",
    policyNo: "U7-POL-LINK",
    memberId: "U7-MEM-LINK",
    amount: 100,
    billingProviderNpi: "1234567890",
    icd10Codes: [],
    serviceLines: [{
      cptHcpcsCode: "99213",
      units: 1,
      charge: 100,
      diagnosisPointers: ["M54.50"]
    }]
  });

  // Service line first: pointer exists but claim diagnosis does not.
  let issues = rulesFrom(await runCheck(claim.id));
  expect(issues.get("US_DIAGNOSIS_CPT_LINK")?.severity).toBe("BLOCK");

  // Diagnosis second: exact pointer now resolves.
  await updateClaim(claim.id, { icd10Codes: ["M54.50"] });
  issues = rulesFrom(await runCheck(claim.id));
  expect(issues.has("US_DIAGNOSIS_CPT_LINK")).toBe(false);

  // Change diagnosis only: old pointer becomes invalid again.
  await updateClaim(claim.id, { icd10Codes: ["E11.9"] });
  issues = rulesFrom(await runCheck(claim.id));
  expect(issues.get("US_DIAGNOSIS_CPT_LINK")?.severity).toBe("BLOCK");

  // Change pointer second: blocker resolves again.
  await updateClaim(claim.id, {
    serviceLines: [{
      cptHcpcsCode: "99213",
      units: 1,
      charge: 100,
      diagnosisPointers: ["E11.9"]
    }]
  });
  issues = rulesFrom(await runCheck(claim.id));
  expect(issues.has("US_DIAGNOSIS_CPT_LINK")).toBe(false);
});

test("U7-6 - every verified service line must link to a current claim diagnosis", async () => {
  const claim = await createClaim({
    patientName: "E2E-U7-LINK-MULTI",
    payerName: "U7 Health",
    policyNo: "U7-POL-MULTI",
    memberId: "U7-MEM-MULTI",
    amount: 200,
    billingProviderNpi: "1234567890",
    icd10Codes: ["M54.50", "E11.9"],
    serviceLines: [
      { cptHcpcsCode: "99213", units: 1, charge: 100, diagnosisPointers: ["M54.50"] },
      { cptHcpcsCode: "99214", units: 1, charge: 100, diagnosisPointers: ["Z99.9"] }
    ]
  });

  let issues = rulesFrom(await runCheck(claim.id));
  expect(issues.get("US_DIAGNOSIS_CPT_LINK")?.severity).toBe("BLOCK");
  expect(issues.get("US_DIAGNOSIS_CPT_LINK")?.field).toBe("diagnosisPointers");

  await updateClaim(claim.id, {
    serviceLines: [
      { cptHcpcsCode: "99213", units: 1, charge: 100, diagnosisPointers: ["M54.50"] },
      { cptHcpcsCode: "99214", units: 1, charge: 100, diagnosisPointers: ["E11.9"] }
    ]
  });
  issues = rulesFrom(await runCheck(claim.id));
  expect(issues.has("US_DIAGNOSIS_CPT_LINK")).toBe(false);
});
