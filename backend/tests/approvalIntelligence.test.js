import test from "node:test";
import assert from "node:assert/strict";

import {
  buildApprovalIntelligenceItem,
  daysUntil,
  paymentOutlook
} from "../src/services/approvalIntelligence.js";

const now = new Date("2026-10-12T12:00:00Z");

function baseClaim(overrides = {}) {
  return {
    id: "claim-1",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    patientName: "Test Patient",
    payerName: "Example Health",
    memberId: "M-1",
    policyNo: "P-1",
    insurerClaimNo: null,
    authorizationNo: null,
    claimForm: "PROFESSIONAL",
    status: "READY",
    amount: 1000,
    approvedAmount: null,
    deductionAmount: 0,
    copayAmount: 0,
    eligibilityStatus: "VERIFIED",
    eligibilityCheckedAt: new Date("2026-10-10T00:00:00Z"),
    coverageStatus: "ACTIVE",
    networkStatus: "IN_NETWORK",
    priorAuthRequired: false,
    priorAuthStatus: "NOT_REQUIRED",
    priorAuthExpiry: null,
    timelyFilingDeadline: new Date("2026-12-31T00:00:00Z"),
    payerConnectionMode: "SIMULATED",
    payerConnectorId: null,
    claimSubmissionDate: null,
    documents: [{ id: "doc-1" }],
    serviceLines: [{ id: "line-1", verified: true, cptHcpcsCode: "99213" }],
    codingSuggestions: [],
    checks: [
      {
        id: "check-1",
        createdAt: new Date("2026-10-12T00:00:00Z"),
        score: 92,
        issues: [],
        isStale: false,
        staleReason: null,
        riskScore: 0.08,
        riskLevel: "LOW",
        riskFactors: []
      }
    ],
    ...overrides
  };
}

test("approval intelligence marks a current clean claim ready to submit", () => {
  const item = buildApprovalIntelligenceItem(baseClaim(), { now });

  assert.equal(item.actionState, "READY_TO_SUBMIT");
  assert.equal(item.priority, "LOW");
  assert.equal(item.readiness.score, 92);
  assert.equal(item.readiness.state, "CURRENT");
  assert.equal(item.submissionRisk.level, "LOW");
  assert.match(item.submissionRisk.methodology, /not a payer approval probability/i);
  assert.equal(item.nextActions[0]?.code, "READY_TO_SUBMIT");
});

test("timely filing expiry becomes critical workflow priority", () => {
  const item = buildApprovalIntelligenceItem(
    baseClaim({
      status: "DRAFT",
      timelyFilingDeadline: new Date("2026-10-10T00:00:00Z")
    }),
    { now }
  );

  assert.equal(item.timelyFiling.state, "EXPIRED");
  assert.equal(item.timelyFiling.daysRemaining, -2);
  assert.equal(item.priority, "CRITICAL");
  assert.equal(item.nextActions[0]?.code, "TIMELY_FILING_EXPIRED");
});

test("stale readiness requires refresh before ready-to-submit state", () => {
  const claim = baseClaim();
  claim.checks[0] = {
    ...claim.checks[0],
    isStale: true,
    staleReason: "Claim details changed"
  };

  const item = buildApprovalIntelligenceItem(claim, { now });

  assert.equal(item.actionState, "REFRESH_REQUIRED");
  assert.equal(item.priority, "MEDIUM");
  assert.equal(item.readiness.state, "STALE");
  assert.ok(item.nextActions.some((action) => action.code === "REFRESH_READINESS"));
});

test("unresolved required prior authorization is high priority", () => {
  const item = buildApprovalIntelligenceItem(
    baseClaim({
      status: "DRAFT",
      priorAuthRequired: true,
      priorAuthStatus: "REQUIRED",
      authorizationNo: null
    }),
    { now }
  );

  assert.equal(item.actionState, "ACTION_REQUIRED");
  assert.equal(item.priority, "HIGH");
  assert.ok(item.nextActions.some((action) => action.code === "RESOLVE_PRIOR_AUTH"));
});

test("expired approved authorization is no longer treated as resolved", () => {
  const item = buildApprovalIntelligenceItem(
    baseClaim({
      status: "DRAFT",
      priorAuthRequired: true,
      priorAuthStatus: "APPROVED",
      authorizationNo: "AUTH-1",
      priorAuthExpiry: new Date("2026-10-11T00:00:00Z")
    }),
    { now }
  );

  assert.equal(item.priorAuthorization.expired, true);
  assert.equal(item.actionState, "ACTION_REQUIRED");
  assert.equal(item.priority, "HIGH");
  assert.ok(item.nextActions.some((action) => action.code === "RESOLVE_PRIOR_AUTH"));
});

test("payment outlook follows the claim lifecycle", () => {
  assert.deepEqual(paymentOutlook(baseClaim({ approvedAmount: 725 })), {
    amount: 725,
    kind: "EXPECTED",
    source: "Payer-approved amount awaiting or preceding final payment"
  });

  const estimate = paymentOutlook(
    baseClaim({ amount: 1000, approvedAmount: null, deductionAmount: 125, copayAmount: 25 })
  );
  assert.equal(estimate.amount, 850);
  assert.equal(estimate.kind, "ESTIMATE");
  assert.match(estimate.source, /deductions\/copay/i);

  const denied = paymentOutlook(baseClaim({ status: "DENIED", amount: 1000 }));
  assert.equal(denied.amount, 1000);
  assert.equal(denied.kind, "AT_RISK");

  const paid = paymentOutlook(
    baseClaim({ status: "PAID", approvedAmount: 980, paidAmount: 940 })
  );
  assert.equal(paid.amount, 940);
  assert.equal(paid.kind, "PAID");
  assert.match(paid.source, /actual payer payment/i);
});

test("daysUntil uses calendar-day boundaries", () => {
  assert.equal(daysUntil("2026-10-12", now), 0);
  assert.equal(daysUntil("2026-10-19", now), 7);
  assert.equal(daysUntil("2026-10-11", now), -1);
});
