import { moneyCents } from "../src/utils/money.js";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import {
  recomputeDerivedClaimPatch
} from "../src/services/claimDocumentProvenance.js";
import {
  buildAutomationSummary,
  documentProvenance
} from "../src/services/claimFieldProvenance.js";
import {
  buildClaimCompleteness,
  completenessReadinessIssues
} from "../src/services/claimCompleteness.js";
import { analyzeMedicalConsistency } from "../src/services/medicalConsistency.js";
import { resolveStoredDocument, safeDownloadName } from "../src/services/storedDocumentPath.js";
import {
  getMockPayer,
  listMockPayers,
  simulateEligibility,
  simulatePriorAuth,
  simulateSubmission,
  simulateStatus,
  simulateRemittance,
  payerInputFingerprint,
  calculateAdjudication
} from "../src/services/payerSimulator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const uploadsDir = path.join(backendRoot, "uploads");
const frontendRoot = path.resolve(backendRoot, "../frontend");
const baseUrl = "http://127.0.0.1:4100";

const prisma = new PrismaClient();
let server;
let token;
const TEST_ORG_ID = "org_test_lifecycle";
let testAdminId;

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
      organizationId: TEST_ORG_ID,
      createdById: testAdminId || null,
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

  await prisma.organization.upsert({
    where: { id: TEST_ORG_ID },
    update: {},
    create: { id: TEST_ORG_ID, name: "Lifecycle Test Hospital", slug: "lifecycle-test-hospital" }
  });

  const passwordHash = await bcrypt.hash("test-admin-password", 10);
  const testAdmin = await prisma.user.upsert({
    where: { email: "test-admin@hospital.local" },
    update: {
      passwordHash,
      role: "ADMIN",
      organizationId: TEST_ORG_ID,
      failedLoginAttempts: 0,
      lockedUntil: null
    },
    create: {
      email: "test-admin@hospital.local",
      passwordHash,
      role: "ADMIN",
      organizationId: TEST_ORG_ID
    }
  });
  testAdminId = testAdmin.id;

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

test("config - synthetic fixture endpoints are isolated behind E2E_TEST_MODE and admin auth", { concurrency: false }, () => {
  const claims = fs.readFileSync(path.join(backendRoot, "src/routes/claims.js"), "utf8");
  const entry = fs.readFileSync(path.join(backendRoot, "src/index.js"), "utf8");
  const fixtures = fs.readFileSync(path.join(backendRoot, "src/routes/e2eFixtures.js"), "utf8");

  assert.equal(claims.includes('router.post("/e2e/'), false);
  assert.equal(claims.includes('router.delete("/e2e/'), false);
  assert.ok(entry.includes('process.env.E2E_TEST_MODE === "true"'));
  assert.ok(entry.includes('requireRoles(["ADMIN"]), captureAsyncRouter(e2eFixturesRouter'));
  assert.ok(fixtures.includes('e2e/medical-consistency/seed'));
  assert.ok(fixtures.includes('e2e/payer-journey/seed'));
});

test("H8B-2 - logout-all revokes refresh sessions and existing access tokens", { concurrency: false }, async () => {
  const anonymous = await fetch(`${baseUrl}/api/auth/logout-all`, { method: "POST" });
  assert.equal(anonymous.status, 401);

  const credentials = {
    email: "test-admin@hospital.local",
    password: "test-admin-password"
  };
  const loginSession = async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials)
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.refreshToken, "test mode returns compatibility refresh token");
    assert.match(response.headers.get("set-cookie") || "", /HttpOnly/i);
    assert.match(response.headers.get("set-cookie") || "", /SameSite=Lax/i);
    return payload;
  };

  const first = await loginSession();
  const second = await loginSession();

  const logout = await fetch(`${baseUrl}/api/auth/logout-all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${first.accessToken}` }
  });
  assert.equal(logout.status, 200);

  for (const session of [first, second]) {
    const refresh = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    });
    assert.equal(refresh.status, 401);

    const access = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
    });
    assert.equal(access.status, 401);
    assert.equal((await access.json()).code, "SESSION_REVOKED");
  }

  // logout-all also invalidates the suite's original login, so establish a
  // fresh session for the remaining lifecycle tests.
  token = await login();
});

test("H8B-2 - refresh rotates the credential and stores only a hash", { concurrency: false }, async () => {
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "h8b2-test-agent" },
    body: JSON.stringify({
      email: "test-admin@hospital.local",
      password: "test-admin-password"
    })
  });
  assert.equal(loginResponse.status, 200);
  const loginPayload = await loginResponse.json();

  const accessPayload = jwt.decode(loginPayload.accessToken);
  assert.ok(accessPayload.sid);

  const sessionBefore = await prisma.refreshToken.findFirst({
    where: {
      userId: testAdminId,
      sessionId: accessPayload.sid,
      revoked: false
    }
  });
  assert.ok(sessionBefore);
  assert.notEqual(sessionBefore.tokenHash, loginPayload.refreshToken);
  assert.equal(sessionBefore.userAgent, "h8b2-test-agent");

  const refreshResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: loginPayload.refreshToken })
  });
  assert.equal(refreshResponse.status, 200);
  const refreshed = await refreshResponse.json();
  assert.ok(refreshed.refreshToken);
  assert.notEqual(refreshed.refreshToken, loginPayload.refreshToken);

  const oldReuse = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: loginPayload.refreshToken })
  });
  assert.equal(oldReuse.status, 401);
  assert.equal((await oldReuse.json()).code, "REFRESH_REUSE_DETECTED");

  const refreshedAccess = jwt.decode(refreshed.accessToken);
  assert.equal(refreshedAccess.sid, accessPayload.sid);

  const activeRows = await prisma.refreshToken.findMany({
    where: {
      userId: testAdminId,
      sessionId: accessPayload.sid,
      revoked: false
    }
  });
  assert.equal(activeRows.length, 0);
});

test("H8B-2 - single logout invalidates that session access token", { concurrency: false }, async () => {
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "test-admin@hospital.local",
      password: "test-admin-password"
    })
  });
  assert.equal(loginResponse.status, 200);
  const session = await loginResponse.json();

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken })
  });
  assert.equal(logout.status, 200);

  const access = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  assert.equal(access.status, 401);
  assert.equal((await access.json()).code, "SESSION_REVOKED");
});

test("01 - document download requires authentication", { concurrency: false }, async () => {
  const claim = await createClaim();
  const { doc } = await createDocument(claim.id);

  const response = await fetch(`${baseUrl}/api/documents/${doc.id}/download`);
  assert.equal(response.status, 401);
});

test("B2 - global document list is unavailable; claim-scoped list returns only its documents", { concurrency: false }, async () => {
  const firstClaim = await createClaim();
  const secondClaim = await createClaim();
  const { doc: firstDoc } = await createDocument(firstClaim.id);
  const { doc: secondDoc } = await createDocument(secondClaim.id);

  const globalList = await authFetch("/api/documents/list");
  assert.equal(globalList.status, 404);

  const scoped = await authFetch(`/api/documents/claim/${firstClaim.id}`);
  assert.equal(scoped.status, 200);
  const docs = await scoped.json();
  assert.ok(docs.some((doc) => doc.id === firstDoc.id));
  assert.ok(!docs.some((doc) => doc.id === secondDoc.id));
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

test("03b - legacy and current document URLs serve identical protected content", { concurrency: false }, async () => {
  const claim = await createClaim();
  const expected = "shared-serving-regression";
  const { doc } = await createDocument(claim.id, {
    fileName: "safe-report.txt",
    contents: expected
  });

  for (const url of [
    `/api/documents/${doc.id}`,
    `/api/claims/${doc.id}`
  ]) {
    for (const action of ["preview", "download"]) {
      const unauthenticated = await fetch(`${baseUrl}${url}/${action}`);
      assert.equal(unauthenticated.status, 401);

      const response = await authFetch(`${url}/${action}`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), expected);
      assert.match(response.headers.get("cache-control") || "", /private.*no-store/i);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    }
  }
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

test("06b - current and legacy delete endpoints share safe behavior", { concurrency: false }, async () => {
  for (const prefix of ["/api/claims/documents", "/api/documents"]) {
    const claim = await createClaim({ documentDerivedFields: ["amount"] });
    const { doc, physicalPath } = await createDocument(claim.id);
    const response = await authFetch(`${prefix}/${doc.id}`, { method: "DELETE" });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success === true || payload.ok === true, true);
    assert.equal(payload.remainingDocuments, 0);
    assert.equal(await prisma.document.count({ where: { claimId: claim.id } }), 0);
    assert.equal(fs.existsSync(physicalPath), false);
  }
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
  assert.equal(Number(updated.amount), 900);
  assert.equal(Number(updated.totalBilledAmount), 950);
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
  assert.equal(Number(updated.amount), 900);
  assert.equal(Number(updated.totalBilledAmount), 900);
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

test("13b - canonical document bulk deletion removes the file and updates the claim", { concurrency: false }, async () => {
  const claim = await createClaim();
  const { doc, physicalPath } = await createDocument(claim.id);
  const response = await authFetch("/api/documents/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [doc.id] })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deleted, 1);
  assert.equal(await prisma.document.count({ where: { id: doc.id } }), 0);
  assert.equal(fs.existsSync(physicalPath), false);
});

test("13c - canonical document suggestion endpoint updates the type", { concurrency: false }, async () => {
  const claim = await createClaim();
  const { doc } = await createDocument(claim.id, { type: "FINAL_BILL" });
  await prisma.document.update({
    where: { id: doc.id },
    data: { suggestedType: "INSURANCE_CARD" }
  });
  const response = await authFetch(`/api/documents/${doc.id}/apply-suggestion`, {
    method: "POST"
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).type, "INSURANCE_CARD");
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

test("14b - admin rules affect advisory checks but cannot disable required policy gate", { concurrency: false }, async () => {
  // Skip if migration hasn't been applied (organizationId field missing)
  try {
    await prisma.rule.findFirst({ where: { organizationId: TEST_ORG_ID } });
  } catch (e) {
    console.log("Skipping rule test - migration not applied yet");
    return;
  }

  const previousIcd = await prisma.rule.findFirst({ where: { organizationId: TEST_ORG_ID, code: "RECOMMENDED_ICD" } });
  const previousPolicy = await prisma.rule.findFirst({ where: { organizationId: TEST_ORG_ID, code: "REQ_POLICY_NO" } });
  try {
    await prisma.rule.upsert({
      where: { organizationId_code: { organizationId: TEST_ORG_ID, code: "RECOMMENDED_ICD" } },
      create: { organizationId: TEST_ORG_ID, code: "RECOMMENDED_ICD", name: "ICD-10 recommended", severity: "WARN", enabled: false },
      update: { enabled: false, severity: "WARN" }
    });
    await prisma.rule.upsert({
      where: { organizationId_code: { organizationId: TEST_ORG_ID, code: "REQ_POLICY_NO" } },
      create: { organizationId: TEST_ORG_ID, code: "REQ_POLICY_NO", name: "Policy number required", severity: "INFO", enabled: false },
      update: { enabled: false, severity: "INFO" }
    });
    const claim = await createClaim();
    await prisma.claim.update({ where: { id: claim.id }, data: { policyNo: null, icd10Codes: [] } });
    await createDocument(claim.id);
    const first = await authFetch(`/api/claims/${claim.id}/check`, { method: "POST" });
    assert.equal(first.status, 200);
    const firstCheck = await first.json();
    assert.ok(firstCheck.issues.some((issue) => issue.rule === "REQ_POLICY_NO" && issue.severity === "BLOCK"));
    assert.ok(!firstCheck.issues.some((issue) => issue.rule === "RECOMMENDED_ICD"));

    await prisma.rule.update({ where: { organizationId_code: { organizationId: TEST_ORG_ID, code: "RECOMMENDED_ICD" } }, data: { enabled: true, severity: "WARN" } });
    const second = await authFetch(`/api/claims/${claim.id}/check`, { method: "POST" });
    assert.equal(second.status, 200);
    const secondCheck = await second.json();
    assert.ok(secondCheck.issues.some((issue) => issue.rule === "RECOMMENDED_ICD" && issue.severity === "WARN"));
  } finally {
    for (const [code, previous] of [["RECOMMENDED_ICD", previousIcd], ["REQ_POLICY_NO", previousPolicy]]) {
      if (previous) {
        await prisma.rule.update({
          where: { organizationId_code: { organizationId: TEST_ORG_ID, code } },
          data: { enabled: previous.enabled, severity: previous.severity, name: previous.name }
        });
      } else {
        await prisma.rule.deleteMany({ where: { organizationId: TEST_ORG_ID, code } });
      }
    }
  }
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

test("18 - shared document responder never marks PHI preview cache as public", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(backendRoot, "src/services/documentResponse.js"),
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
      claimType: "MEMBER_REIMBURSEMENT",
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
  const detailSource = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );
  const utilsSource = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/claim-detail/claimDetailUtils.js"),
    "utf8"
  );
  const source = `${detailSource}\n${utilsSource}`;

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
  assert.match(source, /Check Eligibility/);
  assert.match(source, /Review Prior Auth/);
  assert.match(source, /Fix before submission/);
  assert.match(source, /readiness-issue-/);
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
      claimType: "MEMBER_REIMBURSEMENT",
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
  assert.equal(Number(updated.patientResponsibility), 2000);
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

test("40 - claim detail merges automation provenance into one completion card", { concurrency: false }, () => {
  const detailSource = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );
  const completionSource = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/claim-detail/ClaimCompletenessCard.jsx"),
    "utf8"
  );
  const source = `${detailSource}\n${completionSource}`;

  assert.doesNotMatch(detailSource, /<ClaimAutomationCard/);
  assert.match(detailSource, /automation=\{claim\.automationSummary\}/);
  assert.match(completionSource, /Claim Completion/);
  assert.match(completionSource, /auto-filled/);
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


test("45 - unified completion chips filter auto-filled, missing and review fields", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/claim-detail/ClaimCompletenessCard.jsx"),
    "utf8"
  );

  assert.match(source, /showFilter\("automated"\)/);
  assert.match(source, /showFilter\("review"\)/);
  assert.match(source, /showFilter\("missing"\)/);
  assert.match(source, /auto-filled/);
  assert.match(source, /need review/);
  assert.doesNotMatch(source, /manual/);
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
  assert.match(source, /label="Allowed Amount"/);
  assert.match(source, /label="Paid Amount"/);
  assert.match(source, /Auto-calculated; editable/);
  assert.match(source, /Check Remittance/);
  assert.match(source, /Payer-reported values are locked/);
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

test("58 - journey UI enforces payer prerequisite and disables terminal controls", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/journey/ClaimJourney.jsx"),
    "utf8"
  );

  assert.match(source, /actionable=\{payerConnected && stages\.eligibility\.actionable\}/);
  assert.match(source, /actionable=\{payerConnected && stages\.priorAuth\.actionable\}/);
  assert.match(source, /disabled=\{!payerConnected \|\| action !== "" \|\| eligibilityComplete\}/);
  assert.match(source, /Connect the payer above before checking Prior Authorization/);
  assert.match(source, /disabled=\{!stages\.claimStatus\.actionable\}/);
  assert.match(
    source,
    /!stages\.remittance\.actionable \|\|[\s\S]*!\["APPROVED", "PARTIALLY_APPROVED", "PAID"\]\.includes/
  );
  assert.match(source, /claim\.remittanceStatus === "POSTED"/);
  assert.match(source, /View Remittance Details/);
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
  assert.ok(secondBody.comparison.scoreDelta >= 0);
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

test("62 - readiness UI uses a clear submission threshold and collapsed history", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );

  assert.match(source, /check\.score >= 80/);
  assert.match(source, /check\.score >= 50/);
  assert.match(source, /Submit threshold 80%/);
  assert.match(source, /Readiness history/);
  assert.match(source, /Recheck Readiness/);
  assert.match(source, /Claim information changed\. Recheck readiness/);
  assert.doesNotMatch(source, /Estimated Rejection Risk/);
  assert.doesNotMatch(source, /Top risk drivers/);
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

  assert.ok(body.score < 40);
  assert.ok(body.riskScore >= Math.min(0.95, (100 - body.score) / 100));
  assert.equal(body.riskLevel, "HIGH");
});

test("65 - AI check refresh keeps claim detail mounted and returns to simplified readiness area", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );

  assert.match(source, /load\(\{ silent: true \}\)/);
  assert.match(source, /readinessRef\.current\?\.scrollIntoView/);
  assert.match(source, /data-testid="readiness-score"/);
  assert.match(source, /data-testid="readiness-progress"/);
  assert.doesNotMatch(source, /Estimated Rejection Risk/);
});

test("66 - claim-readiness dialog shows domain-specific staged workflow", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/components/AICheckProgress.jsx"),
    "utf8"
  );

  assert.match(source, /Checking Claim Readiness/);
  assert.match(source, /Reading claim documents/);
  assert.match(source, /Checking clinical & policy data/);
  assert.match(source, /Reviewing payer & authorization rules/);
  assert.match(source, /Calculating readiness & rejection risk/);
  assert.match(source, /claimAiSpin/);
  assert.match(source, /HealthAndSafetyIcon/);
});


test("67 - claim detail silently refreshes after journey navigation or tab focus", { concurrency: false }, () => {
  const detailSource = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );
  const hookSource = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/claim-detail/useClaimDetailData.js"),
    "utf8"
  );
  const source = `${detailSource}\n${hookSource}`;

  assert.match(source, /window\.addEventListener\("focus", refresh\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", handleVisibility\)/);
  assert.match(detailSource, /useClaimDetailData\(id, location\.key\)/);
  assert.match(source, /load\(\{ silent: true \}\)/);
});

test("68 - stale readiness never guesses whether old issues are resolved", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );

  assert.doesNotMatch(source, /function isIssueResolvedByCurrentClaim\(issue\)/);
  assert.match(source, /data-testid="readiness-stale"/);
  assert.match(source, /Recheck readiness to recalculate the score and current blockers/);
  assert.doesNotMatch(source, /Completed since the last readiness check/);
  assert.doesNotMatch(source, /Completed — recheck readiness/);
});

test("69 - journey fix workflow provides contextual return to claim detail", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/journey/ClaimJourney.jsx"),
    "utf8"
  );

  assert.match(source, /location\.state\?\.from/);
  assert.match(source, /location\.state\?\.backLabel/);
  assert.match(source, /navigate\(location\.state\.from\)/);
});


test("70 - outpatient claim marks inpatient and ICU fields not applicable", { concurrency: false }, () => {
  const summary = buildClaimCompleteness({
    patientName: "Outpatient Test",
    payerName: "Payer",
    policyNo: "POL-OUT-001",
    memberId: "MEM-OUT-001",
    diagnosisText: "Migraine",
    icd10Codes: ["G43.009"],
    dateOfService: new Date("2026-09-20"),
    amount: 500,
    totalBilledAmount: 500,
    hospitalName: "Clinic",
    doctorName: "Dr Test",
    eligibilityStatus: "VERIFIED",
    priorAuthStatus: "NOT_REQUIRED",
    priorAuthRequired: false,
    documents: [{ type: "FINAL_BILL", rawText: "outpatient clinic visit" }]
  });

  for (const field of ["admissionDate", "dischargeDate", "admissionType", "roomCategory", "icuDays"]) {
    assert.equal(
      summary.fields.find((item) => item.field === field)?.state,
      "not_applicable"
    );
  }
  assert.equal(summary.inpatientLikely, false);
  assert.equal(summary.icuApplicable, false);
});

test("71 - inpatient context makes missing encounter fields require review", { concurrency: false }, () => {
  const summary = buildClaimCompleteness({
    patientName: "Inpatient Test",
    payerName: "Payer",
    policyNo: "POL-IN-001",
    memberId: "MEM-IN-001",
    diagnosisText: "Pneumonia",
    icd10Codes: ["J18.9"],
    dateOfService: new Date("2026-09-20"),
    admissionDate: new Date("2026-09-20"),
    dischargeDate: new Date("2026-09-22"),
    amount: 5000,
    totalBilledAmount: 5000,
    hospitalName: "Hospital",
    doctorName: "Dr Test",
    eligibilityStatus: "VERIFIED",
    priorAuthStatus: "NOT_REQUIRED",
    priorAuthRequired: false,
    documents: [{ type: "DISCHARGE_SUMMARY", rawText: "patient admitted and discharged" }]
  });

  assert.equal(summary.inpatientLikely, true);
  assert.equal(
    summary.fields.find((item) => item.field === "admissionType")?.state,
    "review"
  );
  assert.equal(
    summary.fields.find((item) => item.field === "roomCategory")?.state,
    "review"
  );
  assert.ok(summary.score < 100);
});

test("72 - ICU evidence makes ICU days contextually applicable", { concurrency: false }, () => {
  const { summary, issues } = completenessReadinessIssues({
    patientName: "ICU Test",
    payerName: "Payer",
    policyNo: "POL-ICU-001",
    memberId: "MEM-ICU-001",
    diagnosisText: "Critical illness",
    icd10Codes: ["Z99.11"],
    dateOfService: new Date("2026-09-20"),
    admissionDate: new Date("2026-09-20"),
    dischargeDate: new Date("2026-09-23"),
    admissionType: "EMERGENCY",
    roomCategory: "ICU",
    amount: 10000,
    totalBilledAmount: 10000,
    eligibilityStatus: "VERIFIED",
    priorAuthStatus: "NOT_REQUIRED",
    priorAuthRequired: false,
    documents: [{ type: "FINAL_BILL", rawText: "ICU charges intensive care" }]
  });

  assert.equal(summary.icuApplicable, true);
  assert.equal(
    summary.fields.find((item) => item.field === "icuDays")?.state,
    "review"
  );
  assert.ok(
    issues.some((issue) => /ICU utilization detected but ICU days need review/i.test(issue.message))
  );
});

test("73 - AI readiness cannot remain 100 when applicable inpatient fields are unresolved", { concurrency: false }, async () => {
  const claim = await createClaim();
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      memberId: "MEM-COMPLETE-001",
      dateOfService: new Date("2026-09-20"),
      admissionDate: new Date("2026-09-20"),
      dischargeDate: new Date("2026-09-22"),
      admissionType: null,
      roomCategory: null
    }
  });
  await createDocument(claim.id, {
    type: "DISCHARGE_SUMMARY",
    contents: "patient admitted on 09/20 and discharged on 09/22",
    extracted: {
      patientName: "Lifecycle Test Patient",
      admissionDate: "2026-09-20",
      dischargeDate: "2026-09-22"
    }
  });

  const response = await authFetch(`/api/claims/${claim.id}/check`, {
    method: "POST"
  });
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.ok(body.score < 100);
  assert.ok(
    body.issues.some((issue) => /admission type needs review/i.test(issue.message))
  );
  assert.ok(
    body.issues.some((issue) => /room category needs review/i.test(issue.message))
  );
});

test("74 - claim update saves encounter fields used by completeness fixes", { concurrency: false }, async () => {
  const claim = await createClaim();

  const response = await authFetch(`/api/claims/${claim.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientName: claim.patientName,
      payerName: claim.payerName,
      policyNo: claim.policyNo,
      memberId: "MEM-EDIT-001",
      diagnosisText: claim.diagnosisText,
      icd10Codes: claim.icd10Codes,
      amount: claim.amount,
      totalBilledAmount: claim.totalBilledAmount,
      claimType: "MEMBER_REIMBURSEMENT",
      dateOfService: "2026-09-20",
      admissionDate: "2026-09-20",
      dischargeDate: "2026-09-22",
      admissionType: "EMERGENCY",
      roomCategory: "ICU",
      icuDays: 2
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.admissionType, "EMERGENCY");
  assert.equal(body.roomCategory, "ICU");
  assert.equal(body.icuDays, 2);
  assert.equal(body.completenessSummary.icuApplicable, true);
});

test("75 - claim detail exposes one clickable context-aware completion card", { concurrency: false }, () => {
  const detailSource = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/ClaimDetail.jsx"),
    "utf8"
  );
  const completenessSource = fs.readFileSync(
    path.join(frontendRoot, "src/modules/ai-claims/claim-detail/ClaimCompletenessCard.jsx"),
    "utf8"
  );
  const source = `${detailSource}\n${completenessSource}`;

  assert.match(source, /Claim Completion/);
  assert.match(source, /One view of what is complete, missing, auto-filled, or waiting for review/);
  assert.match(source, /completenessValue/);
  assert.match(source, /fixCompletenessItem/);
  assert.match(source, /Review codes/);
  assert.doesNotMatch(completenessSource, /manual/);
  assert.doesNotMatch(completenessSource, /N\/A/);
});


test("76 - medical consistency blocks admission date after discharge date", { concurrency: false }, () => {
  const analysis = analyzeMedicalConsistency({
    id: "mc-date-order",
    admissionDate: new Date("2026-09-22"),
    dischargeDate: new Date("2026-09-20"),
    documents: []
  });

  assert.equal(analysis.status, "BLOCKED");
  assert.ok(
    analysis.issues.some((item) =>
      /Admission is after discharge/i.test(item.title)
    )
  );
});

test("77 - medical consistency warns when service date falls outside encounter", { concurrency: false }, () => {
  const analysis = analyzeMedicalConsistency({
    id: "mc-service-date",
    admissionDate: new Date("2026-09-20"),
    dischargeDate: new Date("2026-09-22"),
    dateOfService: new Date("2026-09-25"),
    documents: [{ type: "DISCHARGE_SUMMARY" }]
  });

  assert.equal(analysis.status, "NEEDS_REVIEW");
  assert.ok(
    analysis.issues.some((item) =>
      /Service date outside encounter/i.test(item.title)
    )
  );
});

test("78 - medical consistency blocks ICU days exceeding length of stay", { concurrency: false }, () => {
  const analysis = analyzeMedicalConsistency({
    id: "mc-icu-days",
    admissionDate: new Date("2026-09-20"),
    dischargeDate: new Date("2026-09-22"),
    roomCategory: "ICU",
    icuDays: 5,
    documents: [{ type: "DISCHARGE_SUMMARY" }]
  });

  assert.equal(analysis.status, "BLOCKED");
  assert.ok(
    analysis.issues.some((item) =>
      /ICU days exceed length of stay/i.test(item.title)
    )
  );
});

test("79 - medical consistency warns when ICU days conflict with room category", { concurrency: false }, () => {
  const analysis = analyzeMedicalConsistency({
    id: "mc-icu-room",
    admissionDate: new Date("2026-09-20"),
    dischargeDate: new Date("2026-09-22"),
    roomCategory: "PRIVATE",
    icuDays: 1,
    documents: [{ type: "DISCHARGE_SUMMARY" }]
  });

  assert.ok(
    analysis.issues.some((item) =>
      /ICU utilization conflicts with room category/i.test(item.title)
    )
  );
});

test("80 - inpatient claim without discharge summary needs documentation review", { concurrency: false }, () => {
  const analysis = analyzeMedicalConsistency({
    id: "mc-discharge-doc",
    admissionDate: new Date("2026-09-20"),
    dischargeDate: new Date("2026-09-22"),
    documents: [{ type: "FINAL_BILL" }]
  });

  assert.ok(
    analysis.issues.some((item) =>
      /Discharge summary not found/i.test(item.title)
    )
  );
});

test("81 - recorded procedure without clinical support document is flagged", { concurrency: false }, () => {
  const analysis = analyzeMedicalConsistency({
    id: "mc-procedure-doc",
    procedureText: "Test procedure",
    documents: [{ type: "FINAL_BILL" }]
  });

  assert.ok(
    analysis.issues.some((item) =>
      /Procedure lacks supporting clinical document/i.test(item.title)
    )
  );
});

test("82 - conflicting document dates are detected", { concurrency: false }, () => {
  const analysis = analyzeMedicalConsistency({
    id: "mc-doc-conflict",
    documents: [
      {
        id: "doc-a",
        type: "FINAL_BILL",
        fileName: "bill.pdf",
        extracted: { dateOfService: "2026-09-20" }
      },
      {
        id: "doc-b",
        type: "DISCHARGE_SUMMARY",
        fileName: "discharge.pdf",
        extracted: { dateOfService: "2026-09-21" }
      }
    ]
  });

  const conflict = analysis.issues.find((item) =>
    /Documents disagree on date of service/i.test(item.title)
  );
  assert.ok(conflict);
  assert.equal(conflict.evidence.length, 2);
});

test("83 - clean internally consistent claim can score 100", { concurrency: false }, () => {
  const analysis = analyzeMedicalConsistency({
    id: "mc-clean",
    diagnosisText: "Pneumonia",
    icd10Codes: ["J18.9"],
    admissionDate: new Date("2026-09-20"),
    dischargeDate: new Date("2026-09-22"),
    dateOfService: new Date("2026-09-21"),
    roomCategory: "PRIVATE",
    icuDays: 0,
    documents: [
      {
        type: "DISCHARGE_SUMMARY",
        extracted: {
          dateOfService: "2026-09-21",
          diagnosisText: "Pneumonia"
        }
      }
    ]
  });

  assert.equal(analysis.status, "CONSISTENT");
  assert.equal(analysis.score, 100);
  assert.equal(analysis.issues.length, 0);
});

test("84 - medical consistency findings reduce AI readiness", { concurrency: false }, async () => {
  const claim = await createClaim();
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      memberId: "MEM-MED-READY",
      policyNo: "POL-MED-READY",
      eligibilityStatus: "VERIFIED",
      priorAuthRequired: false,
      priorAuthStatus: "NOT_REQUIRED",
      dateOfService: new Date("2026-09-25"),
      admissionDate: new Date("2026-09-20"),
      dischargeDate: new Date("2026-09-22")
    }
  });

  await createDocument(claim.id, {
    type: "DISCHARGE_SUMMARY",
    extracted: {
      patientName: "Lifecycle Test Patient",
      diagnosisText: "Test diagnosis",
      icd10Codes: ["Z00.00"],
      dateOfService: "2026-09-25"
    }
  });

  const response = await authFetch(`/api/claims/${claim.id}/check`, {
    method: "POST"
  });
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.ok(body.score < 100);
  assert.ok(
    body.issues.some((item) =>
      /Service date outside encounter/i.test(item.message)
    )
  );
  assert.equal(body.medicalConsistency.status, "NEEDS_REVIEW");
});

test("85 - medical consistency UI provides dashboard metrics findings and fix navigation", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/medical-ai/MedicalConsistency.jsx"),
    "utf8"
  );

  assert.match(source, /Medical Consistency/);
  assert.match(source, /Claims Reviewed/);
  assert.match(source, /Needs Review/);
  assert.match(source, /Consistency Score/);
  assert.match(source, /Fix in Claim/);
  assert.match(source, /params\.set\("edit", "1"\)/);
  assert.match(source, /params\.set\("focus", fields\.join\(","\)\)/);
  assert.match(source, /Passed Checks/);
  assert.match(source, /Decision support only/);
});


test("86 - mock payer directory exposes five synthetic payer profiles", { concurrency: false }, () => {
  const payers = listMockPayers();
  assert.equal(payers.length, 5);
  assert.deepEqual(
    payers.map((payer) => payer.code),
    ["BLUE_HORIZON", "SUMMITCARE", "METROPLUS_DEMO", "CAREFIRST_DEMO", "APEX_BENEFIT"]
  );
});

test("87 - CareFirst demo eligibility is member-sensitive", { concurrency: false }, () => {
  const payer = getMockPayer("CAREFIRST_DEMO");
  const bad = simulateEligibility(payer, {
    id: "cf-bad",
    memberId: "MEM-123",
    policyNo: "POL-123"
  });
  const good = simulateEligibility(payer, {
    id: "cf-good",
    memberId: "CF-123",
    policyNo: "POL-123"
  });

  assert.equal(bad.status, "MEMBER_NOT_FOUND");
  assert.equal(good.status, "ACTIVE");
  assert.equal(good.coverageStatus, "ACTIVE");
});

test("88 - SummitCare requires auth for MRI and approves recorded authorization", { concurrency: false }, () => {
  const payer = getMockPayer("SUMMITCARE");
  const base = {
    id: "summit-mri",
    procedureText: "MRI lumbar spine"
  };

  const required = simulatePriorAuth(payer, base);
  assert.equal(required.required, true);
  assert.equal(required.status, "REQUIRED");

  const approved = simulatePriorAuth(payer, {
    ...base,
    authorizationNo: "AUTH-SC-100"
  });
  assert.equal(approved.status, "APPROVED");
});

test("89 - MetroPlus mock pends inpatient claim without discharge summary", { concurrency: false }, () => {
  const payer = getMockPayer("METROPLUS_DEMO");
  const result = simulateSubmission(payer, {
    id: "metro-docs",
    admissionDate: new Date("2026-09-20"),
    priorAuthStatus: "NOT_REQUIRED",
    documents: [{ type: "FINAL_BILL" }]
  });

  assert.equal(result.status, "PENDED");
  assert.match(result.reason, /discharge summary/i);
});

test("90 - simulated claim status progresses received to review to payer outcome", { concurrency: false }, () => {
  const payer = getMockPayer("BLUE_HORIZON");
  const claim = {
    id: "status-progress",
    priorAuthStatus: "NOT_REQUIRED",
    documents: [{ type: "DISCHARGE_SUMMARY" }]
  };

  assert.equal(simulateStatus(payer, claim, 0).status, "RECEIVED");
  assert.equal(simulateStatus(payer, claim, 1).status, "IN_REVIEW");
  assert.equal(simulateStatus(payer, claim, 2).status, "APPROVED");
});

test("91 - Apex remittance creates deterministic underpayment demo", { concurrency: false }, () => {
  const payer = getMockPayer("APEX_BENEFIT");
  const result = simulateRemittance(payer, {
    id: "apex-payment",
    amount: 20000,
    coinsurancePct: 0
  });

  assert.equal(result.allowedAmount, 13600);
  assert.equal(result.paidAmount, 10880);
  assert.equal(result.patientResponsibility, 0);
  assert.equal(result.expectedPayerPayment, 13600);
  assert.equal(result.potentialUnderpayment, 2720);
  assert.ok(result.paidAmount < result.expectedPayerPayment);
});

test("92 - payer simulator frontend exposes connection workflow and transaction history", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/journey/ClaimJourney.jsx"),
    "utf8"
  );

  assert.match(source, /Payer Connection/);
  assert.match(source, /Connected/);
  assert.match(source, /Check Eligibility/);
  assert.match(source, /Check Prior Auth/);
  assert.match(source, /Submit to Payer/);
  assert.match(source, /Check Status/);
  assert.match(source, /Check Remittance/);
  assert.match(source, /Payer Activity/);
});


test("93 - payer request fingerprints change only when relevant inputs change", { concurrency: false }, () => {
  const payer = getMockPayer("BLUE_HORIZON");
  const base = {
    id: "fingerprint",
    memberId: "MEM-1",
    policyNo: "POL-1",
    patientDob: new Date("1980-01-01"),
    procedureText: "MRI lumbar spine",
    dateOfService: new Date("2026-09-20"),
    authorizationNo: "AUTH-1",
    amount: 10000,
    totalBilledAmount: 10000,
    icd10Codes: ["M54.5"],
    documents: [{ id: "doc-1", type: "RADIOLOGY", createdAt: new Date("2026-09-20") }]
  };

  const a = payerInputFingerprint("ELIGIBILITY", payer, base);
  const b = payerInputFingerprint("ELIGIBILITY", payer, { ...base, doctorName: "Changed" });
  const c2 = payerInputFingerprint("ELIGIBILITY", payer, { ...base, memberId: "MEM-2" });

  assert.equal(a, b);
  assert.notEqual(a, c2);
});

test("94 - approved payer status includes adjudication amounts for automatic remittance display", { concurrency: false }, () => {
  const payer = getMockPayer("BLUE_HORIZON");
  const claim = {
    id: "amounts",
    amount: 10000,
    coinsurancePct: 15,
    priorAuthStatus: "NOT_REQUIRED",
    documents: []
  };
  const result = simulateStatus(payer, claim, 2, 3);

  assert.equal(result.status, "APPROVED");
  assert.ok(result.allowedAmount > 0);
  assert.ok(result.approvedAmount > 0);
  assert.equal(
    result.patientResponsibility,
    result.allowedAmount - result.approvedAmount
  );
});

test("95 - adjudication and remittance amounts remain internally consistent for every payer", { concurrency: false }, () => {
  for (const payer of listMockPayers()) {
    const full = getMockPayer(payer.code);
    const claim = { id: payer.code, amount: 20000, coinsurancePct: 20 };
    const adjudication = calculateAdjudication(full, claim);
    const remittance = simulateRemittance(full, claim);

    assert.ok(adjudication.allowedAmount >= adjudication.approvedAmount);
    assert.equal(
      adjudication.patientResponsibility,
      adjudication.allowedAmount - adjudication.approvedAmount
    );
    assert.equal(remittance.allowedAmount, adjudication.allowedAmount);
    assert.equal(remittance.expectedPayerPayment, adjudication.approvedAmount);
    assert.equal(
      remittance.patientResponsibility,
      adjudication.allowedAmount - adjudication.approvedAmount
    );
    assert.equal(
      remittance.potentialUnderpayment,
      adjudication.approvedAmount - remittance.paidAmount
    );
  }
});

test("96 - payer engine covers a broad Cartesian matrix without invalid states", { concurrency: false }, () => {
  const services = [
    { name: "office", procedureText: "Office consultation" },
    { name: "mri", procedureText: "MRI lumbar spine" },
    { name: "ct", procedureText: "CT chest" },
    { name: "surgery", procedureText: "Operative surgical repair", admissionDate: new Date("2026-09-20") }
  ];
  const memberVariants = [true, false];
  const dischargeVariants = [true, false];
  const authVariants = [null, "AUTH-100", "AUTH-DENY"];
  let cases = 0;

  for (const payerSummary of listMockPayers()) {
    const payer = getMockPayer(payerSummary.code);
    for (const service of services) {
      for (const validMember of memberVariants) {
        for (const hasDischarge of dischargeVariants) {
          for (const authorizationNo of authVariants) {
            const claim = {
              id: `matrix-${cases}`,
              memberId:
                payer.code === "CAREFIRST_DEMO"
                  ? validMember ? "CF-100" : "MEM-100"
                  : validMember ? "MEM-100" : null,
              policyNo: "POL-100",
              amount: 25000,
              totalBilledAmount: 25000,
              diagnosisText: "Test diagnosis",
              icd10Codes: ["Z00.00"],
              coinsurancePct: 20,
              authorizationNo,
              priorAuthStatus: authorizationNo === "AUTH-100" ? "APPROVED" : "NOT_REQUIRED",
              documents: hasDischarge ? [{ type: "DISCHARGE_SUMMARY" }] : [{ type: "FINAL_BILL" }],
              ...service
            };

            const eligibility = simulateEligibility(payer, claim);
            const auth = simulatePriorAuth(payer, claim);
            const submission = simulateSubmission(payer, claim);
            const status = simulateStatus(payer, claim, 2, 3);

            assert.ok(eligibility.status);
            assert.ok(auth.status);
            assert.ok(submission.status);
            assert.ok(status.status);
            assert.ok(Number.isFinite(eligibility.latencyMs));
            cases += 1;
          }
        }
      }
    }
  }

  assert.equal(cases, 240);
});

test("97 - payer Journey UI uses one action surface and client-facing wording", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/journey/ClaimJourney.jsx"),
    "utf8"
  );

  assert.match(source, /Payer Connection/);
  assert.match(source, /Check Eligibility/);
  assert.match(source, /Check Prior Auth/);
  assert.match(source, /Submit to Payer/);
  assert.match(source, /Check Status/);
  assert.match(source, /Check Remittance/);
  assert.match(source, /Show activity/);
  assert.match(source, /Hide activity/);
  assert.match(source, /Change payer/);
  assert.match(source, /connected-payer/);
  assert.match(source, /Expected Payer Payment/);
  assert.doesNotMatch(source, />SIMULATED</);
  assert.doesNotMatch(source, />LOCAL</);
  assert.doesNotMatch(source, /Mock Payer/);
  assert.doesNotMatch(source, /manual •/i);
});


test("F5 - claims router delegates payer simulation and journey concerns to focused modules", () => {
  const claimsSource = fs.readFileSync(path.join(backendRoot, "src/routes/claims.js"), "utf8");
  const payerSource = fs.readFileSync(path.join(backendRoot, "src/routes/claimPayerSimulation.js"), "utf8");
  const journeySource = fs.readFileSync(path.join(backendRoot, "src/routes/claimJourney.js"), "utf8");

  assert.match(claimsSource, /router\.use\(claimPayerSimulationRouter\)/);
  assert.match(claimsSource, /router\.use\(claimJourneyRouter\)/);
  assert.doesNotMatch(claimsSource, /router\.post\("\/:id\/payer-simulation/);
  assert.doesNotMatch(claimsSource, /router\.post\("\/:id\/journey\/eligibility/);
  assert.match(payerSource, /router\.post\("\/:id\/payer-simulation\/eligibility/);
  assert.match(journeySource, /router\.post\("\/:id\/journey\/eligibility\/precheck/);
  // Keep this architecture test behavioral instead of enforcing a brittle
  // source-line limit. The assertions above verify that payer/journey routes
  // are delegated and not re-embedded in the claims router.
});

test("98 - payer switch requires fresh eligibility and authorization", { concurrency: false }, () => {
  const routeSource = fs.readFileSync(
    path.join(backendRoot, "src/routes/claimPayerSimulation.js"),
    "utf8"
  );
  assert.match(routeSource, /simulatedPayerCode: payer.code,[\s\S]*eligibilityStatus: "NOT_CHECKED"/);
  assert.match(routeSource, /priorAuthStatus: "NOT_CHECKED"/);
});

test("99 - status polling requires acknowledged transmission", { concurrency: false }, () => {
  const routeSource = fs.readFileSync(
    path.join(backendRoot, "src/routes/claimPayerSimulation.js"),
    "utf8"
  );
  assert.match(routeSource, /Wait until the claim has been transmitted and acknowledged/);
});

test("100 - payer financial cross-product never transfers short payment to the patient", { concurrency: false }, () => {
  const amounts = [0, 1, 150, 9850, 25000, 50000, 99000];
  const coinsuranceOptions = [0, 10, 15, 20, 30, 50, 100];
  let combinations = 0;
  for (const summary of listMockPayers()) {
    const payer = getMockPayer(summary.code);
    for (const amount of amounts) {
      for (const coinsurancePct of coinsuranceOptions) {
        const claim = { id: `fin-${combinations}`, amount, coinsurancePct };
        const approval = calculateAdjudication(payer, claim);
        const era = simulateRemittance(payer, claim);
        assert.ok(approval.allowedAmount >= approval.approvedAmount);
        assert.ok(era.paidAmount <= era.approvedAmount);
        assert.equal(era.patientResponsibility, approval.patientResponsibility);
        assert.equal(moneyCents(era.potentialUnderpayment), moneyCents(approval.approvedAmount) - moneyCents(era.paidAmount));
        assert.equal(
          moneyCents(era.allowedAmount),
          moneyCents(era.paidAmount) + moneyCents(era.patientResponsibility) + moneyCents(era.potentialUnderpayment)
        );
        combinations += 1;
      }
    }
  }
  assert.equal(combinations, 245);
});

test("101 - approval estimates do not impersonate a posted remittance", { concurrency: false }, () => {
  const source = fs.readFileSync(
    path.join(frontendRoot, "src/modules/journey/ClaimJourney.jsx"),
    "utf8"
  );
  assert.match(source, /Expected Payer Payment/);
  assert.match(source, /Check Remittance/);
  assert.match(source, /Payer-reported values have been posted and locked/);
  assert.match(source, /View Remittance Details/);
  assert.match(source, /Potential payer underpayment/);
  assert.match(source, /Demo environment/);
});


test("102 - a previous payer's not-required decision cannot bypass a new payer's authorization rule", { concurrency: false }, () => {
  const payer = getMockPayer("SUMMITCARE");
  const claim = {
    id: "auth-regression",
    procedureText: "MRI lumbar spine",
    memberId: "SC-101",
    policyNo: "POL-101",
    priorAuthStatus: "NOT_REQUIRED",
    authorizationNo: null,
    documents: [{ type: "RADIOLOGY" }],
    amount: 10000
  };
  const attempt = simulateSubmission(payer, claim);
  assert.equal(attempt.status, "REJECTED");
  assert.match(attempt.reason, /authorization/i);
  const approved = simulateSubmission(payer, {
    ...claim,
    priorAuthStatus: "APPROVED",
    authorizationNo: "AUTH-SC-101"
  });
  assert.equal(approved.status, "ACCEPTED");
});


test("103 - receptionist cannot submit or delete claims or supporting documents", { concurrency: false }, async () => {
  const admin = await prisma.user.findUnique({ where: { email: "test-admin@hospital.local" } });
  const receptionistToken = jwt.sign({
    sub: admin.id,
    email: admin.email,
    role: "RECEPTIONIST",
    organizationId: admin.organizationId,
    type: "access"
  }, process.env.JWT_SECRET || "claim-app-ci-only-signing-secret-32-characters", { expiresIn: "5m" });
  const claim = await createClaim();
  const { doc } = await createDocument(claim.id);
  const call = (endpoint, method, body) => fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${receptionistToken}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  assert.equal((await call(`/api/claims/${claim.id}/submit`, "POST")).status, 403);
  assert.equal((await call(`/api/claims/${claim.id}`, "DELETE")).status, 403);
  assert.equal((await call(`/api/documents/${doc.id}`, "DELETE")).status, 403);
  assert.equal((await call(`/api/claims/documents/${doc.id}`, "DELETE")).status, 403);
  assert.ok(await prisma.claim.findUnique({ where: { id: claim.id } }));
  assert.ok(await prisma.document.findUnique({ where: { id: doc.id } }));
});


test("H8B-1 - rule APIs hide foreign tenant rules and enforce admin role", { concurrency: false }, async () => {
  const foreignOrgId = "org_h8b1_api_foreign";
  await prisma.organization.upsert({
    where: { id: foreignOrgId },
    update: {},
    create: { id: foreignOrgId, name: "H8B1 API Foreign", slug: "h8b1-api-foreign" }
  });

  const ownRule = await prisma.rule.create({
    data: {
      organizationId: TEST_ORG_ID,
      code: `OWN_${Date.now()}`,
      name: "Own API rule",
      severity: "WARN"
    }
  });
  const foreignRule = await prisma.rule.create({
    data: {
      organizationId: foreignOrgId,
      code: `FOREIGN_${Date.now()}`,
      name: "Foreign API rule",
      severity: "WARN"
    }
  });

  try {
    assert.equal((await authFetch(`/api/rules/${foreignRule.id}`)).status, 404);
    assert.equal((await authFetch(`/api/rules/${foreignRule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Should not change" })
    })).status, 404);
    assert.equal((await authFetch(`/api/rules/${foreignRule.id}`, {
      method: "DELETE"
    })).status, 404);
    assert.ok(await prisma.rule.findUnique({ where: { id: foreignRule.id } }));

    const ownDelete = await authFetch(`/api/rules/${ownRule.id}`, { method: "DELETE" });
    assert.equal(ownDelete.status, 200);
    assert.equal((await authFetch(`/api/rules/${ownRule.id}`, { method: "DELETE" })).status, 404);

    const cashierToken = jwt.sign({
      sub: testAdminId,
      email: "test-admin@hospital.local",
      role: "CASHIER",
      organizationId: TEST_ORG_ID,
      type: "access"
    }, process.env.JWT_SECRET || "claim-app-ci-only-signing-secret-32-characters", { expiresIn: "5m" });

    const cashierRules = await fetch(`${baseUrl}/api/rules`, {
      headers: { Authorization: `Bearer ${cashierToken}` }
    });
    assert.equal(cashierRules.status, 403);
  } finally {
    await prisma.rule.deleteMany({ where: { id: { in: [ownRule.id, foreignRule.id] } } });
    await prisma.organization.deleteMany({ where: { id: foreignOrgId } });
  }
});

test("H8B-1 - foreign denial, underpayment and journey APIs return not found", { concurrency: false }, async () => {
  const foreignOrgId = "org_h8b1_api_resources";
  await prisma.organization.upsert({
    where: { id: foreignOrgId },
    update: {},
    create: { id: foreignOrgId, name: "H8B1 Foreign Resources", slug: "h8b1-foreign-resources" }
  });
  const foreignClaim = await prisma.claim.create({
    data: {
      organizationId: foreignOrgId,
      patientName: "H8B1 Foreign Patient",
      payerName: "Foreign Payer",
      amount: 1000
    }
  });
  const foreignDenial = await prisma.denialCase.create({
    data: { claimId: foreignClaim.id, status: "OPEN", denialCategory: "OTHER" }
  });
  const foreignUnderpayment = await prisma.underpaymentCase.create({
    data: {
      claimId: foreignClaim.id,
      status: "OPEN",
      expectedPayerPayment: 1000,
      actualPaidAmount: 800,
      varianceAmount: 200
    }
  });
  await prisma.payerTransaction.create({
    data: {
      claimId: foreignClaim.id,
      transactionId: `H8B1-${Date.now()}`,
      mode: "SIMULATED",
      payerCode: "MOCK",
      transactionType: "ELIGIBILITY",
      status: "ACTIVE"
    }
  });

  try {
    assert.equal((await authFetch(`/api/denials/${foreignDenial.id}`)).status, 404);
    assert.equal((await authFetch(`/api/denials/${foreignDenial.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ANALYZED" })
    })).status, 404);

    assert.equal((await authFetch(`/api/underpayments/${foreignUnderpayment.id}`)).status, 404);
    assert.equal((await authFetch(`/api/underpayments/${foreignUnderpayment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "Should not change" })
    })).status, 404);

    assert.equal((await authFetch(`/api/claims/${foreignClaim.id}/journey`)).status, 404);
  } finally {
    await prisma.payerTransaction.deleteMany({ where: { claimId: foreignClaim.id } });
    await prisma.underpaymentCase.deleteMany({ where: { claimId: foreignClaim.id } });
    await prisma.denialCase.deleteMany({ where: { claimId: foreignClaim.id } });
    await prisma.claim.deleteMany({ where: { id: foreignClaim.id } });
    await prisma.organization.deleteMany({ where: { id: foreignOrgId } });
  }
});

test("H8B-1 - permanent purge is ADMIN-only", { concurrency: false }, async () => {
  const claim = await createClaim();
  await prisma.claim.update({
    where: { id: claim.id },
    data: { deletedAt: new Date() }
  });

  const cashierToken = jwt.sign({
    sub: testAdminId,
    email: "test-admin@hospital.local",
    role: "CASHIER",
    organizationId: TEST_ORG_ID,
    type: "access"
  }, process.env.JWT_SECRET || "claim-app-ci-only-signing-secret-32-characters", { expiresIn: "5m" });

  const response = await fetch(`${baseUrl}/api/claims/${claim.id}/purge`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${cashierToken}` }
  });

  assert.equal(response.status, 403);
  assert.ok(await prisma.claim.findUnique({ where: { id: claim.id } }));
});

test("103 - document reprocessing cannot mutate transmitted or terminal claims", { concurrency: false }, async () => {
  for (const status of ["SUBMITTED", "DENIED", "PAID"]) {
    const claim = await createClaim({ status });
    const { doc } = await createDocument(claim.id);
    const before = await prisma.claim.findUnique({ where: { id: claim.id } });
    const response = await authFetch(`/api/documents/${doc.id}/process`, {
      method: "POST"
    });
    assert.equal(response.status, 409, `${status} must reject reprocessing`);
    const after = await prisma.claim.findUnique({ where: { id: claim.id } });
    assert.equal(after.status, before.status);
  }

  const claim = await createClaim();
  await prisma.claim.update({
    where: { id: claim.id },
    data: { claimSubmissionDate: new Date(), status: "DRAFT" }
  });
  const { doc } = await createDocument(claim.id);
  const response = await authFetch(`/api/documents/${doc.id}/process`, {
    method: "POST"
  });
  assert.equal(response.status, 409, "submission timestamp must also lock reprocessing");
});

test("B8 - claim creation rejects lifecycle, payment and identity-field mass assignment", { concurrency: false }, async () => {
  const base = { patientName: "Lifecycle Test Create", payerName: "Test Payer", amount: 1250 };
  const malicious = [
    { status: "SUBMITTED" },
    { eligibilityStatus: "VERIFIED" },
    { priorAuthStatus: "APPROVED" },
    { paidAmount: 1000 },
    { claimSubmissionDate: new Date().toISOString() },
    { id: "caller-chosen-claim-id" },
    { fieldProvenance: {} }
  ];
  for (const extra of malicious) {
    const response = await authFetch("/api/claims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...base, ...extra })
    });
    assert.equal(response.status, 400, `must reject ${Object.keys(extra)[0]}`);
    assert.equal((await response.json()).code, "INVALID_CLAIM_INPUT");
  }
  const legitimate = await authFetch("/api/claims", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(base)
  });
  assert.equal(legitimate.status, 200);
  const claim = await legitimate.json();
  assert.equal(claim.status, "DRAFT");
  assert.equal(claim.patientName, base.patientName);
});

test("F3 - organization isolation blocks cross-tenant claim, document and denial access", { concurrency: false }, async () => {
  const otherOrg = await prisma.organization.upsert({
    where: { slug: "f3-other-hospital" },
    update: {},
    create: { name: "F3 Other Hospital", slug: "f3-other-hospital" }
  });
  const otherUser = await prisma.user.upsert({
    where: { email: "f3-other-admin@hospital.local" },
    update: { organizationId: otherOrg.id, role: "ADMIN" },
    create: {
      email: "f3-other-admin@hospital.local",
      passwordHash: await bcrypt.hash("unused-test-password", 10),
      role: "ADMIN",
      organizationId: otherOrg.id
    }
  });
  const foreignClaim = await prisma.claim.create({
    data: {
      organizationId: otherOrg.id,
      createdById: otherUser.id,
      patientName: "Lifecycle Test Other Tenant",
      payerName: "Other Tenant Payer",
      amount: 100,
      totalBilledAmount: 100
    }
  });
  const foreignDoc = await prisma.document.create({
    data: {
      claimId: foreignClaim.id,
      type: "OTHER",
      fileName: "foreign.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      path: "foreign.pdf"
    }
  });
  const foreignDenial = await prisma.denialCase.create({
    data: { claimId: foreignClaim.id, source: "MANUAL" }
  });

  const claimResponse = await authFetch(`/api/claims/${foreignClaim.id}`);
  assert.equal(claimResponse.status, 404);

  const documentsResponse = await authFetch(`/api/documents/claim/${foreignClaim.id}`);
  assert.equal(documentsResponse.status, 200);
  assert.deepEqual(await documentsResponse.json(), []);

  const denialResponse = await authFetch(`/api/denials/${foreignDenial.id}`);
  assert.equal(denialResponse.status, 404);

  const listResponse = await authFetch("/api/claims");
  const visibleClaims = await listResponse.json();
  assert.equal(visibleClaims.some((claim) => claim.id === foreignClaim.id), false);

  const otherToken = jwt.sign(
    {
      sub: otherUser.id,
      email: otherUser.email,
      role: otherUser.role,
      organizationId: otherOrg.id,
      type: "access"
    },
    process.env.JWT_SECRET || "claim-app-test-secret",
    { expiresIn: "5m" }
  );
  const ownResponse = await fetch(`${baseUrl}/api/claims/${foreignClaim.id}`, {
    headers: { Authorization: `Bearer ${otherToken}` }
  });
  assert.equal(ownResponse.status, 200);

  await prisma.document.deleteMany({ where: { id: foreignDoc.id } });
  await prisma.denialCase.deleteMany({ where: { id: foreignDenial.id } });
  await prisma.claim.deleteMany({ where: { id: foreignClaim.id } });
});

test("F7 - denial API rejects skipped lifecycle transitions", { concurrency: false }, async () => {
  const claim = await createClaim();
  const denial = await prisma.denialCase.create({
    data: {
      claimId: claim.id,
      source: "MANUAL",
      status: "OPEN"
    }
  });

  const response = await authFetch(`/api/denials/${denial.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "APPEAL_SUBMITTED" })
  });

  assert.equal(response.status, 409);
  const body = await response.json();
  assert.match(body.error, /Invalid denial case status transition/);

  const persisted = await prisma.denialCase.findUnique({ where: { id: denial.id } });
  assert.equal(persisted.status, "OPEN");
});

test("F6 - remaining claim and journey mutations reject unsupported fields", { concurrency: false }, async () => {
  const claim = await createClaim();

  const patch = await authFetch(`/api/claims/${claim.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientName: claim.patientName,
      payerName: claim.payerName,
      policyNo: claim.policyNo,
      memberId: claim.memberId,
      amount: "1200.00",
      totalBilledAmount: "1200.00",
      icd10Codes: ["Z00.00"],
      status: "PAID"
    })
  });
  assert.equal(patch.status, 400);
  assert.equal((await patch.json()).code, "INVALID_REQUEST_INPUT");

  const eligibility = await authFetch(`/api/claims/${claim.id}/journey/eligibility/precheck`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId: "attacker-controlled-org" })
  });
  assert.equal(eligibility.status, 400);
  assert.equal((await eligibility.json()).code, "INVALID_REQUEST_INPUT");

  const priorAuth = await authFetch(`/api/claims/${claim.id}/journey/prior-auth/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ required: false, createdById: "other-user" })
  });
  assert.equal(priorAuth.status, 400);
  assert.equal((await priorAuth.json()).code, "INVALID_REQUEST_INPUT");

  const payerConnect = await authFetch(`/api/claims/${claim.id}/payer-simulation/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payerCode: "BLUE_HORIZON", status: "PAID" })
  });
  assert.equal(payerConnect.status, 400);
  assert.equal((await payerConnect.json()).code, "INVALID_REQUEST_INPUT");

  const readiness = await authFetch(`/api/claims/${claim.id}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score: 100 })
  });
  assert.equal(readiness.status, 400);
  assert.equal((await readiness.json()).code, "INVALID_REQUEST_INPUT");

  const unchanged = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(unchanged.status, "DRAFT");
  assert.equal(unchanged.organizationId, TEST_ORG_ID);
});

test("F6 - valid normalized journey payloads still pass the validation boundary", { concurrency: false }, async () => {
  const claim = await createClaim();
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      memberId: "F6-MEMBER",
      policyNo: "F6-POLICY",
      eligibilityStatus: "VERIFIED"
    }
  });

  const response = await authFetch(`/api/claims/${claim.id}/journey/prior-auth/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      required: true,
      authorizationNo: "AUTH-F6-100",
      expiry: "2026-12-31"
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "APPROVED");
});

test("F4 - claim delete is soft, hidden from normal APIs, and retains an audit trail", { concurrency: false }, async () => {
  const createResponse = await authFetch("/api/claims", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientName: "Lifecycle Test F4 Soft Delete",
      payerName: "Lifecycle Test Payer",
      amount: "123.45",
      totalBilledAmount: "123.45",
      icd10Codes: []
    })
  });
  assert.equal(createResponse.status, 200);
  const claim = await createResponse.json();
  const { doc } = await createDocument(claim.id, {
    fileName: "f4-retained-document.txt",
    contents: "soft delete retention"
  });

  const patchResponse = await authFetch(`/api/claims/${claim.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientName: "Lifecycle Test F4 Updated",
      payerName: "Lifecycle Test Payer",
      amount: "123.45",
      totalBilledAmount: "123.45",
      icd10Codes: []
    })
  });
  assert.equal(patchResponse.status, 200);

  const auditBeforeDelete = await authFetch(`/api/claims/${claim.id}/audit`);
  assert.equal(auditBeforeDelete.status, 200);
  const beforeItems = (await auditBeforeDelete.json()).items;
  assert.ok(beforeItems.some((event) => event.action === "CLAIM_CREATED"));
  assert.ok(beforeItems.some((event) => event.action === "CLAIM_UPDATED"));

  const deleteResponse = await authFetch(`/api/claims/${claim.id}`, { method: "DELETE" });
  assert.equal(deleteResponse.status, 200);
  assert.equal((await deleteResponse.json()).softDeleted, true);

  const persisted = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.ok(persisted);
  assert.ok(persisted.deletedAt instanceof Date);
  assert.ok(await prisma.document.findUnique({ where: { id: doc.id } }));

  assert.equal((await authFetch(`/api/claims/${claim.id}`)).status, 404);
  const docsResponse = await authFetch(`/api/documents/claim/${claim.id}`);
  assert.equal(docsResponse.status, 200);
  assert.deepEqual(await docsResponse.json(), []);

  const listResponse = await authFetch("/api/claims");
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).some((item) => item.id === claim.id), false);

  const auditEvents = await prisma.auditEvent.findMany({
    where: { claimId: claim.id },
    orderBy: { createdAt: "asc" }
  });
  assert.ok(auditEvents.some((event) => event.action === "CLAIM_SOFT_DELETED"));
  assert.ok(auditEvents.every((event) => event.organizationId === TEST_ORG_ID));
  assert.ok(auditEvents.every((event) => event.actorUserId === testAdminId));
});

test("B7 - API errors retain consistent fields without database exception details", { concurrency: false }, async () => {
  const notFound = await authFetch("/api/rules/definitely-missing-rule");
  assert.equal(notFound.status, 404);
  const missing = await notFound.json();
  assert.equal(missing.code, "NOT_FOUND");
  assert.equal(missing.message, missing.error);

  const ruleUpdate = await authFetch("/api/rules/definitely-missing-rule", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Regression" })
  });
  assert.equal(ruleUpdate.status, 404);
  const updated = await ruleUpdate.json();
  assert.deepEqual(updated, { error: "Rule not found", message: "Rule not found", code: "NOT_FOUND" });
  assert.doesNotMatch(JSON.stringify(updated), /Prisma|P2025|Record to update/i);

  const invalid = await authFetch("/api/claims", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patientName: "Lifecycle Test Invalid", payerName: "Test", amount: -1 })
  });
  assert.equal(invalid.status, 400);
  const bad = await invalid.json();
  assert.equal(typeof bad.error, "string");
  assert.equal(typeof bad.message, "string");
  assert.equal(typeof bad.code, "string");
});

test("B1 - reprocessing a document with an empty stored path returns 404", { concurrency: false }, async () => {
  const claim = await createClaim();
  const { doc } = await createDocument(claim.id);
  await prisma.document.update({
    where: { id: doc.id },
    data: { path: "" }
  });

  const response = await authFetch(`/api/documents/${doc.id}/process`, {
    method: "POST"
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "File not found on server", message: "File not found on server", code: "NOT_FOUND" });
});

test("stabilization - legacy document path resolver cannot escape upload root", { concurrency: false }, () => {
  const root = path.resolve(backendRoot, "uploads");
  assert.equal(resolveStoredDocument("uploads/record.pdf", root), path.join(root, "record.pdf"));
  assert.equal(resolveStoredDocument("record.pdf", root), path.join(root, "record.pdf"));
  assert.equal(resolveStoredDocument("../../outside.pdf", root), path.join(root, "outside.pdf"));
  assert.equal(resolveStoredDocument(null, root), null);
  assert.equal(safeDownloadName('../../note\r\nInjected: yes.pdf').includes("\r"), false);
});

test("stabilization - legacy claim document endpoints prevent directory escape and private caching", { concurrency: false }, async () => {
  const claim = await createClaim();
  const document = await createDocument(claim.id, {
    type: "FINAL_BILL",
    path: "../../outside-never-show.pdf"
  });
  const response = await authFetch(`/api/claims/${document.id}/preview`);
  assert.equal(response.status, 404);
  assert.ok(!String(await response.text()).includes("outside-never-show"));
  const claimsSource = fs.readFileSync(path.join(backendRoot, "src/routes/claims.js"), "utf8");
  const sharedSource = fs.readFileSync(path.join(backendRoot, "src/services/documentResponse.js"), "utf8");
  assert.match(claimsSource, /serveStoredDocument\(prisma, req, res/);
  assert.match(sharedSource, /openStoredDocument\(doc.path, \{ uploadDir \}\)/);
  const storageSource = fs.readFileSync(
    path.join(backendRoot, "src/services/documentStorage.js"),
    "utf8"
  );
  assert.match(storageSource, /resolveStoredDocument\(storedPath, uploadDir\)/);
  assert.match(sharedSource, /"private, no-store(?:, max-age=0)?"/);
});

test("money - create and retrieve exact cent amounts without rounding to dollars", { concurrency: false }, async () => {
  const response = await authFetch("/api/claims", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patientName: "Exact Cent Test",
      payerName: "Test Payer",
      amount: "1234.56",
      totalBilledAmount: "1234.56"
    })
  });
  assert.equal(response.status, 200);
  const claim = await response.json();
  assert.equal(claim.amount, 1234.56);
  const saved = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(saved.amount.toFixed(2), "1234.56");
  await prisma.claim.delete({ where: { id: claim.id } });
});

test("money - reject excess fractional precision at claim creation", { concurrency: false }, async () => {
  const response = await authFetch("/api/claims", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patientName: "Precision Test", payerName: "Test Payer", amount: "1234.567" })
  });
  assert.equal(response.status, 400);
});

test("money - remittance preserves exact cents and is idempotent on replay", { concurrency: false }, async () => {
  const claim = await createClaim({ status: "SUBMITTED", claimSubmissionDate: new Date(), amount: 2000 });
  const request = {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      remittanceStatus: "RECEIVED",
      allowedAmount: "1234.56",
      paidAmount: "1000.01",
      paymentReference: "CENT-PAY-100"
    })
  };
  const response = await authFetch(`/api/claims/${claim.id}/journey/remittance`, request);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.patientResponsibility, 234.55);
  const saved = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(saved.allowedAmount.toFixed(2), "1234.56");
  assert.equal(saved.paidAmount.toFixed(2), "1000.01");
  assert.equal(saved.patientResponsibility.toFixed(2), "234.55");
  const repeat = await authFetch(`/api/claims/${claim.id}/journey/remittance`, request);
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).unchanged, true);
});
