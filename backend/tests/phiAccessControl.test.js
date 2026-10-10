import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PERMISSIONS,
  hasPermission,
  permissionList
} from "../src/security/permissions.js";
import {
  minimumNecessaryClaim,
  minimumNecessaryDocument
} from "../src/security/phiView.js";
import { requirePermission } from "../src/middleware/auth.js";
import { forbiddenClaimMutationFields } from "../src/security/claimMutationAccess.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("PHI permissions - role matrix follows minimum necessary", () => {
  assert.equal(hasPermission("RECEPTIONIST", PERMISSIONS.CLAIM_VIEW), true);
  assert.equal(hasPermission("RECEPTIONIST", PERMISSIONS.PATIENT_IDENTITY_VIEW), true);
  assert.equal(hasPermission("RECEPTIONIST", PERMISSIONS.INSURANCE_VIEW), true);
  assert.equal(hasPermission("RECEPTIONIST", PERMISSIONS.CLINICAL_VIEW), false);
  assert.equal(hasPermission("RECEPTIONIST", PERMISSIONS.CLINICAL_EDIT), false);
  assert.equal(hasPermission("RECEPTIONIST", PERMISSIONS.FINANCIAL_VIEW), false);
  assert.equal(hasPermission("RECEPTIONIST", PERMISSIONS.FINANCIAL_EDIT), false);
  assert.equal(hasPermission("RECEPTIONIST", PERMISSIONS.DOCUMENT_VIEW), false);
  assert.equal(hasPermission("RECEPTIONIST", PERMISSIONS.DOCUMENT_DOWNLOAD), false);
  assert.equal(hasPermission("RECEPTIONIST", PERMISSIONS.PAYER_ACTION), false);
  assert.equal(hasPermission("RECEPTIONIST", PERMISSIONS.CLAIM_SUBMIT), false);
  assert.equal(hasPermission("RECEPTIONIST", PERMISSIONS.DENIAL_VIEW), false);
  assert.equal(hasPermission("RECEPTIONIST", PERMISSIONS.AUDIT_VIEW), false);

  assert.equal(hasPermission("CASHIER", PERMISSIONS.CLINICAL_VIEW), true);
  assert.equal(hasPermission("CASHIER", PERMISSIONS.CLINICAL_EDIT), true);
  assert.equal(hasPermission("CASHIER", PERMISSIONS.FINANCIAL_VIEW), true);
  assert.equal(hasPermission("CASHIER", PERMISSIONS.FINANCIAL_EDIT), true);
  assert.equal(hasPermission("CASHIER", PERMISSIONS.DOCUMENT_VIEW), true);
  assert.equal(hasPermission("CASHIER", PERMISSIONS.CLAIM_SUBMIT), true);
  assert.equal(hasPermission("CASHIER", PERMISSIONS.RECOVERY_EDIT), true);
  assert.equal(hasPermission("CASHIER", PERMISSIONS.PAYER_CONNECT), false);
  assert.equal(hasPermission("CASHIER", PERMISSIONS.AUDIT_VIEW), false);

  assert.equal(hasPermission("ADMIN", PERMISSIONS.PAYER_CONNECT), true);
  assert.equal(hasPermission("ADMIN", PERMISSIONS.AUDIT_VIEW), true);
  assert.equal(hasPermission("ADMIN", PERMISSIONS.AUDIT_EXPORT), true);
  assert.equal(hasPermission("ADMIN", PERMISSIONS.USER_ADMIN), true);

  assert.ok(permissionList("ADMIN").length > permissionList("RECEPTIONIST").length);
});

test("PHI view - receptionist receives identity and insurance but not clinical or financial data", () => {
  const claim = {
    id: "claim-1",
    status: "DRAFT",
    patientName: "Avery Morgan",
    patientDob: new Date("1980-01-01T00:00:00.000Z"),
    patientAddress1: "123 Main St",
    medicalRecordNumber: "MRN-1",
    payerName: "Cedar Health",
    policyNo: "POL-1",
    memberId: "MEM-1",
    subscriberName: "Avery Morgan",
    diagnosisText: "Lumbar radiculopathy",
    icd10Codes: ["M54.16"],
    procedureText: "MRI",
    serviceLines: [{ cptHcpcsCode: "99213", charge: 125 }],
    amount: 125,
    totalBilledAmount: 125,
    allowedAmount: 100,
    paidAmount: 80,
    remittanceStatus: "POSTED",
    documents: [{
      id: "doc-1",
      fileName: "clinical.pdf",
      path: "private/path.pdf",
      rawText: "clinical OCR body",
      fileHash: "abc",
      extracted: { diagnosisText: "Lumbar radiculopathy" }
    }],
    payerTransactions: [{ transactionType: "ELIGIBILITY", responsePayload: { status: "ACTIVE" } }],
    denialCases: [{ id: "denial-1", reasonText: "Medical necessity" }],
    underpaymentCase: { id: "under-1", varianceAmount: 20 },
    checks: [{ score: 91, issues: [{ message: "Clinical issue" }] }],
    completenessSummary: { reviewItems: ["Diagnosis"] }
  };

  const safe = minimumNecessaryClaim(claim, { role: "RECEPTIONIST" });

  assert.equal(safe.patientName, "Avery Morgan");
  assert.equal(safe.payerName, "Cedar Health");
  assert.equal(safe.memberId, "MEM-1");

  assert.equal("diagnosisText" in safe, false);
  assert.equal("icd10Codes" in safe, false);
  assert.equal("serviceLines" in safe, false);
  assert.equal("amount" in safe, false);
  assert.equal("allowedAmount" in safe, false);
  assert.equal("paidAmount" in safe, false);
  assert.equal("payerTransactions" in safe, false);
  assert.equal("denialCases" in safe, false);
  assert.equal("underpaymentCase" in safe, false);
  assert.equal("checks" in safe, false);
  assert.equal("completenessSummary" in safe, false);
  assert.deepEqual(safe.documents, []);
});

test("PHI view - cashier receives billing/clinical data but raw document storage data is never exposed", () => {
  const document = {
    id: "doc-1",
    fileName: "clinical.pdf",
    path: "s3://private/key",
    rawText: "full OCR body",
    fileHash: "secret-hash",
    extracted: { diagnosisText: "Supported" }
  };

  const safeDocument = minimumNecessaryDocument(document, { role: "CASHIER" });
  assert.equal(safeDocument.fileName, "clinical.pdf");
  assert.deepEqual(safeDocument.extracted, { diagnosisText: "Supported" });
  assert.equal("path" in safeDocument, false);
  assert.equal("rawText" in safeDocument, false);
  assert.equal("fileHash" in safeDocument, false);

  const claim = minimumNecessaryClaim(
    {
      id: "claim-1",
      patientName: "Avery Morgan",
      diagnosisText: "Supported",
      amount: 100,
      documents: [document],
      payerTransactions: [{ transactionType: "ELIGIBILITY" }],
      denialCases: [{ id: "denial-1" }],
      underpaymentCase: { id: "under-1" }
    },
    { role: "CASHIER" }
  );

  assert.equal(claim.diagnosisText, "Supported");
  assert.equal(claim.amount, 100);
  assert.equal(claim.documents.length, 1);
  assert.equal(claim.payerTransactions.length, 1);
  assert.equal(claim.denialCases.length, 1);
  assert.equal(claim.underpaymentCase.id, "under-1");
});

test("PHI mutation access - receptionist cannot change clinical or financial claim fields", () => {
  const receptionist = { role: "RECEPTIONIST" };
  const cashier = { role: "CASHIER" };

  assert.deepEqual(
    forbiddenClaimMutationFields(receptionist, {
      patientName: "Updated Name",
      memberId: "MEM-2"
    }),
    []
  );

  assert.deepEqual(
    forbiddenClaimMutationFields(receptionist, {
      diagnosisText: "New diagnosis",
      serviceLines: [{ cptHcpcsCode: "99213" }],
      totalBilledAmount: 200
    }),
    ["diagnosisText", "serviceLines", "totalBilledAmount"]
  );

  assert.deepEqual(
    forbiddenClaimMutationFields(cashier, {
      diagnosisText: "New diagnosis",
      serviceLines: [{ cptHcpcsCode: "99213" }],
      totalBilledAmount: 200
    }),
    []
  );
});

test("PHI permission middleware returns a safe 403 and allows authorized billing roles", () => {
  const guard = requirePermission(PERMISSIONS.CLINICAL_VIEW);

  let statusCode = null;
  let payload = null;
  let nextCalled = false;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      return this;
    }
  };

  guard({ user: { role: "RECEPTIONIST" } }, res, () => {
    nextCalled = true;
  });

  assert.equal(statusCode, 403);
  assert.equal(payload.code, "PHI_PERMISSION_DENIED");
  assert.equal(payload.permission, PERMISSIONS.CLINICAL_VIEW);
  assert.equal(nextCalled, false);

  statusCode = null;
  payload = null;
  nextCalled = false;

  guard({ user: { role: "CASHIER" } }, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(statusCode, null);
  assert.equal(payload, null);
});

test("PHI route contract - sensitive surfaces require named permissions", () => {
  const claims = read("src/routes/claims.js");
  const documents = read("src/routes/documents.js");
  const journey = read("src/routes/claimJourney.js");
  const audit = read("src/routes/audit.js");
  const denials = read("src/routes/denials.js");
  const underpayments = read("src/routes/underpayments.js");
  const index = read("src/index.js");
  const auth = read("src/routes/auth.js");

  assert.match(claims, /medical-consistency\/summary", requirePermission\(PERMISSIONS\.CLINICAL_VIEW\)/);
  assert.match(claims, /\/:id\/audit", requirePermission\(PERMISSIONS\.AUDIT_VIEW\)/);
  assert.match(claims, /\/:id\/submit", requirePermission\(PERMISSIONS\.CLAIM_SUBMIT\)/);
  assert.match(documents, /\/:id\/download", requirePermission\(PERMISSIONS\.DOCUMENT_DOWNLOAD\)/);
  assert.match(documents, /\/:id\/preview", requirePermission\(PERMISSIONS\.DOCUMENT_VIEW\)/);
  assert.match(journey, /payer-connection",[\s\S]*requirePermission\(PERMISSIONS\.PAYER_CONNECT\)/);
  assert.match(journey, /remittance\/refresh", requirePermission\(PERMISSIONS\.PAYER_ACTION\), requirePermission\(PERMISSIONS\.FINANCIAL_VIEW\)/);
  assert.match(audit, /\/export", requirePermission\(PERMISSIONS\.AUDIT_EXPORT\)/);
  assert.match(audit, /router\.get\("\/", requirePermission\(PERMISSIONS\.AUDIT_VIEW\)/);
  assert.match(denials, /router\.use\(requirePermission\(PERMISSIONS\.DENIAL_VIEW\)\)/);
  assert.match(underpayments, /router\.use\(requirePermission\(PERMISSIONS\.FINANCIAL_VIEW\)\)/);
  assert.match(index, /permissions: permissionList\(user\)/);
  assert.match(auth, /permissions: permissionList\(user\)/);
});


test("PHI frontend contract - routes and navigation hide restricted healthcare data", () => {
  const app = read("../frontend/src/App.jsx");
  const nav = read("../frontend/src/layout/LeftNav.jsx");
  const detail = read("../frontend/src/modules/ai-claims/ClaimDetail.jsx");
  const list = read("../frontend/src/modules/ai-claims/ClaimsList.jsx");

  assert.match(app, /\/claims\/new"[\s\S]*PERMISSIONS\.CLINICAL_EDIT/);
  assert.match(app, /\/denials"[\s\S]*PERMISSIONS\.DENIAL_VIEW/);
  assert.match(app, /\/payments"[\s\S]*PERMISSIONS\.FINANCIAL_VIEW/);
  assert.match(app, /\/documents"[\s\S]*PERMISSIONS\.DOCUMENT_VIEW/);
  assert.match(app, /\/audit"[\s\S]*PERMISSIONS\.AUDIT_VIEW/);

  assert.match(nav, /hasPermission\(user, PERMISSIONS\.DENIAL_VIEW\)/);
  assert.match(nav, /hasPermission\(user, PERMISSIONS\.FINANCIAL_VIEW\)/);
  assert.match(nav, /hasPermission\(user, PERMISSIONS\.AUDIT_VIEW\)/);

  assert.match(detail, /canEditClinical = hasPermission\(user, PERMISSIONS\.CLINICAL_EDIT\)/);
  assert.match(detail, /"diagnosisText"/);
  assert.match(detail, /"totalBilledAmount"/);
  assert.match(detail, /delete payload\[field\]/);

  assert.match(list, /canCreateFullClaim = hasPermission\(user, PERMISSIONS\.CLINICAL_EDIT\)/);
  assert.match(list, /canViewFinancial = hasPermission\(user, PERMISSIONS\.FINANCIAL_VIEW\)/);
});


test("PHI auth contract - authorization resolves the current database role for active sessions", () => {
  const authMiddleware = read("src/middleware/auth.js");

  assert.match(authMiddleware, /activeSessionUser/);
  assert.match(authMiddleware, /select:[\s\S]*role: true[\s\S]*organizationId: true/);
  assert.match(authMiddleware, /req\.user = tokenUser\(payload, currentUser\)/);
  assert.doesNotMatch(authMiddleware, /req\.user = tokenUser\(payload\);/);
});
