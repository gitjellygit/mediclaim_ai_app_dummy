import { test, expect, request } from "@playwright/test";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

let apiContext;
let auth;
const createdClaimIds = [];

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
});

test.afterAll(async () => {
  for (const id of createdClaimIds) {
    await apiContext.delete(`/api/claims/${id}`, {
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

test("U4-1 - 837P professional claim requires rendering NPI", async ({ page }) => {
  await page.goto("/claims/new");

  await page.getByLabel("Claim Form").click();
  await page.getByRole("option", { name: "Professional (837P)" }).click();

  await page.getByLabel("Patient Name").fill("E2E-U4-PROFESSIONAL");
  await page.getByLabel("Billing Provider NPI").fill("1234567890");

  await expect(page.getByLabel("Rendering Provider NPI")).toBeVisible();
  await expect(page.getByLabel("Referring Provider NPI")).toBeVisible();

  await page.getByRole("button", { name: "Next" }).click();
  await expect(
    page.getByText("Rendering provider NPI is required for 837P", { exact: true })
  ).toBeVisible();

  await page.getByLabel("Rendering Provider NPI").fill("1987654321");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByLabel("Diagnosis")).toBeVisible();
});

test("U4-2 - 837I institutional claim hides rendering NPI and requires Type of Bill + revenue code", async ({ page }) => {
  await page.goto("/claims/new");

  await page.getByLabel("Claim Form").click();
  await page.getByRole("option", { name: "Institutional (837I)" }).click();

  await page.getByLabel("Patient Name").fill("E2E-U4-INSTITUTIONAL");
  await page.getByLabel("Billing Provider NPI").fill("1234567890");

  await expect(page.getByLabel("Rendering Provider NPI")).toHaveCount(0);
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Insurance Company").fill("Institutional Health");
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Total Billed Amount (USD)").fill("500");
  await page.getByLabel("Total Claimed Amount (USD)").fill("450");

  await page.getByRole("button", { name: "Add Service Line" }).click();
  await page.getByLabel("CPT / HCPCS").fill("0450");
  await page.getByLabel("Units").fill("1");
  await page.getByLabel("Charge (USD)").fill("450");

  await page.getByRole("button", { name: "Next" }).click();

  await expect(
    page.getByText("Type of Bill is required for 837I", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Revenue Code is required on every 837I service line", { exact: true })
  ).toBeVisible();

  await page.getByLabel("Type of Bill").fill("131");
  await page.getByLabel("Revenue Code").fill("0450");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText(/Claim Form:/).locator("..")).toContainText("Institutional (837I)");
});

test("U4-3 - readiness applies form-specific blockers only to explicitly classified claims", async () => {
  const create = async (data) => {
    const response = await apiContext.post("/api/claims", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data
    });
    const claim = await apiJson(response, "claim create");
    createdClaimIds.push(claim.id);
    return claim;
  };

  const professional = await create({
    patientName: "E2E-U4-READINESS-P",
    payerName: "U4 Health",
    policyNo: "U4-POL-P",
    amount: 100,
    claimForm: "PROFESSIONAL"
  });

  const institutional = await create({
    patientName: "E2E-U4-READINESS-I",
    payerName: "U4 Health",
    policyNo: "U4-POL-I",
    amount: 100,
    claimForm: "INSTITUTIONAL"
  });

  const runCheck = async (claimId) => {
    const response = await apiContext.post(`/api/claims/${claimId}/check`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: {}
    });
    return apiJson(response, "claim readiness");
  };

  const professionalCheck = await runCheck(professional.id);
  const pMessages = professionalCheck.issues.map((issue) => issue.message);
  expect(pMessages).toContain("837P professional claim requires billing provider NPI");
  expect(pMessages).toContain("837P professional claim requires rendering provider NPI");
  expect(pMessages).toContain("837P professional claim requires at least one CPT/HCPCS service line");
  expect(pMessages.some((message) => message.includes("837I institutional"))).toBeFalsy();

  const institutionalCheck = await runCheck(institutional.id);
  const iMessages = institutionalCheck.issues.map((issue) => issue.message);
  expect(iMessages).toContain("837I institutional claim requires billing provider NPI");
  expect(iMessages).toContain("837I institutional claim requires Type of Bill");
  expect(iMessages).toContain("837I institutional claim requires at least one service line");
  expect(iMessages.some((message) => message.includes("837P professional"))).toBeFalsy();
});


test("U4-4 - valid 837P data removes all professional claim-form blockers", async () => {
  const response = await apiContext.post("/api/claims", {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {
      patientName: "E2E-U4-HAPPY-P",
      payerName: "U4 Health",
      policyNo: "U4-HAPPY-POL-P",
      amount: 150,
      claimForm: "PROFESSIONAL",
      billingProviderNpi: "1234567890",
      renderingProviderNpi: "1987654321",
      icd10Codes: ["M54.50"],
      serviceLines: [
        {
          cptHcpcsCode: "99213",
          units: 1,
          charge: 150,
          diagnosisPointers: ["M54.50"],
          placeOfService: "11"
        }
      ]
    }
  });
  const claim = await apiJson(response, "837P happy-path create");
  createdClaimIds.push(claim.id);

  const checkResponse = await apiContext.post(`/api/claims/${claim.id}/check`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {}
  });
  const check = await apiJson(checkResponse, "837P happy-path readiness");
  const formIssues = check.issues.filter((issue) => issue.source === "CLAIM_FORM");

  expect(formIssues).toEqual([]);
});

test("U4-5 - valid 837I data removes all institutional claim-form blockers", async () => {
  const response = await apiContext.post("/api/claims", {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {
      patientName: "E2E-U4-HAPPY-I",
      payerName: "U4 Health",
      policyNo: "U4-HAPPY-POL-I",
      amount: 250,
      claimForm: "INSTITUTIONAL",
      billingProviderNpi: "1234567890",
      typeOfBill: "131",
      icd10Codes: ["J18.9"],
      serviceLines: [
        {
          cptHcpcsCode: "0450",
          units: 1,
          charge: 250,
          diagnosisPointers: ["J18.9"],
          revenueCode: "0450"
        }
      ]
    }
  });
  const claim = await apiJson(response, "837I happy-path create");
  createdClaimIds.push(claim.id);

  const checkResponse = await apiContext.post(`/api/claims/${claim.id}/check`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {}
  });
  const check = await apiJson(checkResponse, "837I happy-path readiness");
  const formIssues = check.issues.filter((issue) => issue.source === "CLAIM_FORM");

  expect(formIssues).toEqual([]);
});

test("U4-6 - API accepts only PROFESSIONAL or INSTITUTIONAL claimForm values", async () => {
  for (const claimForm of ["PROFESSIONAL", "INSTITUTIONAL"]) {
    const response = await apiContext.post("/api/claims", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      data: {
        patientName: `E2E-U4-VALID-${claimForm}`,
        payerName: "U4 Health",
        policyNo: `U4-${claimForm}`,
        amount: 100,
        claimForm
      }
    });

    const claim = await apiJson(response, `${claimForm} create`);
    createdClaimIds.push(claim.id);
    expect(claim.claimForm).toBe(claimForm);
  }

  const invalid = await apiContext.post("/api/claims", {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {
      patientName: "E2E-U4-INVALID-FORM",
      payerName: "U4 Health",
      amount: 100,
      claimForm: "DENTAL_837D"
    }
  });

  expect(invalid.status()).toBe(400);
  const body = await invalid.json();
  expect(body.code).toBe("INVALID_CLAIM_INPUT");
});

test("U4-7 - legacy claim without claimForm remains compatible and gets no form-specific blockers", async () => {
  const response = await apiContext.post("/api/claims", {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {
      patientName: "E2E-U4-LEGACY-NULL",
      payerName: "Legacy Health",
      policyNo: "LEGACY-POL-1",
      amount: 100
    }
  });
  const claim = await apiJson(response, "legacy claim create");
  createdClaimIds.push(claim.id);

  expect(claim.claimForm).toBeNull();

  const detailResponse = await apiContext.get(`/api/claims/${claim.id}`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` }
  });
  const detail = await apiJson(detailResponse, "legacy claim detail");
  expect(detail.claimForm).toBeNull();

  const checkResponse = await apiContext.post(`/api/claims/${claim.id}/check`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {}
  });
  const check = await apiJson(checkResponse, "legacy claim readiness");

  expect(check.issues.some((issue) => issue.source === "CLAIM_FORM")).toBeFalsy();
  expect(
    check.issues.some((issue) => /837P|837I/.test(issue.message))
  ).toBeFalsy();
});

test("U4-8 - switching 837P to 837I preserves shared provider coverage and service-line data", async () => {
  const createResponse = await apiContext.post("/api/claims", {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {
      patientName: "E2E-U4-SWITCH-P-TO-I",
      payerName: "Switch Health",
      policyNo: "SWITCH-POL-1",
      memberId: "SWITCH-MEMBER-1",
      groupNumber: "SWITCH-GROUP-1",
      subscriberId: "SWITCH-SUB-1",
      amount: 400,
      totalBilledAmount: 450,
      claimForm: "PROFESSIONAL",
      claimType: "PROVIDER_BILLED",
      billingProviderNpi: "1234567890",
      renderingProviderNpi: "1987654321",
      providerTin: "91-1234567",
      providerTaxonomyCode: "207Q00000X",
      icd10Codes: ["M54.50"],
      serviceLines: [
        {
          cptHcpcsCode: "99214",
          modifiers: ["25"],
          units: 1,
          charge: 400,
          diagnosisPointers: ["M54.50"],
          placeOfService: "11",
          revenueCode: "0510"
        }
      ]
    }
  });
  const created = await apiJson(createResponse, "switch claim create");
  createdClaimIds.push(created.id);

  const patchResponse = await apiContext.patch(`/api/claims/${created.id}`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {
      patientName: created.patientName,
      payerName: created.payerName,
      policyNo: created.policyNo,
      memberId: created.memberId,
      groupNumber: created.groupNumber,
      subscriberId: created.subscriberId,
      amount: Number(created.amount),
      totalBilledAmount: Number(created.totalBilledAmount),
      claimType: created.claimType,
      claimForm: "INSTITUTIONAL",
      billingProviderNpi: created.billingProviderNpi,
      renderingProviderNpi: created.renderingProviderNpi,
      providerTin: created.providerTin,
      providerTaxonomyCode: created.providerTaxonomyCode,
      icd10Codes: created.icd10Codes,
      typeOfBill: "131",
      serviceLines: created.serviceLines.map((line) => ({
        cptHcpcsCode: line.cptHcpcsCode,
        modifiers: line.modifiers,
        units: Number(line.units),
        charge: Number(line.charge),
        diagnosisPointers: line.diagnosisPointers,
        placeOfService: line.placeOfService,
        revenueCode: line.revenueCode
      }))
    }
  });
  const updated = await apiJson(patchResponse, "switch claim update");

  expect(updated.claimForm).toBe("INSTITUTIONAL");
  expect(updated.billingProviderNpi).toBe("1234567890");
  expect(updated.renderingProviderNpi).toBe("1987654321");
  expect(updated.providerTin).toBe("91-1234567");
  expect(updated.groupNumber).toBe("SWITCH-GROUP-1");
  expect(updated.subscriberId).toBe("SWITCH-SUB-1");
  expect(updated.serviceLines).toHaveLength(1);
  expect(updated.serviceLines[0].cptHcpcsCode).toBe("99214");
  expect(updated.serviceLines[0].placeOfService).toBe("11");
  expect(updated.serviceLines[0].revenueCode).toBe("0510");
});

test("U4-9 - switching 837I back to 837P changes readiness rules without deleting shared data", async () => {
  const createResponse = await apiContext.post("/api/claims", {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {
      patientName: "E2E-U4-SWITCH-I-TO-P",
      payerName: "Switch Health",
      policyNo: "SWITCH-POL-2",
      amount: 300,
      claimForm: "INSTITUTIONAL",
      billingProviderNpi: "1234567890",
      renderingProviderNpi: "1987654321",
      typeOfBill: "131",
      serviceLines: [
        {
          cptHcpcsCode: "99213",
          units: 1,
          charge: 300,
          placeOfService: "11",
          revenueCode: "0510"
        }
      ]
    }
  });
  const created = await apiJson(createResponse, "reverse switch create");
  createdClaimIds.push(created.id);

  const patchResponse = await apiContext.patch(`/api/claims/${created.id}`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {
      patientName: created.patientName,
      payerName: created.payerName,
      policyNo: created.policyNo,
      amount: Number(created.amount),
      claimForm: "PROFESSIONAL",
      billingProviderNpi: created.billingProviderNpi,
      renderingProviderNpi: created.renderingProviderNpi,
      typeOfBill: created.typeOfBill,
      serviceLines: created.serviceLines.map((line) => ({
        cptHcpcsCode: line.cptHcpcsCode,
        units: Number(line.units),
        charge: Number(line.charge),
        placeOfService: line.placeOfService,
        revenueCode: line.revenueCode
      }))
    }
  });
  const updated = await apiJson(patchResponse, "reverse switch update");

  expect(updated.claimForm).toBe("PROFESSIONAL");
  expect(updated.typeOfBill).toBe("131");
  expect(updated.serviceLines[0].revenueCode).toBe("0510");
  expect(updated.serviceLines[0].placeOfService).toBe("11");

  const checkResponse = await apiContext.post(`/api/claims/${created.id}/check`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    data: {}
  });
  const check = await apiJson(checkResponse, "reverse switch readiness");
  const formMessages = check.issues
    .filter((issue) => issue.source === "CLAIM_FORM")
    .map((issue) => issue.message);

  expect(formMessages.some((message) => message.includes("837I institutional"))).toBeFalsy();
  expect(formMessages).not.toContain("837P professional claim requires rendering provider NPI");
  expect(formMessages).not.toContain("837P professional service lines require Place of Service");
});
