import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import {
  recomputeDerivedClaimPatch
} from "../src/services/claimDocumentProvenance.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const uploadsDir = path.join(backendRoot, "uploads");
const frontendRoot = path.resolve(backendRoot, "../frontend");
const baseUrl = "http://127.0.0.1:4100";

const prisma = new PrismaClient();
let server;
let token;

async function waitForServer() {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Backend did not start within 15 seconds");
}

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "test-admin@hospital.local",
      password: "test-admin-password"
    })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  return payload.accessToken;
}

async function authFetch(url, options = {}) {
  return fetch(`${baseUrl}${url}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });
}

async function createClaim({
  status = "DRAFT",
  amount = 1200,
  totalBilledAmount = 1200,
  documentDerivedFields = []
} = {}) {
  return prisma.claim.create({
    data: {
      patientName: "Lifecycle Test Patient",
      payerName: "Lifecycle Test Payer",
      policyNo: "POL-TEST-001",
      amount,
      totalBilledAmount,
      diagnosisText: "Test diagnosis",
      icd10Codes: ["Z00.00"],
      eligibilityStatus: "VERIFIED",
      priorAuthStatus: "NOT_REQUIRED",
      status,
      documentDerivedFields
    }
  });
}

async function createDocument(claimId, {
  fileName = "test-document.txt",
  contents = "protected claim document",
  type = "FINAL_BILL",
  extracted = {
    patientName: "Lifecycle Test Patient",
    amount: 1200,
    diagnosisText: "Test diagnosis",
    icd10Codes: ["Z00.00"]
  },
  storedPath
} = {}) {
  fs.mkdirSync(uploadsDir, { recursive: true });

  const physicalName =
    storedPath || `test-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`;
  const physicalPath = path.join(uploadsDir, path.basename(physicalName));
  fs.writeFileSync(physicalPath, contents);

  const doc = await prisma.document.create({
    data: {
      claimId,
      type,
      fileName,
      mimeType: "text/plain",
      sizeBytes: Buffer.byteLength(contents),
      path: storedPath || path.basename(physicalName),
      extracted,
      status: "PROCESSED"
    }
  });

  return { doc, physicalPath };
}

async function removeTestData() {
  const claims = await prisma.claim.findMany({
    where: {
      patientName: {
        startsWith: "Lifecycle Test"
      }
    },
    select: { id: true }
  });
  const ids = claims.map((claim) => claim.id);

  if (ids.length) {
    await prisma.check.deleteMany({ where: { claimId: { in: ids } } });
    await prisma.document.deleteMany({ where: { claimId: { in: ids } } });
    await prisma.denialCase.deleteMany({ where: { claimId: { in: ids } } });
    await prisma.auditEvent.deleteMany({ where: { claimId: { in: ids } } });
    await prisma.claim.deleteMany({ where: { id: { in: ids } } });
  }

  if (fs.existsSync(uploadsDir)) {
    for (const name of fs.readdirSync(uploadsDir)) {
      if (name.startsWith("test-")) {
        try {
          fs.unlinkSync(path.join(uploadsDir, name));
        } catch {
          // Best effort test cleanup.
        }
      }
    }
  }
}

before(async () => {
  await removeTestData();

  const passwordHash = await bcrypt.hash("test-admin-password", 10);
  await prisma.user.upsert({
    where: { email: "test-admin@hospital.local" },
    update: {
      passwordHash,
      role: "ADMIN",
      failedLoginAttempts: 0,
      lockedUntil: null
    },
    create: {
      email: "test-admin@hospital.local",
      passwordHash,
      role: "ADMIN"
    }
  });

  server = spawn(process.execPath, ["src/index.js"], {
    cwd: backendRoot,
    env: {
      ...process.env,
      PORT: "4100",
      JWT_SECRET: process.env.JWT_SECRET || "claim-app-test-secret"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.stdout.on("data", () => {});
  server.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  await waitForServer();
  token = await login();
});

after(async () => {
  await removeTestData();
  await prisma.refreshToken.deleteMany({
    where: {
      user: { email: "test-admin@hospital.local" }
    }
  });
  await prisma.user.deleteMany({
    where: { email: "test-admin@hospital.local" }
  });
  await prisma.$disconnect();

  if (server && !server.killed) {
    server.kill("SIGTERM");
  }
});

test("01 - document download requires authentication", { concurrency: false }, async () => {
  const claim = await createClaim();
  const { doc } = await createDocument(claim.id);

  const response = await fetch(`${baseUrl}/api/documents/${doc.id}/download`);
  assert.equal(response.status, 401);
});

test("02 - authenticated document download returns exact file bytes", { concurrency: false }, async () => {
  const claim = await createClaim();
  const expected = "download-content-123";
  const { doc } = await createDocument(claim.id, { contents: expected });

  const response = await authFetch(`/api/documents/${doc.id}/download`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), expected);
});

test("03 - authenticated preview is private/no-store and returns exact bytes", { concurrency: false }, async () => {
  const claim = await createClaim();
  const expected = "preview-content-456";
  const { doc } = await createDocument(claim.id, { contents: expected });

  const response = await authFetch(`/api/documents/${doc.id}/preview`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /private/i);
  assert.match(response.headers.get("cache-control") || "", /no-store/i);
  assert.equal(await response.text(), expected);
});

test("04 - missing document download returns 404 without filesystem path disclosure", { concurrency: false }, async () => {
  const response = await authFetch("/api/documents/not-a-real-document/download");
  assert.equal(response.status, 404);
  const body = await response.text();
  assert.doesNotMatch(body, /\/uploads|\\uploads|\/home|\/runner/i);
});

test("05 - stored path traversal does not escape upload directory", { concurrency: false }, async () => {
  const claim = await createClaim();
  const doc = await prisma.document.create({
    data: {
      claimId: claim.id,
      type: "OTHER",
      fileName: "escape.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
      path: "../../package.json",
      extracted: {},
      status: "PROCESSED"
    }
  });

  const response = await authFetch(`/api/documents/${doc.id}/download`);
  assert.equal(response.status, 404);
});

test("06 - deleting the only DRAFT document is allowed", { concurrency: false }, async () => {
  const claim = await createClaim({
    documentDerivedFields: ["amount", "totalBilledAmount"]
  });
  const { doc } = await createDocument(claim.id);

  const response = await authFetch(`/api/claims/documents/${doc.id}`, {
    method: "DELETE"
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.remainingDocuments, 0);
  assert.equal(
    await prisma.document.count({ where: { claimId: claim.id } }),
    0
  );
});

test("07 - deleting the last supporting document clears document-derived financial fields", { concurrency: false }, async () => {
  const claim = await createClaim({
    amount: 1200,
    totalBilledAmount: 1200,
    documentDerivedFields: ["amount", "totalBilledAmount"]
  });
  const { doc } = await createDocument(claim.id);

  const response = await authFetch(`/api/claims/documents/${doc.id}`, {
    method: "DELETE"
  });
  assert.equal(response.status, 200);

  const updated = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(updated.amount, null);
  assert.equal(updated.totalBilledAmount, null);
});

test("08 - deleting last document clears document-derived diagnosis and ICD-10", { concurrency: false }, async () => {
  const claim = await createClaim({
    documentDerivedFields: ["diagnosisText", "icd10Codes"]
  });
  const { doc } = await createDocument(claim.id);

  await authFetch(`/api/claims/documents/${doc.id}`, {
    method: "DELETE"
  });

  const updated = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(updated.diagnosisText, null);
  assert.deepEqual(updated.icd10Codes, []);
});

test("09 - manual claim fields survive last-document deletion", { concurrency: false }, async () => {
  const claim = await createClaim({
    amount: 900,
    totalBilledAmount: 950,
    documentDerivedFields: []
  });
  const { doc } = await createDocument(claim.id, {
    extracted: { patientName: "Lifecycle Test Patient", amount: 1200 }
  });

  await authFetch(`/api/claims/documents/${doc.id}`, {
    method: "DELETE"
  });

  const updated = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(updated.amount, 900);
  assert.equal(updated.totalBilledAmount, 950);
  assert.equal(updated.diagnosisText, "Test diagnosis");
});

test("10 - deleting one of two bills recomputes amount from remaining document", { concurrency: false }, async () => {
  const claim = await createClaim({
    amount: 1200,
    totalBilledAmount: 1200,
    documentDerivedFields: ["amount", "totalBilledAmount"]
  });

  await createDocument(claim.id, {
    fileName: "older-final-bill.txt",
    contents: "older",
    extracted: { patientName: "Lifecycle Test Patient", amount: 900 }
  });

  await new Promise((resolve) => setTimeout(resolve, 10));

  const { doc: newest } = await createDocument(claim.id, {
    fileName: "newer-final-bill.txt",
    contents: "newer",
    extracted: { patientName: "Lifecycle Test Patient", amount: 1200 }
  });

  const response = await authFetch(`/api/claims/documents/${newest.id}`, {
    method: "DELETE"
  });
  assert.equal(response.status, 200);

  const updated = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(updated.amount, 900);
  assert.equal(updated.totalBilledAmount, 900);
});

test("11 - document deletion invalidates checks and returns claim to DRAFT", { concurrency: false }, async () => {
  const claim = await createClaim({
    status: "READY",
    documentDerivedFields: ["amount"]
  });
  const { doc } = await createDocument(claim.id);

  await prisma.check.create({
    data: {
      claimId: claim.id,
      score: 100,
      issues: []
    }
  });

  const response = await authFetch(`/api/claims/documents/${doc.id}`, {
    method: "DELETE"
  });
  assert.equal(response.status, 200);

  const updated = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(updated.status, "DRAFT");
  assert.equal(await prisma.check.count({ where: { claimId: claim.id } }), 0);
});

test("12 - submitted claim document cannot be deleted", { concurrency: false }, async () => {
  const claim = await createClaim({ status: "SUBMITTED" });
  const { doc } = await createDocument(claim.id);

  const response = await authFetch(`/api/claims/documents/${doc.id}`, {
    method: "DELETE"
  });

  assert.equal(response.status, 409);
  assert.equal(
    await prisma.document.count({ where: { id: doc.id } }),
    1
  );
});

test("13 - bulk delete is atomic when selection includes a submitted claim document", { concurrency: false }, async () => {
  const draft = await createClaim();
  const submitted = await createClaim({ status: "SUBMITTED" });
  const { doc: draftDoc } = await createDocument(draft.id);
  const { doc: submittedDoc } = await createDocument(submitted.id);

  const response = await authFetch("/api/claims/documents/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [draftDoc.id, submittedDoc.id] })
  });

  assert.equal(response.status, 409);
  assert.equal(
    await prisma.document.count({
      where: { id: { in: [draftDoc.id, submittedDoc.id] } }
    }),
    2
  );
});

test("14 - AI readiness detects no supporting documents after deletion", { concurrency: false }, async () => {
  const claim = await createClaim({
    documentDerivedFields: ["amount"]
  });
  const { doc } = await createDocument(claim.id);

  await authFetch(`/api/claims/documents/${doc.id}`, {
    method: "DELETE"
  });

  const response = await authFetch(`/api/claims/${claim.id}/check`, {
    method: "POST"
  });

  assert.equal(response.status, 200);
  const check = await response.json();
  assert.ok(
    check.issues.some((issue) =>
      /No supporting documents uploaded/i.test(issue.message)
    )
  );
});

test("15 - recompute helper clears only fields declared document-derived", { concurrency: false }, () => {
  const patch = recomputeDerivedClaimPatch([], [
    "amount",
    "diagnosisText",
    "icd10Codes"
  ]);

  assert.deepEqual(patch, {
    amount: null,
    diagnosisText: null,
    icd10Codes: []
  });
});

test("16 - hidden Document Intelligence download and preview include bearer authentication", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/documents/DocumentIntelligence.jsx"),
    "utf8"
  );

  assert.match(source, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(source, /\/download/);
  assert.match(source, /\/preview/);
});

test("17 - Claim Detail download and preview include bearer authentication", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );

  const matches = source.match(/Authorization': `Bearer \$\{token\}`/g) || [];
  assert.ok(matches.length >= 2);
});

test("18 - document route never marks PHI preview cache as public", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(backendRoot, "src/routes/documents.js"),
    "utf8"
  );

  assert.doesNotMatch(source, /Cache-Control['"],\s*['"]public/i);
  assert.match(source, /private, no-store/);
});

test("19 - deleting last smart-created document preserves required identity but clears optional derived data", { concurrency: false }, async () => {
  const claim = await createClaim({
    amount: 1875,
    totalBilledAmount: 1875,
    documentDerivedFields: [
      "patientName",
      "payerName",
      "policyNo",
      "amount",
      "totalBilledAmount",
      "diagnosisText",
      "icd10Codes"
    ]
  });

  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      patientName: "Lifecycle Test Alice",
      payerName: "Lifecycle Test Insurance",
      policyNo: "POL-DERIVED-001",
      diagnosisText: "Migraine",
      icd10Codes: ["G43.009"]
    }
  });

  const { doc } = await createDocument(claim.id, {
    extracted: {
      patientName: "Lifecycle Test Alice",
      payerName: "Lifecycle Test Insurance",
      policyNo: "POL-DERIVED-001",
      amount: 1875,
      diagnosisText: "Migraine",
      icd10Codes: ["G43.009"]
    }
  });

  const response = await authFetch(`/api/claims/documents/${doc.id}`, {
    method: "DELETE"
  });

  assert.equal(response.status, 200);

  const updated = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(updated.patientName, "Lifecycle Test Alice");
  assert.equal(updated.payerName, "Lifecycle Test Insurance");
  assert.equal(updated.policyNo, null);
  assert.equal(updated.amount, null);
  assert.equal(updated.totalBilledAmount, null);
  assert.equal(updated.diagnosisText, null);
  assert.deepEqual(updated.icd10Codes, []);
});


test("20 - repeated eligibility pre-check is idempotent after verification", { concurrency: false }, async () => {
  const claim = await createClaim();
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      eligibilityStatus: "NOT_CHECKED",
      eligibilityCheckedAt: null,
      memberId: "MEM-IDEMP-001",
      policyNo: "POL-IDEMP-001"
    }
  });

  const first = await authFetch(`/api/claims/${claim.id}/journey/eligibility/precheck`, {
    method: "POST"
  });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.status, "VERIFIED");

  const afterFirst = await prisma.claim.findUnique({ where: { id: claim.id } });

  await new Promise((resolve) => setTimeout(resolve, 20));

  const second = await authFetch(`/api/claims/${claim.id}/journey/eligibility/precheck`, {
    method: "POST"
  });
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.unchanged, true);

  const afterSecond = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(
    afterSecond.eligibilityCheckedAt?.toISOString(),
    afterFirst.eligibilityCheckedAt?.toISOString()
  );
});

test("21 - repeated prior-auth evaluation with same values is idempotent", { concurrency: false }, async () => {
  const claim = await createClaim();
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      priorAuthRequired: null,
      priorAuthStatus: "NOT_CHECKED",
      authorizationNo: null,
      priorAuthExpiry: null
    }
  });

  const payload = {
    required: true,
    authorizationNo: "AUTH-IDEMP-001",
    expiry: "2026-12-31"
  };

  const first = await authFetch(`/api/claims/${claim.id}/journey/prior-auth/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(first.status, 200);

  const afterFirst = await prisma.claim.findUnique({ where: { id: claim.id } });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const second = await authFetch(`/api/claims/${claim.id}/journey/prior-auth/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.unchanged, true);

  const afterSecond = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(
    afterSecond.priorAuthCheckedAt?.toISOString(),
    afterFirst.priorAuthCheckedAt?.toISOString()
  );
});

test("22 - repeated payer status write does not rewrite checked timestamp", { concurrency: false }, async () => {
  const claim = await createClaim({ status: "SUBMITTED" });
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      payerClaimStatus: "ACKNOWLEDGED",
      claimStatusCheckedAt: new Date("2026-09-28T12:00:00.000Z")
    }
  });

  const response = await authFetch(`/api/claims/${claim.id}/journey/claim-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payerClaimStatus: "ACKNOWLEDGED" })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.unchanged, true);

  const updated = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(
    updated.claimStatusCheckedAt?.toISOString(),
    "2026-09-28T12:00:00.000Z"
  );
});

test("23 - remittance auto-calculates estimated patient responsibility as allowed minus paid", { concurrency: false }, async () => {
  const claim = await createClaim({ status: "SUBMITTED", amount: 12000, totalBilledAmount: 12000 });

  const response = await authFetch(`/api/claims/${claim.id}/journey/remittance`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      remittanceStatus: "RECEIVED",
      allowedAmount: 12000,
      paidAmount: 10000,
      paymentReference: "PAY-12000"
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.patientResponsibility, 2000);
});

test("24 - claimed minus paid is not treated as patient responsibility when allowed amount is lower", { concurrency: false }, async () => {
  const claim = await createClaim({ status: "SUBMITTED", amount: 12000, totalBilledAmount: 12000 });

  const response = await authFetch(`/api/claims/${claim.id}/journey/remittance`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      remittanceStatus: "RECEIVED",
      allowedAmount: 10000,
      paidAmount: 10000,
      paymentReference: "PAY-10000"
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.patientResponsibility, 0);
});

test("25 - explicit remittance patient responsibility overrides estimate", { concurrency: false }, async () => {
  const claim = await createClaim({ status: "SUBMITTED", amount: 12000, totalBilledAmount: 12000 });

  const response = await authFetch(`/api/claims/${claim.id}/journey/remittance`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      remittanceStatus: "RECEIVED",
      allowedAmount: 12000,
      paidAmount: 10000,
      patientResponsibility: 750,
      paymentReference: "PAY-OVERRIDE"
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.patientResponsibility, 750);
});

test("26 - repeated identical remittance write is idempotent", { concurrency: false }, async () => {
  const claim = await createClaim({ status: "SUBMITTED", amount: 12000, totalBilledAmount: 12000 });

  const payload = {
    remittanceStatus: "RECEIVED",
    allowedAmount: 12000,
    paidAmount: 10000,
    patientResponsibility: 2000,
    paymentReference: "PAY-IDEMP"
  };

  const first = await authFetch(`/api/claims/${claim.id}/journey/remittance`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(first.status, 200);

  const afterFirst = await prisma.claim.findUnique({ where: { id: claim.id } });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const second = await authFetch(`/api/claims/${claim.id}/journey/remittance`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.unchanged, true);

  const afterSecond = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(
    afterSecond.remittanceReceivedAt?.toISOString(),
    afterFirst.remittanceReceivedAt?.toISOString()
  );
});

test("27 - journey UI uses responsive breakpoints and contextual claim return route", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/journey/ClaimJourney.jsx"),
    "utf8"
  );

  assert.match(source, /sm:\s*"repeat\(2, minmax\(0, 1fr\)\)"/);
  assert.match(source, /lg:\s*"repeat\(3, minmax\(0, 1fr\)\)"/);
  assert.match(source, /backLabel:\s*"Back to Claim Journey"/);
  assert.match(source, /claimId=/);
});

test("28 - responsive shell uses temporary mobile drawer and no fixed mobile margin", { concurrency: false }, () => {
  const layout = fs.readFileSync(
    path.join(frontendRoot, "src/layout/MainLayout.jsx"),
    "utf8"
  );
  const nav = fs.readFileSync(
    path.join(frontendRoot, "src/layout/LeftNav.jsx"),
    "utf8"
  );

  assert.match(layout, /ml:\s*\{\s*xs:\s*0,\s*md:/);
  assert.match(nav, /variant="temporary"/);
  assert.match(nav, /display:\s*\{\s*xs:\s*"block",\s*md:\s*"none"/);
});

test("29 - claim detail supports source-aware back navigation", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );

  assert.match(source, /location\.state\?\.from/);
  assert.match(source, /location\.state\?\.backLabel/);
});
