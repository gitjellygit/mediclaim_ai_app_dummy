import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db.js";

const createdClaimIds = [];
const TEST_ORG_ID = "org_test_status_enums";

after(async () => {
  if (createdClaimIds.length) {
    await prisma.claim.deleteMany({ where: { id: { in: createdClaimIds } } });
  }
});

test("F2 - workflow fields are modeled as Prisma enums instead of free-text strings", () => {
  const schema = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../prisma/schema.prisma"),
    "utf8"
  );

  for (const declaration of [
    "status      ClaimStatus @default(DRAFT)",
    "eligibilityStatus       EligibilityStatus @default(NOT_CHECKED)",
    "priorAuthStatus         PriorAuthStatus @default(NOT_CHECKED)",
    "payerClaimStatus        PayerClaimStatus?",
    "remittanceStatus        RemittanceStatus @default(NOT_AVAILABLE)",
    "payerConnectionMode PayerConnectionMode @default(LOCAL)",
    "type      DocumentType",
    "status        DocumentStatus @default(PENDING)",
    "source          DenialCaseSource @default(MANUAL)",
    "status          DenialCaseStatus @default(OPEN)"
  ]) {
    assert.ok(schema.includes(declaration), declaration);
  }
});

test("F2 - valid enum defaults round-trip and invalid states are rejected", async () => {
  await prisma.organization.upsert({ where: { id: TEST_ORG_ID }, update: {}, create: { id: TEST_ORG_ID, name: "Status Enum Test", slug: "status-enum-test" } });
  const claim = await prisma.claim.create({
    data: {
      organizationId: TEST_ORG_ID,
      patientName: "F2 Enum Regression Patient",
      payerName: "F2 Test Payer"
    }
  });
  createdClaimIds.push(claim.id);

  assert.equal(claim.status, "DRAFT");
  assert.equal(claim.eligibilityStatus, "NOT_CHECKED");
  assert.equal(claim.priorAuthStatus, "NOT_CHECKED");
  assert.equal(claim.remittanceStatus, "NOT_AVAILABLE");
  assert.equal(claim.payerConnectionMode, "LOCAL");
  assert.equal(claim.claimType, "MEMBER_REIMBURSEMENT");

  await assert.rejects(
    prisma.claim.update({
      where: { id: claim.id },
      data: { status: "SUBMITED" }
    })
  );

  const document = await prisma.document.create({
    data: {
      claimId: claim.id,
      type: "OTHER",
      fileName: "enum-test.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      path: "enum-test.pdf"
    }
  });
  assert.equal(document.status, "PENDING");

  await assert.rejects(
    prisma.document.update({
      where: { id: document.id },
      data: { type: "NOT_A_REAL_DOCUMENT_TYPE" }
    })
  );

  const denial = await prisma.denialCase.create({
    data: { claimId: claim.id, source: "MANUAL" }
  });
  assert.equal(denial.status, "OPEN");

  await assert.rejects(
    prisma.denialCase.update({
      where: { id: denial.id },
      data: { status: "MAYBE_CLOSED" }
    })
  );
});
