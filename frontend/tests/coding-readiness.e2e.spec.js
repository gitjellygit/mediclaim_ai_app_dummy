import { test, expect } from "@playwright/test";
import { observeBrowser } from "./support/browser-observability.js";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

function buildTextPdfBase64(lines) {
  const escapePdf = (value) =>
    String(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const textOps = lines
    .map((line, index) =>
      index === 0
        ? `72 720 Td (${escapePdf(line)}) Tj`
        : `0 -24 Td (${escapePdf(line)}) Tj`
    )
    .join("\n");
  const stream = `BT /F1 12 Tf\n${textOps}\nET\n`;

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += "xref\n0 6\n";
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= 5; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += "trailer\n<< /Size 6 /Root 1 0 R >>\n";
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8").toString("base64");
}

async function login(page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/claims/);
}

async function browserApi(page, path, { method = "GET", body } = {}) {
  return page.evaluate(async ({ backendURL, path, method, body }) => {
    const token = localStorage.getItem("accessToken");
    const response = await fetch(`${backendURL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      data: text ? JSON.parse(text) : null
    };
  }, { backendURL, path, method, body });
}

async function uploadPdf(page, claimId, fileName, base64) {
  return page.evaluate(async ({ backendURL, claimId, fileName, base64 }) => {
    const token = localStorage.getItem("accessToken");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

    const form = new FormData();
    form.append("claimId", claimId);
    form.append("file", new Blob([bytes], { type: "application/pdf" }), fileName);

    const response = await fetch(`${backendURL}/api/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      credentials: "include",
      body: form
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      data: text ? JSON.parse(text) : null
    };
  }, { backendURL, claimId, fileName, base64 });
}

test("document coding Accept flows into readiness and requires valid diagnosis linkage", async ({ page }, testInfo) => {
  const browser = observeBrowser(page, testInfo);
  await login(page);

  const created = await browserApi(page, "/api/claims", {
    method: "POST",
    body: {
      patientName: "E2E Coding Readiness",
      payerName: "Coding Health",
      policyNo: "CODING-READY-1",
      memberId: "CODING-MEMBER-1",
      amount: 100,
      billingProviderNpi: "1234567890"
    }
  });
  expect(created.ok).toBe(true);
  const claimId = created.data.id;
  const fileName = "coding-readiness-e2e.pdf";

  try {
    const uploaded = await uploadPdf(
      page,
      claimId,
      fileName,
      buildTextPdfBase64([
        "Clinical note",
        "ICD-10: M54.50",
        "CPT: 99213"
      ])
    );
    expect(uploaded.ok).toBe(true);

    await page.goto("/documents");
    const row = page.getByRole("row").filter({ hasText: fileName });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /Review 2/i }).click();

    const icdCard = page.getByTestId("coding-suggestion-ICD10_CM-M54.50");
    const cptCard = page.getByTestId("coding-suggestion-CPT-99213");
    await expect(icdCard).toBeVisible();
    await expect(cptCard).toBeVisible();

    await icdCard.getByRole("button", { name: "Accept" }).click();
    await expect(icdCard.getByText("ACCEPTED", { exact: true })).toBeVisible();

    await cptCard.getByRole("button", { name: "Accept" }).click();
    await expect(cptCard.getByText("ACCEPTED", { exact: true })).toBeVisible();

    // Accepted ICD and CPT now exist on the claim, but the new service line has
    // not yet been linked to the diagnosis. Readiness must catch that exact gap.
    await page.goto(`/claims/${claimId}`);
    await page.getByRole("button", { name: "Check Readiness" }).click();
    const linkIssue = page.getByTestId("readiness-issue-US_DIAGNOSIS_CPT_LINK");
    await expect(linkIssue).toBeVisible();

    await linkIssue.getByRole("button", { name: "Edit Service Line" }).click();
    const pointer = page.getByLabel("Linked Diagnosis Codes").first();
    await pointer.fill("M54.50");
    await expect(page.getByText(/not one of the claim ICD-10 codes/i)).toHaveCount(0);
    await page.getByRole("button", { name: "Save", exact: true }).first().click();

    await expect(page.getByTestId("readiness-stale")).toBeVisible();
    await expect(page.getByTestId("readiness-issue-US_DIAGNOSIS_CPT_LINK")).toHaveCount(0);

    await page.getByRole("button", { name: "Recheck Readiness" }).click();
    await expect(page.getByTestId("readiness-issue-US_DIAGNOSIS_CPT_LINK")).toHaveCount(0);

    const persisted = await browserApi(page, `/api/claims/${claimId}`);
    expect(persisted.ok).toBe(true);
    expect(persisted.data.icd10Codes).toContain("M54.50");
    expect(persisted.data.serviceLines.some(
      (line) =>
        line.cptHcpcsCode === "99213" &&
        Array.isArray(line.diagnosisPointers) &&
        line.diagnosisPointers.includes("M54.50")
    )).toBe(true);

    await page.reload();
    await expect(page.getByTestId("readiness-issue-US_DIAGNOSIS_CPT_LINK")).toHaveCount(0);
    await browser.assertClean();
  } finally {
    await browserApi(page, `/api/claims/${claimId}`, { method: "DELETE" });
  }
});
