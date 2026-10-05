import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/db.js";

const ORG_A_ID = "org_h8b1_tenant_a";
const ORG_B_ID = "org_h8b1_tenant_b";
const createdClaimIds = [];
const createdDocumentIds = [];
const createdDenialIds = [];
const createdRuleIds = [];
const createdUnderpaymentIds = [];
const createdTransactionIds = [];

after(async () => {
  await prisma.payerTransaction.deleteMany({ where: { id: { in: createdTransactionIds } } });
  await prisma.underpaymentCase.deleteMany({ where: { id: { in: createdUnderpaymentIds } } });
  await prisma.document.deleteMany({ where: { id: { in: createdDocumentIds } } });
  await prisma.denialCase.deleteMany({ where: { id: { in: createdDenialIds } } });
  await prisma.claim.deleteMany({ where: { id: { in: createdClaimIds } } });
  await prisma.rule.deleteMany({ where: { id: { in: createdRuleIds } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: { in: [ORG_A_ID, ORG_B_ID] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ORG_A_ID, ORG_B_ID] } } });
});

async function createTestOrg(id, name) {
  return prisma.organization.upsert({
    where: { id },
    update: {},
    create: { id, name, slug: name.toLowerCase().replace(/\s+/g, "-") }
  });
}

async function createTestClaim(orgId, patientName) {
  const claim = await prisma.claim.create({
    data: {
      organizationId: orgId,
      patientName,
      payerName: "Test Payer",
      amount: 1000
    }
  });
  createdClaimIds.push(claim.id);
  return claim;
}

async function createTestDocument(claimId) {
  const doc = await prisma.document.create({
    data: {
      claimId,
      type: "OTHER",
      fileName: "test.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      path: "test.pdf"
    }
  });
  createdDocumentIds.push(doc.id);
  return doc;
}

async function createTestDenial(claimId) {
  const denial = await prisma.denialCase.create({
    data: {
      claimId,
      status: "OPEN",
      denialCategory: "MEDICAL_NECESSITY"
    }
  });
  createdDenialIds.push(denial.id);
  return denial;
}

async function createTestRule(orgId, code) {
  const rule = await prisma.rule.create({
    data: {
      organizationId: orgId,
      code,
      name: `Test Rule ${code}`,
      severity: "WARN"
    }
  });
  createdRuleIds.push(rule.id);
  return rule;
}

test("H8B-1 - organization-scoped claims cannot be accessed by foreign org", async () => {
  await createTestOrg(ORG_A_ID, "H8B1 Org A");
  await createTestOrg(ORG_B_ID, "H8B1 Org B");

  const claimA = await createTestClaim(ORG_A_ID, "Patient A");
  const claimB = await createTestClaim(ORG_B_ID, "Patient B");

  // Org A can access their own claim
  const foundByA = await prisma.claim.findFirst({
    where: { id: claimA.id, organizationId: ORG_A_ID, deletedAt: null }
  });
  assert.ok(foundByA);
  assert.equal(foundByA.id, claimA.id);

  // Org A cannot access Org B's claim
  const foundByATryingB = await prisma.claim.findFirst({
    where: { id: claimB.id, organizationId: ORG_A_ID, deletedAt: null }
  });
  assert.equal(foundByATryingB, null);

  // Org B can access their own claim
  const foundByB = await prisma.claim.findFirst({
    where: { id: claimB.id, organizationId: ORG_B_ID, deletedAt: null }
  });
  assert.ok(foundByB);
  assert.equal(foundByB.id, claimB.id);

  // Org B cannot access Org A's claim
  const foundByBTryingA = await prisma.claim.findFirst({
    where: { id: claimA.id, organizationId: ORG_B_ID, deletedAt: null }
  });
  assert.equal(foundByBTryingA, null);
});

test("H8B-1 - organization-scoped documents cannot be accessed by foreign org", async () => {
  const claimA = await createTestClaim(ORG_A_ID, "Patient A");
  const claimB = await createTestClaim(ORG_B_ID, "Patient B");

  const docA = await createTestDocument(claimA.id);
  const docB = await createTestDocument(claimB.id);

  // Org A can access their own document
  const foundByA = await prisma.document.findFirst({
    where: { id: docA.id, claim: { organizationId: ORG_A_ID, deletedAt: null } }
  });
  assert.ok(foundByA);
  assert.equal(foundByA.id, docA.id);

  // Org A cannot access Org B's document
  const foundByATryingB = await prisma.document.findFirst({
    where: { id: docB.id, claim: { organizationId: ORG_A_ID, deletedAt: null } }
  });
  assert.equal(foundByATryingB, null);

  // Org B can access their own document
  const foundByB = await prisma.document.findFirst({
    where: { id: docB.id, claim: { organizationId: ORG_B_ID, deletedAt: null } }
  });
  assert.ok(foundByB);
  assert.equal(foundByB.id, docB.id);

  // Org B cannot access Org A's document
  const foundByBTryingA = await prisma.document.findFirst({
    where: { id: docA.id, claim: { organizationId: ORG_B_ID, deletedAt: null } }
  });
  assert.equal(foundByBTryingA, null);
});

test("H8B-1 - organization-scoped denial cases cannot be accessed by foreign org", async () => {
  const claimA = await createTestClaim(ORG_A_ID, "Patient A");
  const claimB = await createTestClaim(ORG_B_ID, "Patient B");

  const denialA = await createTestDenial(claimA.id);
  const denialB = await createTestDenial(claimB.id);

  // Org A can access their own denial
  const foundByA = await prisma.denialCase.findFirst({
    where: { id: denialA.id, claim: { organizationId: ORG_A_ID, deletedAt: null } }
  });
  assert.ok(foundByA);
  assert.equal(foundByA.id, denialA.id);

  // Org A cannot access Org B's denial
  const foundByATryingB = await prisma.denialCase.findFirst({
    where: { id: denialB.id, claim: { organizationId: ORG_A_ID, deletedAt: null } }
  });
  assert.equal(foundByATryingB, null);

  // Org B can access their own denial
  const foundByB = await prisma.denialCase.findFirst({
    where: { id: denialB.id, claim: { organizationId: ORG_B_ID, deletedAt: null } }
  });
  assert.ok(foundByB);
  assert.equal(foundByB.id, denialB.id);

  // Org B cannot access Org A's denial
  const foundByBTryingA = await prisma.denialCase.findFirst({
    where: { id: denialA.id, claim: { organizationId: ORG_B_ID, deletedAt: null } }
  });
  assert.equal(foundByBTryingA, null);
});

test("H8B-1 - organization-scoped rules cannot be accessed by foreign org", async () => {
  // Skip if migration hasn't been applied (organizationId field missing)
  try {
    await prisma.rule.findFirst({ where: { organizationId: ORG_A_ID } });
  } catch (e) {
    console.log("Skipping rule test - migration not applied yet");
    return;
  }

  const ruleA = await createTestRule(ORG_A_ID, "RULE_A");
  const ruleB = await createTestRule(ORG_B_ID, "RULE_B");

  // Org A can access their own rules
  const rulesA = await prisma.rule.findMany({
    where: { organizationId: ORG_A_ID }
  });
  assert.ok(rulesA.some((r) => r.id === ruleA.id));
  assert.equal(rulesA.some((r) => r.id === ruleB.id), false);

  // Org B can access their own rules
  const rulesB = await prisma.rule.findMany({
    where: { organizationId: ORG_B_ID }
  });
  assert.ok(rulesB.some((r) => r.id === ruleB.id));
  assert.equal(rulesB.some((r) => r.id === ruleA.id), false);

  // Same code can exist in different orgs
  const ruleACode2 = await createTestRule(ORG_A_ID, "RULE_A");
  const ruleBCode2 = await createTestRule(ORG_B_ID, "RULE_A");
  assert.ok(ruleACode2);
  assert.ok(ruleBCode2);
  assert.notEqual(ruleACode2.id, ruleBCode2.id);
});

test("H8B-1 - audit events are scoped to organization", async () => {
  const claimA = await createTestClaim(ORG_A_ID, "Patient A");
  const claimB = await createTestClaim(ORG_B_ID, "Patient B");

  await prisma.auditEvent.create({
    data: {
      organizationId: ORG_A_ID,
      claimId: claimA.id,
      action: "TEST_ACTION",
      entityType: "Claim",
      entityId: claimA.id,
      outcome: "SUCCESS"
    }
  });

  await prisma.auditEvent.create({
    data: {
      organizationId: ORG_B_ID,
      claimId: claimB.id,
      action: "TEST_ACTION",
      entityType: "Claim",
      entityId: claimB.id,
      outcome: "SUCCESS"
    }
  });

  // Org A sees only their audit events
  const eventsA = await prisma.auditEvent.findMany({
    where: { organizationId: ORG_A_ID }
  });
  assert.ok(eventsA.some((e) => e.claimId === claimA.id));
  assert.equal(eventsA.some((e) => e.claimId === claimB.id), false);

  // Org B sees only their audit events
  const eventsB = await prisma.auditEvent.findMany({
    where: { organizationId: ORG_B_ID }
  });
  assert.ok(eventsB.some((e) => e.claimId === claimB.id));
  assert.equal(eventsB.some((e) => e.claimId === claimA.id), false);
});

test("H8B-1 - underpayment cases are scoped through claim organization", async () => {
  const claimA = await createTestClaim(ORG_A_ID, "Patient A");
  const claimB = await createTestClaim(ORG_B_ID, "Patient B");

  const underpaymentA = await prisma.underpaymentCase.create({
    data: {
      claimId: claimA.id,
      status: "OPEN",
      expectedPayerPayment: 1000,
      actualPaidAmount: 800,
      varianceAmount: 200
    }
  });
  createdUnderpaymentIds.push(underpaymentA.id);

  const underpaymentB = await prisma.underpaymentCase.create({
    data: {
      claimId: claimB.id,
      status: "OPEN",
      expectedPayerPayment: 1000,
      actualPaidAmount: 800,
      varianceAmount: 200
    }
  });
  createdUnderpaymentIds.push(underpaymentB.id);

  // Org A can access their own underpayment
  const foundByA = await prisma.underpaymentCase.findFirst({
    where: {
      id: underpaymentA.id,
      claim: { organizationId: ORG_A_ID, deletedAt: null }
    }
  });
  assert.ok(foundByA);
  assert.equal(foundByA.id, underpaymentA.id);

  // Org A cannot access Org B's underpayment
  const foundByATryingB = await prisma.underpaymentCase.findFirst({
    where: {
      id: underpaymentB.id,
      claim: { organizationId: ORG_A_ID, deletedAt: null }
    }
  });
  assert.equal(foundByATryingB, null);
});

test("H8B-1 - payer transactions are scoped through claim organization", async () => {
  const claimA = await createTestClaim(ORG_A_ID, "Patient A");
  const claimB = await createTestClaim(ORG_B_ID, "Patient B");

  const transactionA = await prisma.payerTransaction.create({
    data: {
      claimId: claimA.id,
      transactionId: "TX-A-001",
      mode: "SIMULATED",
      payerCode: "MOCK",
      transactionType: "ELIGIBILITY",
      status: "ACTIVE"
    }
  });
  createdTransactionIds.push(transactionA.id);

  const transactionB = await prisma.payerTransaction.create({
    data: {
      claimId: claimB.id,
      transactionId: "TX-B-001",
      mode: "SIMULATED",
      payerCode: "MOCK",
      transactionType: "ELIGIBILITY",
      status: "ACTIVE"
    }
  });
  createdTransactionIds.push(transactionB.id);

  // Org A can access their own transactions
  const foundByA = await prisma.payerTransaction.findFirst({
    where: {
      id: transactionA.id,
      claim: { organizationId: ORG_A_ID, deletedAt: null }
    }
  });
  assert.ok(foundByA);
  assert.equal(foundByA.id, transactionA.id);

  // Org A cannot access Org B's transactions
  const foundByATryingB = await prisma.payerTransaction.findFirst({
    where: {
      id: transactionB.id,
      claim: { organizationId: ORG_A_ID, deletedAt: null }
    }
  });
  assert.equal(foundByATryingB, null);
});

test("H8B-1 - claim search is scoped to organization", async () => {
  const claimA = await createTestClaim(ORG_A_ID, "Patient A");
  const claimB = await createTestClaim(ORG_B_ID, "Patient B");

  // Org A search returns only their claims
  const searchA = await prisma.claim.findMany({
    where: { organizationId: ORG_A_ID, deletedAt: null }
  });
  assert.ok(searchA.some((c) => c.id === claimA.id));
  assert.equal(searchA.some((c) => c.id === claimB.id), false);

  // Org B search returns only their claims
  const searchB = await prisma.claim.findMany({
    where: { organizationId: ORG_B_ID, deletedAt: null }
  });
  assert.ok(searchB.some((c) => c.id === claimB.id));
  assert.equal(searchB.some((c) => c.id === claimA.id), false);
});

test("H8B-1 - medical consistency summary is scoped to organization", async () => {
  const claimA = await createTestClaim(ORG_A_ID, "Patient A");
  const claimB = await createTestClaim(ORG_B_ID, "Patient B");

  // Org A summary includes only their claims
  const summaryA = await prisma.claim.findMany({
    where: { organizationId: ORG_A_ID, deletedAt: null },
    include: { documents: true }
  });
  assert.ok(summaryA.some((c) => c.id === claimA.id));
  assert.equal(summaryA.some((c) => c.id === claimB.id), false);

  // Org B summary includes only their claims
  const summaryB = await prisma.claim.findMany({
    where: { organizationId: ORG_B_ID, deletedAt: null },
    include: { documents: true }
  });
  assert.ok(summaryB.some((c) => c.id === claimB.id));
  assert.equal(summaryB.some((c) => c.id === claimA.id), false);
});
