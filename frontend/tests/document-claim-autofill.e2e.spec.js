import { test, expect } from "@playwright/test";
import { observeBrowser } from "./support/browser-observability.js";

const backendURL = "http://127.0.0.1:4101";
const email = process.env.E2E_EMAIL || "admin@hospital.com";
const password = process.env.E2E_PASSWORD || "admin123";

function buildTextPdf(lines) {
  const escapePdf = (value) =>
    String(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const textOps = lines
    .map((line, index) =>
      index === 0
        ? `72 720 Td (${escapePdf(line)}) Tj`
        : `0 -22 Td (${escapePdf(line)}) Tj`
    )
    .join("\n");
  const stream = `BT /F1 11 Tf\n${textOps}\nET\n`;
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
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += "trailer\n<< /Size 6 /Root 1 0 R >>\n";
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
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

test("document claim creation fills later insurance fields and locks completed batch", async ({ page }, testInfo) => {
  const browser = observeBrowser(page, testInfo);
  await login(page);

  const patient = "Autofill Parker Test";
  let claimId = "";

  try {
    await page.getByRole("button", { name: "Create Claim from Documents", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Create Claim from Documents" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/fill the fields it can extract safely/i)).toBeVisible();
    await expect(dialog.getByText(/Processing sequence: OCR/i)).toHaveCount(0);

    const fileInput = dialog.locator('input[type="file"]');

    await fileInput.setInputFiles([
      {
        name: "e2e-clinical-first.pdf",
        mimeType: "application/pdf",
        buffer: buildTextPdf([
          "Progress Note",
          `Patient Name: ${patient}`,
          "Hospital Name: Riverside Test Medical Center",
          "Doctor Name: Maya Test",
          "Date of Service: 10/05/2026",
          "Diagnosis: Lumbar pain",
          "ICD-10: M54.50"
        ])
      },
      {
        name: "e2e-insurance-second.pdf",
        mimeType: "application/pdf",
        buffer: buildTextPdf([
          "Insurance Card",
          `Patient Name: ${patient}`,
          "Insurance Company: Cedar Health Plan",
          "Member ID: CF-AUTO-4411",
          "Policy Number: POL-AUTO-77420",
          "Group Number: GRP-AUTO-77",
          "Subscriber ID: SUB-AUTO-4411",
          `Subscriber Name: ${patient}`,
          "Payer EDI ID: 60054",
          "Medical Record Number: MRN-AUTO-2026",
          "Patient Phone: +1 303-555-0188"
        ])
      }
    ]);

    const createButton = dialog.getByTestId("create-claim-from-documents");
    await expect(createButton).toBeEnabled();
    await createButton.click();

    await expect(dialog.getByTestId("create-claim-from-documents")).toHaveText("Claim Created");
    await expect(dialog.getByTestId("create-claim-from-documents")).toBeDisabled();

    const claims = await browserApi(page, "/api/claims");
    expect(claims.ok).toBe(true);
    const listItem = claims.data.find((item) => item.policyNo === "POL-AUTO-77420");
    expect(listItem).toBeTruthy();
    claimId = listItem.id;

    const detail = await browserApi(page, `/api/claims/${claimId}`);
    expect(detail.ok).toBe(true);
    const created = detail.data;

    expect(created.payerName).toBe("Cedar Health Plan");
    expect(created.policyNo).toBe("POL-AUTO-77420");
    expect(created.memberId).toBe("CF-AUTO-4411");
    expect(created.groupNumber).toBe("GRP-AUTO-77");
    expect(created.subscriberId).toBe("SUB-AUTO-4411");
    expect(created.subscriberName).toBe(patient);
    expect(created.payerEdiId).toBe("60054");
    expect(created.medicalRecordNumber).toBe("MRN-AUTO-2026");

    // Selecting a fresh batch is the only thing that re-enables Create.
    await fileInput.setInputFiles({
      name: "e2e-new-batch.pdf",
      mimeType: "application/pdf",
      buffer: buildTextPdf([
        "Progress Note",
        "Patient Name: E2E New Batch Patient"
      ])
    });
    await expect(dialog.getByTestId("create-claim-from-documents")).toHaveText("Create Claim");
    await expect(dialog.getByTestId("create-claim-from-documents")).toBeEnabled();

    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.goto(`/claims/${claimId}`);

    await expect(page.getByText("Policy No:", { exact: true }).locator("..")).toContainText("POL-AUTO-77420");
    await expect(page.getByText("Member ID:", { exact: true }).locator("..")).toContainText("CF-AUTO-4411");
    await expect(page.getByText("Group Number:", { exact: true }).locator("..")).toContainText("GRP-AUTO-77");
    await expect(page.getByText("Subscriber ID:", { exact: true }).locator("..")).toContainText("SUB-AUTO-4411");

    await browser.assertClean();
  } finally {
    if (claimId) {
      await browserApi(page, `/api/claims/${claimId}`, { method: "DELETE" });
    }
  }
});
