import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeAuditMetadata } from "../src/services/auditLog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

test("H8B-3 - audit metadata drops PHI and keeps operational fields", () => {
  const result = sanitizeAuditMetadata({
    patientName: "Jane Doe",
    memberId: "ABC123",
    policyNo: "POL-123",
    diagnosis: "Sensitive diagnosis",
    fileName: "Jane-Doe-EOB.pdf",
    previousStatus: "DRAFT",
    status: "READY",
    changedFields: ["amount", "providerTin"],
    documentCount: 2,
    riskLevel: "HIGH"
  });

  assert.deepEqual(result, {
    previousStatus: "DRAFT",
    status: "READY",
    changedFields: ["amount", "providerTin"],
    documentCount: 2,
    riskLevel: "HIGH"
  });
});

test("H8B-3 - audit API is organization scoped and read-only", () => {
  const source = fs.readFileSync(path.join(root, "backend/src/routes/audit.js"), "utf8");
  assert.match(source, /organizationId:\s*req\.user\.organizationId/);
  assert.match(source, /router\.get\("\/"/);
  assert.doesNotMatch(source, /router\.(post|patch|delete)\(/);
  assert.match(source, /actorUser/);
});

test("H8B-3 - admin audit route and UI are wired", () => {
  const app = fs.readFileSync(path.join(root, "frontend/src/App.jsx"), "utf8");
  const nav = fs.readFileSync(path.join(root, "frontend/src/layout/LeftNav.jsx"), "utf8");
  const screen = fs.readFileSync(path.join(root, "frontend/src/modules/audit/AuditTrail.jsx"), "utf8");

  assert.match(app, /path:\s*"\/audit"/);
  assert.match(nav, /label="Audit Trail"/);
  assert.match(nav, /user\?\.role === "ADMIN"/);
  assert.match(screen, /Security and PHI-access history/);
  assert.match(screen, /Claim ID/);
});

test("H8B-3 - sensitive claim, document, auth, journey and payment actions are covered", () => {
  const claims = fs.readFileSync(path.join(root, "backend/src/routes/claims.js"), "utf8");
  const docs = fs.readFileSync(path.join(root, "backend/src/routes/documents.js"), "utf8");
  const auth = fs.readFileSync(path.join(root, "backend/src/routes/auth.js"), "utf8");
  const journey = fs.readFileSync(path.join(root, "backend/src/routes/claimJourney.js"), "utf8");
  const payer = fs.readFileSync(path.join(root, "backend/src/routes/claimPayerSimulation.js"), "utf8");
  const underpayments = fs.readFileSync(path.join(root, "backend/src/routes/underpayments.js"), "utf8");

  for (const action of ["CLAIM_VIEWED", "CLAIM_READINESS_CHECKED", "CLAIM_CREATED", "CLAIM_UPDATED", "CLAIM_SUBMITTED"]) {
    assert.ok(claims.includes(action), action);
  }
  for (const action of ["DOCUMENT_LIST_VIEWED", "DOCUMENT_DOWNLOADED", "DOCUMENT_PREVIEWED", "DOCUMENT_UPLOADED"]) {
    assert.ok(docs.includes(action), action);
  }
  for (const action of ["LOGIN_SUCCEEDED", "LOGIN_FAILED", "LOGOUT_SUCCEEDED", "SESSION_REVOKED"]) {
    assert.ok(auth.includes(action), action);
  }
  for (const action of ["CLAIM_JOURNEY_VIEWED", "ELIGIBILITY_CHECKED", "PRIOR_AUTH_EVALUATED"]) {
    assert.ok(journey.includes(action), action);
  }
  assert.ok(payer.includes("PAYER_CLAIM_SUBMITTED"));
  assert.ok(underpayments.includes("UNDERPAYMENT_CASE_UPDATED"));
});

test("H8B-3 - permanent purge audit metadata does not retain patient name", () => {
  const claims = fs.readFileSync(path.join(root, "backend/src/routes/claims.js"), "utf8");
  const purgeIndex = claims.indexOf('action: "CLAIM_PERMANENTLY_PURGED"');
  assert.ok(purgeIndex >= 0);
  const block = claims.slice(purgeIndex, purgeIndex + 700);
  assert.doesNotMatch(block, /patientName/);
  assert.match(block, /documentCount/);
});
