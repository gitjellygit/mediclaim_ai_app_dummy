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
import {
  buildAutomationSummary,
  documentProvenance
} from "../src/services/claimFieldProvenance.js";

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

  const checks = await prisma.check.findMany({ where: { claimId: claim.id } });
  assert.equal(checks.length, 1);
  assert.equal(checks[0].isStale, true);
  assert.match(checks[0].staleReason, /Supporting document deleted/i);
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


test("30 - claim update can save member ID and DOB needed for eligibility review", { concurrency: false }, async () => {
  const claim = await createClaim({ amount: 1500, totalBilledAmount: 1500 });

  const response = await authFetch(`/api/claims/${claim.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientName: claim.patientName,
      payerName: claim.payerName,
      policyNo: "POL-ELIG-001",
      memberId: "MEM-ELIG-001",
      patientDob: "1990-06-15",
      hospitalName: null,
      diagnosisText: "Test diagnosis",
      claimType: "REIMBURSEMENT",
      icd10Codes: ["Z00.00"],
      amount: 1500,
      totalBilledAmount: 1500
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.memberId, "MEM-ELIG-001");
  assert.equal(new Date(body.patientDob).toISOString().slice(0, 10), "1990-06-15");
});

test("31 - claim journey renders human-readable status labels and actionable eligibility review", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/journey/ClaimJourney.jsx"),
    "utf8"
  );

  assert.match(source, /replaceAll\("_", " "\)/);
  assert.match(source, /Review \/ Fix/);
  assert.match(source, /focus:\s*"eligibility"/);
  assert.match(source, /clickable=\{Boolean\(onStatusClick\)\}/);
});

test("32 - document type selector uses Material menu items and supports radiology and prescription", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );

  assert.match(source, /<MenuItem/);
  assert.match(source, /RADIOLOGY:\s*"Radiology Report"/);
  assert.match(source, /PRESCRIPTION:\s*"Prescription"/);
  assert.doesNotMatch(source, /<option key=\{t\}/);
  assert.match(source, /cursor:\s*"pointer"/);
});

test("33 - AI readiness issues expose contextual fix actions", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );

  assert.match(source, /function fixIssue\(issue\)/);
  assert.match(source, /Upload Document/);
  assert.match(source, /Verify Eligibility/);
  assert.match(source, /Resolve Auth/);
  assert.match(source, /Action required to improve this claim/);
});


test("34 - manual claim creation records user provenance", { concurrency: false }, async () => {
  const response = await authFetch("/api/claims", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientName: "Lifecycle Test Manual",
      payerName: "Lifecycle Test Payer",
      policyNo: "POL-MANUAL-001",
      amount: 2200,
      totalBilledAmount: 2300
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.fieldProvenance.patientName.source, "USER");
  assert.equal(body.fieldProvenance.amount.source, "USER");
});

test("35 - manual edit changes provenance only for changed tracked fields", { concurrency: false }, async () => {
  const claim = await createClaim({
    amount: 1000,
    totalBilledAmount: 1000
  });

  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      fieldProvenance: {
        patientName: {
          source: "DOCUMENT_AI",
          label: "AI Extracted",
          confidence: 92
        },
        amount: {
          source: "DOCUMENT_AI",
          label: "AI Extracted",
          confidence: 92
        }
      }
    }
  });

  const response = await authFetch(`/api/claims/${claim.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientName: claim.patientName,
      payerName: claim.payerName,
      policyNo: claim.policyNo,
      memberId: null,
      patientDob: null,
      hospitalName: null,
      diagnosisText: "Updated manual diagnosis",
      claimType: "REIMBURSEMENT",
      icd10Codes: ["Z00.00"],
      amount: 1000,
      totalBilledAmount: 1000
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.fieldProvenance.patientName.source, "DOCUMENT_AI");
  assert.equal(body.fieldProvenance.amount.source, "DOCUMENT_AI");
  assert.equal(body.fieldProvenance.diagnosisText.source, "USER");
});

test("36 - eligibility pre-check identifies itself as local pre-check provenance", { concurrency: false }, async () => {
  const claim = await createClaim();
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      eligibilityStatus: "NOT_CHECKED",
      memberId: "MEM-PROV-001",
      policyNo: "POL-PROV-001",
      fieldProvenance: null
    }
  });

  const response = await authFetch(`/api/claims/${claim.id}/journey/eligibility/precheck`, {
    method: "POST"
  });

  assert.equal(response.status, 200);
  const updated = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(updated.fieldProvenance.eligibilityStatus.source, "LOCAL_PRECHECK");
  assert.equal(updated.fieldProvenance.coverageStatus.source, "LOCAL_PRECHECK");
});

test("37 - estimated patient responsibility is labeled calculated estimate", { concurrency: false }, async () => {
  const claim = await createClaim({
    status: "SUBMITTED",
    amount: 12000,
    totalBilledAmount: 12000
  });

  const response = await authFetch(`/api/claims/${claim.id}/journey/remittance`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      remittanceStatus: "RECEIVED",
      allowedAmount: 10000,
      paidAmount: 8000,
      paymentReference: "PROV-PAY-001"
    })
  });

  assert.equal(response.status, 200);
  const updated = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(updated.patientResponsibility, 2000);
  assert.equal(
    updated.fieldProvenance.patientResponsibility.source,
    "CALCULATED_ESTIMATE"
  );
  assert.equal(updated.fieldProvenance.allowedAmount.source, "USER_RECORDED");
});

test("38 - document provenance records AI source and confidence", { concurrency: false }, () => {
  const provenance = documentProvenance({
    fields: ["patientName", "amount"],
    confidence: 87,
    documentId: "doc-123",
    fileName: "final_bill.pdf",
    documentType: "FINAL_BILL"
  });

  assert.equal(provenance.patientName.source, "DOCUMENT_AI");
  assert.equal(provenance.patientName.confidence, 87);
  assert.equal(provenance.patientName.documentId, "doc-123");
  assert.match(provenance.amount.sourceDetail, /FINAL_BILL/);
});

test("39 - automation summary separates automatic, manual, review and missing fields", { concurrency: false }, () => {
  const summary = buildAutomationSummary({
    patientName: "Lifecycle Test Patient",
    payerName: "Lifecycle Test Payer",
    policyNo: "POL-001",
    amount: 1200,
    patientResponsibility: 200,
    fieldProvenance: {
      patientName: {
        source: "DOCUMENT_AI",
        label: "AI Extracted",
        confidence: 95
      },
      payerName: {
        source: "USER",
        label: "Entered by User"
      },
      policyNo: {
        source: "DOCUMENT_AI",
        label: "AI Extracted",
        confidence: 60
      },
      amount: {
        source: "DOCUMENT_AI",
        label: "AI Extracted",
        confidence: 90
      },
      patientResponsibility: {
        source: "CALCULATED_ESTIMATE",
        label: "Calculated Estimate"
      }
    }
  });

  assert.ok(summary.automatedFields >= 2);
  assert.ok(summary.manualFields >= 1);
  assert.ok(summary.reviewFields >= 2);
  assert.ok(summary.missingFields > 0);
});

test("40 - claim detail exposes automation summary and visible source badges", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );

  assert.match(source, /Claim Automation/);
  assert.match(source, /View Field Sources/);
  assert.match(source, /source\.label/);
  assert.match(source, /automationSummary\.automationRate/);
  assert.match(source, /SourceBadge/);
});

test("41 - claim journey shows compact automation snapshot", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/journey/ClaimJourney.jsx"),
    "utf8"
  );

  assert.match(source, /Automation Snapshot/);
  assert.match(source, /auto-populated/);
  assert.match(source, /automationSummary\.missingFields/);
});


test("42 - applying AI document type suggestion updates saved document type", { concurrency: false }, async () => {
  const claim = await createClaim();
  const { doc } = await createDocument(claim.id, {
    type: "FINAL_BILL"
  });

  await prisma.document.update({
    where: { id: doc.id },
    data: {
      type: "FINAL_BILL",
      suggestedType: "INSURANCE_CARD",
      confidence: 88
    }
  });

  const response = await authFetch(`/api/claims/documents/${doc.id}/apply-suggestion`, {
    method: "POST"
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.type, "INSURANCE_CARD");

  const updated = await prisma.document.findUnique({ where: { id: doc.id } });
  assert.equal(updated.type, "INSURANCE_CARD");
});

test("43 - reapplying matching AI document type is idempotent", { concurrency: false }, async () => {
  const claim = await createClaim();
  const { doc } = await createDocument(claim.id, {
    type: "LAB_REPORT"
  });

  await prisma.document.update({
    where: { id: doc.id },
    data: {
      type: "LAB_REPORT",
      suggestedType: "LAB_REPORT",
      confidence: 90
    }
  });

  const response = await authFetch(`/api/claims/documents/${doc.id}/apply-suggestion`, {
    method: "POST"
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.unchanged, true);
});

test("44 - claim detail defaults document type to AI auto detection", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );

  assert.match(source, /useState\("AUTO"\)/);
  assert.match(source, /Auto Detect with AI \(Recommended\)/);
  assert.match(source, /docType === "AUTO" \? null : docType/);
  assert.match(source, /Document type needs review/);
  assert.match(source, /Use AI Type/);
});


test("45 - claim automation summary chips are clickable and filter field buckets", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );

  assert.match(source, /showAutomationBucket\("automated"\)/);
  assert.match(source, /showAutomationBucket\("review"\)/);
  assert.match(source, /showAutomationBucket\("manual"\)/);
  assert.match(source, /showAutomationBucket\("missing"\)/);
  assert.match(source, /Missing fields — click a field to complete it/);
  assert.match(source, /Fields needing review — click a field to resolve it/);
});

test("46 - missing or review automation fields route to an exact fix location", { concurrency: false }, () => {
  const detail = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );
  const journey = fs.readFileSync(
    path.join(frontendRoot, "src/modules/journey/ClaimJourney.jsx"),
    "utf8"
  );

  assert.match(detail, /function automationFieldAction\(item\)/);
  assert.match(detail, /stage=\$\{stage\}/);
  assert.match(detail, /openClaimEdit\(item\.field\)/);
  assert.match(detail, /Open Journey/);
  assert.match(detail, /Add \/ Fix/);
  assert.match(detail, /Review \/ Fix/);

  assert.match(journey, /focusedStage = searchParams\.get\("stage"\)/);
  assert.match(journey, /journey-stage-eligibility/);
  assert.match(journey, /journey-stage-prior-auth/);
  assert.match(journey, /journey-stage-claim-status/);
  assert.match(journey, /journey-stage-remittance/);
  assert.match(journey, /scrollIntoView/);
});


test("47 - local eligibility pre-check does not falsely claim payer-verified active coverage", { concurrency: false }, async () => {
  const claim = await createClaim();
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      eligibilityStatus: "NOT_CHECKED",
      coverageStatus: null,
      memberId: "MEM-ELIG-LOCAL-001",
      policyNo: "POL-ELIG-LOCAL-001"
    }
  });

  const response = await authFetch(`/api/claims/${claim.id}/journey/eligibility/precheck`, {
    method: "POST"
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "VERIFIED");
  assert.equal(body.coverageStatus, "UNKNOWN");
  assert.equal(body.livePayerVerification, false);
});

test("48 - received remittance requires allowed and paid amounts", { concurrency: false }, async () => {
  const claim = await createClaim({ status: "SUBMITTED" });

  const response = await authFetch(`/api/claims/${claim.id}/journey/remittance`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      remittanceStatus: "RECEIVED",
      allowedAmount: "",
      paidAmount: "",
      paymentReference: ""
    })
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /Allowed amount and paid amount are required/i);
});

test("49 - received remittance keeps claim submitted until posting", { concurrency: false }, async () => {
  const claim = await createClaim({ status: "SUBMITTED", amount: 12000, totalBilledAmount: 12000 });

  const response = await authFetch(`/api/claims/${claim.id}/journey/remittance`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      remittanceStatus: "RECEIVED",
      allowedAmount: 10000,
      paidAmount: 8000,
      patientResponsibility: 2000
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "SUBMITTED");
});

test("50 - positive posted remittance moves overall claim to PAID", { concurrency: false }, async () => {
  const claim = await createClaim({ status: "SUBMITTED", amount: 12000, totalBilledAmount: 12000 });

  const response = await authFetch(`/api/claims/${claim.id}/journey/remittance`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      remittanceStatus: "POSTED",
      allowedAmount: 10000,
      paidAmount: 8000,
      patientResponsibility: 2000,
      paymentReference: "PAY-POSTED-001"
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "PAID");
});

test("51 - claim journey uses compact required and conditional field cues", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/journey/ClaimJourney.jsx"),
    "utf8"
  );

  assert.match(source, /<b>\*<\/b> Required/);
  assert.match(source, /Conditional fields highlight when required/);
  assert.match(source, /Auth Required\? \*/);
  assert.match(source, /Authorization No\. \*/);
  assert.match(source, /Allowed Amount \*/);
  assert.match(source, /Paid Amount \*/);
  assert.match(source, /Auto-calculated; editable/);
  assert.doesNotMatch(source, /In production this should come from/);
  assert.doesNotMatch(source, /For a real 835 ERA/);
});


test("52 - claim journey uses visual connected progress tracker", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/journey/ClaimJourney.jsx"),
    "utf8"
  );

  assert.match(source, /function JourneyProgress/);
  assert.match(source, /Eligibility/);
  assert.match(source, /Prior Auth/);
  assert.match(source, /Remittance/);
  assert.match(source, /connectorComplete/);
  assert.match(source, /success\.main/);
  assert.match(source, /journey-stage-claim/);
  assert.doesNotMatch(
    source,
    /Eligibility → Prior Auth → Claim → Status → Remittance/
  );
});


test("53 - denied payer status moves overall claim to DENIED", { concurrency: false }, async () => {
  const claim = await createClaim({ status: "SUBMITTED" });
  await prisma.claim.update({
    where: { id: claim.id },
    data: { claimSubmissionDate: new Date() }
  });

  const response = await authFetch(`/api/claims/${claim.id}/journey/claim-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payerClaimStatus: "DENIED" })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "DENIED");
  assert.equal(body.payerClaimStatus, "DENIED");
});

test("54 - zero-dollar posted remittance keeps denied claim DENIED", { concurrency: false }, async () => {
  const claim = await createClaim({ status: "SUBMITTED", amount: 9850, totalBilledAmount: 9850 });
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      claimSubmissionDate: new Date(),
      payerClaimStatus: "DENIED",
      status: "DENIED"
    }
  });

  const response = await authFetch(`/api/claims/${claim.id}/journey/remittance`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      remittanceStatus: "POSTED",
      allowedAmount: 0,
      paidAmount: 0,
      patientResponsibility: 0
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "DENIED");
  assert.equal(body.remittanceStatus, "POSTED");
});

test("55 - prior authorization cannot be changed after claim submission", { concurrency: false }, async () => {
  const claim = await createClaim({ status: "SUBMITTED" });
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      claimSubmissionDate: new Date(),
      eligibilityStatus: "VERIFIED"
    }
  });

  const response = await authFetch(`/api/claims/${claim.id}/journey/prior-auth/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      required: true,
      authorizationNo: "SHOULD-NOT-CHANGE"
    })
  });

  assert.equal(response.status, 409);
  const body = await response.json();
  assert.match(body.error, /locked after claim submission/i);
});

test("56 - terminal payer status cannot be changed without reopening", { concurrency: false }, async () => {
  const claim = await createClaim({ status: "DENIED" });
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      claimSubmissionDate: new Date(),
      payerClaimStatus: "DENIED"
    }
  });

  const response = await authFetch(`/api/claims/${claim.id}/journey/claim-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payerClaimStatus: "APPROVED" })
  });

  assert.equal(response.status, 409);
  const body = await response.json();
  assert.match(body.error, /Final payer status is locked/i);
});

test("57 - posted remittance cannot be edited again", { concurrency: false }, async () => {
  const claim = await createClaim({ status: "DENIED" });
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      claimSubmissionDate: new Date(),
      payerClaimStatus: "DENIED",
      remittanceStatus: "POSTED",
      allowedAmount: 0,
      paidAmount: 0,
      patientResponsibility: 0
    }
  });

  const response = await authFetch(`/api/claims/${claim.id}/journey/remittance`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      remittanceStatus: "POSTED",
      allowedAmount: 100,
      paidAmount: 0,
      patientResponsibility: 100
    })
  });

  assert.equal(response.status, 409);
  const body = await response.json();
  assert.match(body.error, /Posted remittance is locked/i);
});

test("58 - journey UI disables completed terminal stage controls", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/journey/ClaimJourney.jsx"),
    "utf8"
  );

  assert.match(source, /disabled=\{!stages\.priorAuth\.actionable\}/);
  assert.match(source, /disabled=\{!stages\.claimStatus\.actionable\}/);
  assert.match(source, /disabled=\{!stages\.remittance\.actionable\}/);
});


test("59 - meaningful journey change marks latest AI check stale instead of deleting history", { concurrency: false }, async () => {
  const claim = await createClaim();
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      eligibilityStatus: "NOT_CHECKED",
      coverageStatus: null,
      memberId: "MEM-HISTORY-001",
      policyNo: "POL-HISTORY-001",
      priorAuthRequired: false,
      priorAuthStatus: "NOT_REQUIRED"
    }
  });

  const first = await authFetch(`/api/claims/${claim.id}/check`, {
    method: "POST"
  });
  assert.equal(first.status, 200);
  const firstBody = await first.json();

  const eligibility = await authFetch(
    `/api/claims/${claim.id}/journey/eligibility/precheck`,
    { method: "POST" }
  );
  assert.equal(eligibility.status, 200);

  const stored = await prisma.check.findUnique({ where: { id: firstBody.id } });
  assert.equal(stored.isStale, true);
  assert.match(stored.staleReason, /Eligibility information changed/i);

  const count = await prisma.check.count({ where: { claimId: claim.id } });
  assert.equal(count, 1);
});

test("60 - refreshed AI check compares score with previous check", { concurrency: false }, async () => {
  const claim = await createClaim();
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      eligibilityStatus: "NOT_CHECKED",
      coverageStatus: null,
      memberId: "MEM-HISTORY-002",
      policyNo: "POL-HISTORY-002",
      priorAuthRequired: false,
      priorAuthStatus: "NOT_REQUIRED"
    }
  });

  const first = await authFetch(`/api/claims/${claim.id}/check`, {
    method: "POST"
  });
  assert.equal(first.status, 200);
  const firstBody = await first.json();

  await authFetch(`/api/claims/${claim.id}/journey/eligibility/precheck`, {
    method: "POST"
  });

  const second = await authFetch(`/api/claims/${claim.id}/check`, {
    method: "POST"
  });
  assert.equal(second.status, 200);
  const secondBody = await second.json();

  assert.equal(secondBody.comparison.previousScore, firstBody.score);
  assert.ok(secondBody.comparison.scoreDelta > 0);
  assert.ok(
    secondBody.comparison.resolvedIssues.some((issue) =>
      /Eligibility has not been verified/i.test(issue.message)
    )
  );

  const detail = await authFetch(`/api/claims/${claim.id}`);
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.equal(detailBody.checks.length, 2);
  assert.equal(detailBody.checks[0].isStale, false);
  assert.equal(detailBody.checks[1].isStale, true);
});

test("61 - stale AI check cannot be used for claim submission", { concurrency: false }, async () => {
  const claim = await createClaim();
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      memberId: "MEM-STALE-SUBMIT",
      eligibilityStatus: "VERIFIED",
      priorAuthRequired: false,
      priorAuthStatus: "NOT_REQUIRED"
    }
  });

  const { doc } = await createDocument(claim.id, {
    extracted: {
      patientName: "Lifecycle Test Patient",
      amount: 1200,
      diagnosisText: "Test diagnosis",
      icd10Codes: ["Z00.00"]
    }
  });

  const check = await authFetch(`/api/claims/${claim.id}/check`, {
    method: "POST"
  });
  assert.equal(check.status, 200);

  await prisma.check.updateMany({
    where: { claimId: claim.id },
    data: {
      isStale: true,
      staleAt: new Date(),
      staleReason: "Test change"
    }
  });

  const submit = await authFetch(`/api/claims/${claim.id}/submit`, {
    method: "POST"
  });
  assert.equal(submit.status, 400);
  const body = await submit.json();
  assert.match(body.error, /changed after the last AI Check/i);
});

test("62 - readiness UI uses red yellow green thresholds and history", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );

  assert.match(source, /if \(value < 40\) return "error"/);
  assert.match(source, /if \(value < 70\) return "warning"/);
  assert.match(source, /return "success"/);
  assert.match(source, /AI Readiness History/);
  assert.match(source, /Refresh AI Readiness/);
  assert.match(source, /Claim changed after this AI Check/);
  assert.match(source, /since previous check/);
});

test("63 - current submission eligibility rejects stale readiness result in UI", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );

  assert.match(source, /!check\.isStale/);
});


test("64 - low readiness cannot display deceptively low rejection risk", { concurrency: false }, async () => {
  const claim = await createClaim({
    amount: 1200,
    totalBilledAmount: 1200
  });

  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      eligibilityStatus: "NOT_CHECKED",
      priorAuthStatus: "NOT_CHECKED",
      icd10Codes: ["Z00.00"]
    }
  });

  const response = await authFetch(`/api/claims/${claim.id}/check`, {
    method: "POST"
  });

  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.score, 40);
  assert.ok(body.riskScore >= 0.6);
  assert.equal(body.riskLevel, "HIGH");
});

test("65 - AI check refresh keeps claim detail mounted and returns to readiness area", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );

  assert.match(source, /load\(\{ silent: true \}\)/);
  assert.match(source, /readinessRef\.current\?\.scrollIntoView/);
  assert.match(source, /Estimated Rejection Risk/);
  assert.match(source, /not a payer probability/);
});

test("66 - AI analysis dialog shows domain-specific staged workflow", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/components/AICheckProgress.jsx"),
    "utf8"
  );

  assert.match(source, /AI Claim Readiness Analysis/);
  assert.match(source, /Reading claim documents/);
  assert.match(source, /Checking clinical & policy data/);
  assert.match(source, /Reviewing payer & authorization rules/);
  assert.match(source, /Calculating readiness & rejection risk/);
  assert.match(source, /claimAiSpin/);
  assert.match(source, /HealthAndSafetyIcon/);
});
