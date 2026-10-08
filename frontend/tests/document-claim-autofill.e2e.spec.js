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

async function browserUploadPdf(page, claimId, fileName, buffer) {
  const base64 = buffer.toString("base64");
  return page.evaluate(async ({ backendURL, claimId, fileName, base64 }) => {
    const token = localStorage.getItem("accessToken");
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.append("claimId", claimId);
    form.append("file", new File([bytes], fileName, { type: "application/pdf" }));

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
    await expect(dialog.getByRole("columnheader", { name: "Detected Type" })).toBeVisible();
    await expect(
      dialog.getByRole("columnheader", { name: "AI Classification Confidence" })
    ).toBeVisible();
    await expect(dialog.getByText("Progress Note", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Insurance Card", { exact: true })).toBeVisible();
    await expect(dialog.getByText("NEW", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("MERGED", { exact: true })).toHaveCount(0);
    await expect(
      dialog.getByText(/classifier is about the detected document type/i)
    ).toBeVisible();

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


test("prior-auth classification survives insurance-like fields and staff can override saved type", async ({ page }, testInfo) => {
  const browser = observeBrowser(page, testInfo);
  await login(page);

  let claimId = "";
  try {
    const created = await browserApi(page, "/api/claims", {
      method: "POST",
      body: {
        patientName: "Emma Reynolds",
        payerName: "Cedar Health Plan",
        memberId: "CF-ER-1001",
        policyNo: "POL-ER-77101",
        amount: 500
      }
    });
    expect(created.ok).toBe(true);
    claimId = created.data.id;

    const fileName = "P101_Emma_Reynolds_prior_authorization.pdf";
    const upload = await browserUploadPdf(
      page,
      claimId,
      fileName,
      buildTextPdf([
        "Prior Authorization Approval",
        "Patient Name: Emma Reynolds",
        "Payer Name: Cedar Health Plan",
        "Member ID: CF-ER-1001",
        "Group Number: GRP-2026-77",
        "Authorization Number: AUTH-ER-9001",
        "Authorization Status: APPROVED",
        "Approved Service: CPT 72148"
      ])
    );

    expect(upload.ok).toBe(true);
    expect(upload.data.type).toBe("PRIOR_AUTHORIZATION");
    expect(upload.data.suggestedType).toBe("PRIOR_AUTHORIZATION");
    expect(upload.data.identityValidation.status).toBe("MATCH");
    expect(upload.data.identityValidation.conflicts).toEqual([]);

    await page.goto(`/claims/${claimId}`);
    const row = page.getByRole("row").filter({ hasText: fileName });
    await expect(row).toBeVisible();

    const typeField = row.getByRole("combobox", { name: `Document type for ${fileName}` });
    await expect(typeField).toBeVisible();
    await typeField.click();
    await page.getByRole("option", { name: "Other", exact: true }).click();

    await expect(typeField).toHaveText("Other");

    const detailAfterManual = await browserApi(page, `/api/claims/${claimId}`);
    expect(detailAfterManual.ok).toBe(true);
    const savedDoc = detailAfterManual.data.documents.find((doc) => doc.id === upload.data.id);
    expect(savedDoc.type).toBe("OTHER");
    expect(savedDoc.suggestedType).toBe("PRIOR_AUTHORIZATION");

    await row.getByRole("button", { name: "Change the saved document type to the AI-detected type", exact: true }).click();
    await expect(typeField).toHaveText("Prior Authorization");

    // A single noisy identifier must not reject another document for the same
    // patient when the name and policy evidence agree.
    const insuranceFile = "P101_Emma_Reynolds_insurance_card.pdf";
    const insuranceUpload = await browserUploadPdf(
      page,
      claimId,
      insuranceFile,
      buildTextPdf([
        "Insurance Card",
        "Patient Name: Emma Reynolds",
        "Member ID: CF-ER-1007",
        "Policy Number: POL-ER-77101",
        "Group Number: GRP-2026-77",
        "Insurance Company: Cedar Health Plan"
      ])
    );

    expect(insuranceUpload.ok).toBe(true);
    expect(insuranceUpload.data.type).toBe("INSURANCE_CARD");
    expect(insuranceUpload.data.suggestedType).toBe("INSURANCE_CARD");
    expect(insuranceUpload.data.identityValidation.status).toBe("REVIEW");
    expect(insuranceUpload.data.identityValidation.conflicts).toEqual(["memberId"]);
    expect(insuranceUpload.data.identityValidation.matches).toContain("patientName");
    expect(insuranceUpload.data.identityValidation.matches).toContain("policyNo");

    await page.goto(`/claims/${claimId}`);
    const insuranceRow = page.getByRole("row").filter({ hasText: insuranceFile });
    await expect(insuranceRow).toBeVisible();
    await expect(
      insuranceRow.getByRole("combobox", { name: `Document type for ${insuranceFile}` })
    ).toHaveText("Insurance Card");

    await browser.assertClean();
  } finally {
    if (claimId) {
      await browserApi(page, `/api/claims/${claimId}`, { method: "DELETE" });
    }
  }
});


test("claim-centric ICD review resolves duplicate document suggestions and supports chip editing", async ({ page }, testInfo) => {
  const browser = observeBrowser(page, testInfo);
  await login(page);

  let claimId = "";
  try {
    const created = await browserApi(page, "/api/claims", {
      method: "POST",
      body: {
        patientName: "Coding Review Patient",
        payerName: "Cedar Health Plan",
        memberId: "CF-CODE-101",
        policyNo: "POL-CODE-101",
        amount: 900
      }
    });
    expect(created.ok).toBe(true);
    claimId = created.data.id;

    for (const [name, title] of [
      ["coding-note-one.pdf", "Progress Note"],
      ["coding-note-two.pdf", "Radiology Report"]
    ]) {
      const upload = await browserUploadPdf(
        page,
        claimId,
        name,
        buildTextPdf([
          title,
          "Patient Name: Coding Review Patient",
          "Member ID: CF-CODE-101",
          "Diagnosis: Lumbar radiculopathy",
          "ICD-10: M54.16",
          ...(name === "coding-note-one.pdf" ? ["CPT: 99213"] : [])
        ])
      );
      expect(upload.ok).toBe(true);
    }

    await page.goto(`/claims/${claimId}`);
    const review = page.getByTestId("claim-icd-review");
    await expect(review).toBeVisible();

    // Duplicate suggestions from two documents are shown once at claim level.
    await expect(review.getByText("1 to review", { exact: true })).toBeVisible();
    await review.getByTestId("open-icd-review").click();

    const codingDialog = page.getByRole("dialog", {
      name: "Review AI coding suggestions"
    });
    await expect(codingDialog).toBeVisible();
    await expect(codingDialog.getByTestId("pending-coding-ICD10_CM-M54.16")).toHaveCount(1);
    await expect(codingDialog.getByText(/Source:/)).toBeVisible();
    await codingDialog
      .getByTestId("pending-coding-ICD10_CM-M54.16")
      .getByRole("button", { name: "Accept", exact: true })
      .click();

    await expect(codingDialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/claims/${claimId}import { test, expect } from "@playwright/test";
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

async function browserUploadPdf(page, claimId, fileName, buffer) {
  const base64 = buffer.toString("base64");
  return page.evaluate(async ({ backendURL, claimId, fileName, base64 }) => {
    const token = localStorage.getItem("accessToken");
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.append("claimId", claimId);
    form.append("file", new File([bytes], fileName, { type: "application/pdf" }));

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
    await expect(dialog.getByRole("columnheader", { name: "Detected Type" })).toBeVisible();
    await expect(
      dialog.getByRole("columnheader", { name: "AI Classification Confidence" })
    ).toBeVisible();
    await expect(dialog.getByText("Progress Note", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Insurance Card", { exact: true })).toBeVisible();
    await expect(dialog.getByText("NEW", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("MERGED", { exact: true })).toHaveCount(0);
    await expect(
      dialog.getByText(/classifier is about the detected document type/i)
    ).toBeVisible();

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


test("prior-auth classification survives insurance-like fields and staff can override saved type", async ({ page }, testInfo) => {
  const browser = observeBrowser(page, testInfo);
  await login(page);

  let claimId = "";
  try {
    const created = await browserApi(page, "/api/claims", {
      method: "POST",
      body: {
        patientName: "Emma Reynolds",
        payerName: "Cedar Health Plan",
        memberId: "CF-ER-1001",
        policyNo: "POL-ER-77101",
        amount: 500
      }
    });
    expect(created.ok).toBe(true);
    claimId = created.data.id;

    const fileName = "P101_Emma_Reynolds_prior_authorization.pdf";
    const upload = await browserUploadPdf(
      page,
      claimId,
      fileName,
      buildTextPdf([
        "Prior Authorization Approval",
        "Patient Name: Emma Reynolds",
        "Payer Name: Cedar Health Plan",
        "Member ID: CF-ER-1001",
        "Group Number: GRP-2026-77",
        "Authorization Number: AUTH-ER-9001",
        "Authorization Status: APPROVED",
        "Approved Service: CPT 72148"
      ])
    );

    expect(upload.ok).toBe(true);
    expect(upload.data.type).toBe("PRIOR_AUTHORIZATION");
    expect(upload.data.suggestedType).toBe("PRIOR_AUTHORIZATION");
    expect(upload.data.identityValidation.status).toBe("MATCH");
    expect(upload.data.identityValidation.conflicts).toEqual([]);

    await page.goto(`/claims/${claimId}`);
    const row = page.getByRole("row").filter({ hasText: fileName });
    await expect(row).toBeVisible();

    const typeField = row.getByRole("combobox", { name: `Document type for ${fileName}` });
    await expect(typeField).toBeVisible();
    await typeField.click();
    await page.getByRole("option", { name: "Other", exact: true }).click();

    await expect(typeField).toHaveText("Other");

    const detailAfterManual = await browserApi(page, `/api/claims/${claimId}`);
    expect(detailAfterManual.ok).toBe(true);
    const savedDoc = detailAfterManual.data.documents.find((doc) => doc.id === upload.data.id);
    expect(savedDoc.type).toBe("OTHER");
    expect(savedDoc.suggestedType).toBe("PRIOR_AUTHORIZATION");

    await row.getByRole("button", { name: "Change the saved document type to the AI-detected type", exact: true }).click();
    await expect(typeField).toHaveText("Prior Authorization");

    // A single noisy identifier must not reject another document for the same
    // patient when the name and policy evidence agree.
    const insuranceFile = "P101_Emma_Reynolds_insurance_card.pdf";
    const insuranceUpload = await browserUploadPdf(
      page,
      claimId,
      insuranceFile,
      buildTextPdf([
        "Insurance Card",
        "Patient Name: Emma Reynolds",
        "Member ID: CF-ER-1007",
        "Policy Number: POL-ER-77101",
        "Group Number: GRP-2026-77",
        "Insurance Company: Cedar Health Plan"
      ])
    );

    expect(insuranceUpload.ok).toBe(true);
    expect(insuranceUpload.data.type).toBe("INSURANCE_CARD");
    expect(insuranceUpload.data.suggestedType).toBe("INSURANCE_CARD");
    expect(insuranceUpload.data.identityValidation.status).toBe("REVIEW");
    expect(insuranceUpload.data.identityValidation.conflicts).toEqual(["memberId"]);
    expect(insuranceUpload.data.identityValidation.matches).toContain("patientName");
    expect(insuranceUpload.data.identityValidation.matches).toContain("policyNo");

    await page.goto(`/claims/${claimId}`);
    const insuranceRow = page.getByRole("row").filter({ hasText: insuranceFile });
    await expect(insuranceRow).toBeVisible();
    await expect(
      insuranceRow.getByRole("combobox", { name: `Document type for ${insuranceFile}` })
    ).toHaveText("Insurance Card");

    await browser.assertClean();
  } finally {
    if (claimId) {
      await browserApi(page, `/api/claims/${claimId}`, { method: "DELETE" });
    }
  }
});


test("claim-centric ICD review resolves duplicate document suggestions and supports chip editing", async ({ page }, testInfo) => {
  const browser = observeBrowser(page, testInfo);
  await login(page);

  let claimId = "";
  try {
    const created = await browserApi(page, "/api/claims", {
      method: "POST",
      body: {
        patientName: "Coding Review Patient",
        payerName: "Cedar Health Plan",
        memberId: "CF-CODE-101",
        policyNo: "POL-CODE-101",
        amount: 900
      }
    });
    expect(created.ok).toBe(true);
    claimId = created.data.id;

    for (const [name, title] of [
      ["coding-note-one.pdf", "Progress Note"],
      ["coding-note-two.pdf", "Radiology Report"]
    ]) {
      const upload = await browserUploadPdf(
        page,
        claimId,
        name,
        buildTextPdf([
          title,
          "Patient Name: Coding Review Patient",
          "Member ID: CF-CODE-101",
          "Diagnosis: Lumbar radiculopathy",
          "ICD-10: M54.16",
          ...(name === "coding-note-one.pdf" ? ["CPT: 99213"] : [])
        ])
      );
      expect(upload.ok).toBe(true);
    }

    await page.goto(`/claims/${claimId}`);
    const review = page.getByTestId("claim-icd-review");
    await expect(review).toBeVisible();

    // Duplicate suggestions from two documents are shown once at claim level.
    await expect(review.getByText("1 to review", { exact: true })).toBeVisible();
    await review.getByTestId("open-icd-review").click();

    const codingDialog = page.getByRole("dialog", {
      name: "Review AI coding suggestions"
    });
    await expect(codingDialog).toBeVisible();
    await expect(codingDialog.getByTestId("pending-coding-ICD10_CM-M54.16")).toHaveCount(1);
    await expect(codingDialog.getByText(/Source:/)).toBeVisible();
    await codingDialog
      .getByTestId("pending-coding-ICD10_CM-M54.16")
      .getByRole("button", { name: "Accept", exact: true })
      .click();

));
    await expect(review.getByTestId("accepted-icd-M54.16")).toBeVisible();

    let detail = await browserApi(page, `/api/claims/${claimId}`);
    expect(detail.ok).toBe(true);
    expect(detail.data.icd10Codes).toContain("M54.16");

    const procedureButton = page.getByTestId("open-procedure-coding-review");
    await expect(procedureButton).toBeVisible();
    await procedureButton.click();

    const procedureDialog = page.getByRole("dialog", {
      name: "Review AI coding suggestions"
    });
    await expect(
      procedureDialog.getByTestId("pending-coding-CPT-99213")
    ).toBeVisible();
    await procedureDialog
      .getByTestId("pending-coding-CPT-99213")
      .getByRole("button", { name: "Accept", exact: true })
      .click();

    await expect(procedureDialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/claims/${claimId}import { test, expect } from "@playwright/test";
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

async function browserUploadPdf(page, claimId, fileName, buffer) {
  const base64 = buffer.toString("base64");
  return page.evaluate(async ({ backendURL, claimId, fileName, base64 }) => {
    const token = localStorage.getItem("accessToken");
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.append("claimId", claimId);
    form.append("file", new File([bytes], fileName, { type: "application/pdf" }));

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
    await expect(dialog.getByRole("columnheader", { name: "Detected Type" })).toBeVisible();
    await expect(
      dialog.getByRole("columnheader", { name: "AI Classification Confidence" })
    ).toBeVisible();
    await expect(dialog.getByText("Progress Note", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Insurance Card", { exact: true })).toBeVisible();
    await expect(dialog.getByText("NEW", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("MERGED", { exact: true })).toHaveCount(0);
    await expect(
      dialog.getByText(/classifier is about the detected document type/i)
    ).toBeVisible();

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


test("prior-auth classification survives insurance-like fields and staff can override saved type", async ({ page }, testInfo) => {
  const browser = observeBrowser(page, testInfo);
  await login(page);

  let claimId = "";
  try {
    const created = await browserApi(page, "/api/claims", {
      method: "POST",
      body: {
        patientName: "Emma Reynolds",
        payerName: "Cedar Health Plan",
        memberId: "CF-ER-1001",
        policyNo: "POL-ER-77101",
        amount: 500
      }
    });
    expect(created.ok).toBe(true);
    claimId = created.data.id;

    const fileName = "P101_Emma_Reynolds_prior_authorization.pdf";
    const upload = await browserUploadPdf(
      page,
      claimId,
      fileName,
      buildTextPdf([
        "Prior Authorization Approval",
        "Patient Name: Emma Reynolds",
        "Payer Name: Cedar Health Plan",
        "Member ID: CF-ER-1001",
        "Group Number: GRP-2026-77",
        "Authorization Number: AUTH-ER-9001",
        "Authorization Status: APPROVED",
        "Approved Service: CPT 72148"
      ])
    );

    expect(upload.ok).toBe(true);
    expect(upload.data.type).toBe("PRIOR_AUTHORIZATION");
    expect(upload.data.suggestedType).toBe("PRIOR_AUTHORIZATION");
    expect(upload.data.identityValidation.status).toBe("MATCH");
    expect(upload.data.identityValidation.conflicts).toEqual([]);

    await page.goto(`/claims/${claimId}`);
    const row = page.getByRole("row").filter({ hasText: fileName });
    await expect(row).toBeVisible();

    const typeField = row.getByRole("combobox", { name: `Document type for ${fileName}` });
    await expect(typeField).toBeVisible();
    await typeField.click();
    await page.getByRole("option", { name: "Other", exact: true }).click();

    await expect(typeField).toHaveText("Other");

    const detailAfterManual = await browserApi(page, `/api/claims/${claimId}`);
    expect(detailAfterManual.ok).toBe(true);
    const savedDoc = detailAfterManual.data.documents.find((doc) => doc.id === upload.data.id);
    expect(savedDoc.type).toBe("OTHER");
    expect(savedDoc.suggestedType).toBe("PRIOR_AUTHORIZATION");

    await row.getByRole("button", { name: "Change the saved document type to the AI-detected type", exact: true }).click();
    await expect(typeField).toHaveText("Prior Authorization");

    // A single noisy identifier must not reject another document for the same
    // patient when the name and policy evidence agree.
    const insuranceFile = "P101_Emma_Reynolds_insurance_card.pdf";
    const insuranceUpload = await browserUploadPdf(
      page,
      claimId,
      insuranceFile,
      buildTextPdf([
        "Insurance Card",
        "Patient Name: Emma Reynolds",
        "Member ID: CF-ER-1007",
        "Policy Number: POL-ER-77101",
        "Group Number: GRP-2026-77",
        "Insurance Company: Cedar Health Plan"
      ])
    );

    expect(insuranceUpload.ok).toBe(true);
    expect(insuranceUpload.data.type).toBe("INSURANCE_CARD");
    expect(insuranceUpload.data.suggestedType).toBe("INSURANCE_CARD");
    expect(insuranceUpload.data.identityValidation.status).toBe("REVIEW");
    expect(insuranceUpload.data.identityValidation.conflicts).toEqual(["memberId"]);
    expect(insuranceUpload.data.identityValidation.matches).toContain("patientName");
    expect(insuranceUpload.data.identityValidation.matches).toContain("policyNo");

    await page.goto(`/claims/${claimId}`);
    const insuranceRow = page.getByRole("row").filter({ hasText: insuranceFile });
    await expect(insuranceRow).toBeVisible();
    await expect(
      insuranceRow.getByRole("combobox", { name: `Document type for ${insuranceFile}` })
    ).toHaveText("Insurance Card");

    await browser.assertClean();
  } finally {
    if (claimId) {
      await browserApi(page, `/api/claims/${claimId}`, { method: "DELETE" });
    }
  }
});


test("claim-centric ICD review resolves duplicate document suggestions and supports chip editing", async ({ page }, testInfo) => {
  const browser = observeBrowser(page, testInfo);
  await login(page);

  let claimId = "";
  try {
    const created = await browserApi(page, "/api/claims", {
      method: "POST",
      body: {
        patientName: "Coding Review Patient",
        payerName: "Cedar Health Plan",
        memberId: "CF-CODE-101",
        policyNo: "POL-CODE-101",
        amount: 900
      }
    });
    expect(created.ok).toBe(true);
    claimId = created.data.id;

    for (const [name, title] of [
      ["coding-note-one.pdf", "Progress Note"],
      ["coding-note-two.pdf", "Radiology Report"]
    ]) {
      const upload = await browserUploadPdf(
        page,
        claimId,
        name,
        buildTextPdf([
          title,
          "Patient Name: Coding Review Patient",
          "Member ID: CF-CODE-101",
          "Diagnosis: Lumbar radiculopathy",
          "ICD-10: M54.16",
          ...(name === "coding-note-one.pdf" ? ["CPT: 99213"] : [])
        ])
      );
      expect(upload.ok).toBe(true);
    }

    await page.goto(`/claims/${claimId}`);
    const review = page.getByTestId("claim-icd-review");
    await expect(review).toBeVisible();

    // Duplicate suggestions from two documents are shown once at claim level.
    await expect(review.getByText("1 to review", { exact: true })).toBeVisible();
    await review.getByTestId("open-icd-review").click();

    const codingDialog = page.getByRole("dialog", {
      name: "Review AI coding suggestions"
    });
    await expect(codingDialog).toBeVisible();
    await expect(codingDialog.getByTestId("pending-coding-ICD10_CM-M54.16")).toHaveCount(1);
    await expect(codingDialog.getByText(/Source:/)).toBeVisible();
    await codingDialog
      .getByTestId("pending-coding-ICD10_CM-M54.16")
      .getByRole("button", { name: "Accept", exact: true })
      .click();

    await expect(codingDialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/claims/${claimId}import { test, expect } from "@playwright/test";
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

async function browserUploadPdf(page, claimId, fileName, buffer) {
  const base64 = buffer.toString("base64");
  return page.evaluate(async ({ backendURL, claimId, fileName, base64 }) => {
    const token = localStorage.getItem("accessToken");
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.append("claimId", claimId);
    form.append("file", new File([bytes], fileName, { type: "application/pdf" }));

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
    await expect(dialog.getByRole("columnheader", { name: "Detected Type" })).toBeVisible();
    await expect(
      dialog.getByRole("columnheader", { name: "AI Classification Confidence" })
    ).toBeVisible();
    await expect(dialog.getByText("Progress Note", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Insurance Card", { exact: true })).toBeVisible();
    await expect(dialog.getByText("NEW", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("MERGED", { exact: true })).toHaveCount(0);
    await expect(
      dialog.getByText(/classifier is about the detected document type/i)
    ).toBeVisible();

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


test("prior-auth classification survives insurance-like fields and staff can override saved type", async ({ page }, testInfo) => {
  const browser = observeBrowser(page, testInfo);
  await login(page);

  let claimId = "";
  try {
    const created = await browserApi(page, "/api/claims", {
      method: "POST",
      body: {
        patientName: "Emma Reynolds",
        payerName: "Cedar Health Plan",
        memberId: "CF-ER-1001",
        policyNo: "POL-ER-77101",
        amount: 500
      }
    });
    expect(created.ok).toBe(true);
    claimId = created.data.id;

    const fileName = "P101_Emma_Reynolds_prior_authorization.pdf";
    const upload = await browserUploadPdf(
      page,
      claimId,
      fileName,
      buildTextPdf([
        "Prior Authorization Approval",
        "Patient Name: Emma Reynolds",
        "Payer Name: Cedar Health Plan",
        "Member ID: CF-ER-1001",
        "Group Number: GRP-2026-77",
        "Authorization Number: AUTH-ER-9001",
        "Authorization Status: APPROVED",
        "Approved Service: CPT 72148"
      ])
    );

    expect(upload.ok).toBe(true);
    expect(upload.data.type).toBe("PRIOR_AUTHORIZATION");
    expect(upload.data.suggestedType).toBe("PRIOR_AUTHORIZATION");
    expect(upload.data.identityValidation.status).toBe("MATCH");
    expect(upload.data.identityValidation.conflicts).toEqual([]);

    await page.goto(`/claims/${claimId}`);
    const row = page.getByRole("row").filter({ hasText: fileName });
    await expect(row).toBeVisible();

    const typeField = row.getByRole("combobox", { name: `Document type for ${fileName}` });
    await expect(typeField).toBeVisible();
    await typeField.click();
    await page.getByRole("option", { name: "Other", exact: true }).click();

    await expect(typeField).toHaveText("Other");

    const detailAfterManual = await browserApi(page, `/api/claims/${claimId}`);
    expect(detailAfterManual.ok).toBe(true);
    const savedDoc = detailAfterManual.data.documents.find((doc) => doc.id === upload.data.id);
    expect(savedDoc.type).toBe("OTHER");
    expect(savedDoc.suggestedType).toBe("PRIOR_AUTHORIZATION");

    await row.getByRole("button", { name: "Change the saved document type to the AI-detected type", exact: true }).click();
    await expect(typeField).toHaveText("Prior Authorization");

    // A single noisy identifier must not reject another document for the same
    // patient when the name and policy evidence agree.
    const insuranceFile = "P101_Emma_Reynolds_insurance_card.pdf";
    const insuranceUpload = await browserUploadPdf(
      page,
      claimId,
      insuranceFile,
      buildTextPdf([
        "Insurance Card",
        "Patient Name: Emma Reynolds",
        "Member ID: CF-ER-1007",
        "Policy Number: POL-ER-77101",
        "Group Number: GRP-2026-77",
        "Insurance Company: Cedar Health Plan"
      ])
    );

    expect(insuranceUpload.ok).toBe(true);
    expect(insuranceUpload.data.type).toBe("INSURANCE_CARD");
    expect(insuranceUpload.data.suggestedType).toBe("INSURANCE_CARD");
    expect(insuranceUpload.data.identityValidation.status).toBe("REVIEW");
    expect(insuranceUpload.data.identityValidation.conflicts).toEqual(["memberId"]);
    expect(insuranceUpload.data.identityValidation.matches).toContain("patientName");
    expect(insuranceUpload.data.identityValidation.matches).toContain("policyNo");

    await page.goto(`/claims/${claimId}`);
    const insuranceRow = page.getByRole("row").filter({ hasText: insuranceFile });
    await expect(insuranceRow).toBeVisible();
    await expect(
      insuranceRow.getByRole("combobox", { name: `Document type for ${insuranceFile}` })
    ).toHaveText("Insurance Card");

    await browser.assertClean();
  } finally {
    if (claimId) {
      await browserApi(page, `/api/claims/${claimId}`, { method: "DELETE" });
    }
  }
});


test("claim-centric ICD review resolves duplicate document suggestions and supports chip editing", async ({ page }, testInfo) => {
  const browser = observeBrowser(page, testInfo);
  await login(page);

  let claimId = "";
  try {
    const created = await browserApi(page, "/api/claims", {
      method: "POST",
      body: {
        patientName: "Coding Review Patient",
        payerName: "Cedar Health Plan",
        memberId: "CF-CODE-101",
        policyNo: "POL-CODE-101",
        amount: 900
      }
    });
    expect(created.ok).toBe(true);
    claimId = created.data.id;

    for (const [name, title] of [
      ["coding-note-one.pdf", "Progress Note"],
      ["coding-note-two.pdf", "Radiology Report"]
    ]) {
      const upload = await browserUploadPdf(
        page,
        claimId,
        name,
        buildTextPdf([
          title,
          "Patient Name: Coding Review Patient",
          "Member ID: CF-CODE-101",
          "Diagnosis: Lumbar radiculopathy",
          "ICD-10: M54.16",
          ...(name === "coding-note-one.pdf" ? ["CPT: 99213"] : [])
        ])
      );
      expect(upload.ok).toBe(true);
    }

    await page.goto(`/claims/${claimId}`);
    const review = page.getByTestId("claim-icd-review");
    await expect(review).toBeVisible();

    // Duplicate suggestions from two documents are shown once at claim level.
    await expect(review.getByText("1 to review", { exact: true })).toBeVisible();
    await review.getByTestId("open-icd-review").click();

    const codingDialog = page.getByRole("dialog", {
      name: "Review AI coding suggestions"
    });
    await expect(codingDialog).toBeVisible();
    await expect(codingDialog.getByTestId("pending-coding-ICD10_CM-M54.16")).toHaveCount(1);
    await expect(codingDialog.getByText(/Source:/)).toBeVisible();
    await codingDialog
      .getByTestId("pending-coding-ICD10_CM-M54.16")
      .getByRole("button", { name: "Accept", exact: true })
      .click();

));
    await expect(review.getByTestId("accepted-icd-M54.16")).toBeVisible();

    let detail = await browserApi(page, `/api/claims/${claimId}`);
    expect(detail.ok).toBe(true);
));

    detail = await browserApi(page, `/api/claims/${claimId}`);
    expect(detail.ok).toBe(true);
    expect(
      detail.data.serviceLines.some(
        (line) => line.cptHcpcsCode === "99213" && line.verified === true
      )
    ).toBe(true);
    expect(detail.data.codingSuggestions.filter((item) => item.status === "PENDING")).toHaveLength(0);

    // Both source documents immediately reflect that there is nothing left to review.
    await page.goto(`/documents?claimId=${claimId}`);
    await expect(page.getByText("Reviewed", { exact: true })).toHaveCount(2);
    await expect(page.getByRole("button", { name: /Review \d+/ })).toHaveCount(0);

    // Claim Details supports direct removal and Enter-to-add.
    await page.goto(`/claims/${claimId}`);
    const acceptedChip = page.getByTestId("accepted-icd-M54.16");
    await acceptedChip.locator("svg").click();
    await expect(page.getByTestId("accepted-icd-M54.16")).toHaveCount(0);

    const addInput = page.getByRole("textbox", { name: "Add ICD-10 code" });
    await addInput.fill("Z00.00");
    await addInput.press("Enter");
    await expect(page.getByTestId("accepted-icd-Z00.00")).toBeVisible();

    detail = await browserApi(page, `/api/claims/${claimId}`);
    expect(detail.ok).toBe(true);
    expect(detail.data.icd10Codes).toEqual(["Z00.00"]);

    await browser.assertClean();
  } finally {
    if (claimId) {
      await browserApi(page, `/api/claims/${claimId}`, { method: "DELETE" });
    }
  }
});
