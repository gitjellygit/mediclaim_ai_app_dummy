import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateUsReadinessRules } from "../src/services/usReadinessRules.js";
import { buildApprovalIntelligenceItem } from "../src/services/approvalIntelligence.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("connected payer mismatch is a mandatory readiness blocker", () => {
  const issues = evaluateUsReadinessRules({
    payerName: "Cedar Health Plan",
    connectedPayerName: "Blue Horizon Health",
    billingProviderNpi: "1234567890",
    memberId: "M1",
    serviceLines: [],
    icd10Codes: []
  }, []);
  const mismatch = issues.find((issue) => issue.rule === "US_PAYER_SOURCE_MATCH");
  assert.ok(mismatch);
  assert.equal(mismatch.severity, "BLOCK");
});

test("matching payer identity does not create payer-source blocker", () => {
  const issues = evaluateUsReadinessRules({
    payerName: "Blue Horizon Health",
    connectedPayerName: "Blue Horizon Health",
    billingProviderNpi: "1234567890",
    memberId: "M1",
    serviceLines: [],
    icd10Codes: []
  }, []);
  assert.equal(
    issues.some((issue) => issue.rule === "US_PAYER_SOURCE_MATCH"),
    false
  );
});

test("active underpayment raises queue priority and becomes payment outlook", () => {
  const item = buildApprovalIntelligenceItem({
    id: "c1",
    createdAt: new Date(),
    status: "PAID",
    patientName: "Test Patient",
    payerName: "Test Payer",
    amount: 1000,
    paidAmount: 600,
    eligibilityStatus: "VERIFIED",
    priorAuthStatus: "NOT_REQUIRED",
    serviceLines: [],
    codingSuggestions: [],
    checks: [],
    underpaymentCase: {
      id: "u1",
      status: "OPEN",
      expectedPayerPayment: 900,
      actualPaidAmount: 600,
      varianceAmount: 300
    }
  });

  assert.equal(item.priority, "HIGH");
  assert.equal(item.paymentOutlook.kind, "UNDERPAID");
  assert.equal(item.paymentOutlook.amount, 600);
  assert.equal(item.paymentOutlook.expectedAmount, 900);
  assert.equal(item.paymentOutlook.varianceAmount, 300);
  assert.equal(item.underpayment.id, "u1");
  assert.ok(item.nextActions.some((action) => action.code === "REVIEW_UNDERPAYMENT"));
});

const claimsRoute = read("backend/src/routes/claims.js");
const claimDetail = read("frontend/src/modules/ai-claims/ClaimDetail.jsx");
const queue = read("frontend/src/modules/approval/ApprovalIntelligence.jsx");

test("payer reconciliation preserves source document and audits the override", () => {
  assert.match(claimsRoute, /PAYER_IDENTITY_RECONCILED/);
  assert.match(claimsRoute, /sourceDocumentPreserved: true/);
  assert.match(claimsRoute, /Payer identity reconciled/);
});

test("claim detail exposes payer mismatch reconciliation UX", () => {
  assert.match(claimDetail, /data-testid="payer-source-mismatch"/);
  assert.match(claimDetail, /The uploaded insurance/);
  assert.match(claimDetail, /Reconcile Payer/);
});

test("work queue shows underpayment and direct recovery action", () => {
  assert.match(queue, /Underpayment \{money\(claim\.underpayment\.varianceAmount\)\}/);
  assert.match(queue, /Review Underpayment/);
  assert.match(queue, /revenue-recovery\/underpayments/);
});
