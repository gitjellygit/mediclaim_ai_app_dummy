import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/db.js";
import { assertExpectedClaimStatus, updateClaimFromExpectedStatus } from "../src/services/claimStateCas.js";

const ORG_ID = "org_claim_state_cas_test";
const claimIds = [];

after(async () => {
  if (claimIds.length) await prisma.claim.deleteMany({ where: { id: { in: claimIds } } });
});

async function makeClaim(status) {
  await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: { id: ORG_ID, name: "Claim CAS Test", slug: "claim-cas-test" }
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: ORG_ID,
      patientName: "CAS Patient",
      payerName: "CAS Payer",
      status
    }
  });
  claimIds.push(claim.id);
  return claim;
}

test("claim status guard detects a status change after an earlier read", async () => {
  const claim = await makeClaim("READY");
  assert.equal(
    await assertExpectedClaimStatus(prisma, claim.id, "READY", { organizationId: ORG_ID }),
    "READY"
  );

  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      status: "SUBMITTING",
      submissionAttemptId: "race-owner",
      submissionStartedAt: new Date()
    }
  });

  await assert.rejects(
    () => assertExpectedClaimStatus(prisma, claim.id, "READY", { organizationId: ORG_ID }),
    (error) => error?.status === 409 && error?.code === "CLAIM_STATE_CHANGED"
  );
});

test("conditional claim update preserves SUBMITTING when READY is no longer current", async () => {
  const claim = await makeClaim("SUBMITTING");

  await assert.rejects(
    () => updateClaimFromExpectedStatus(
      prisma,
      claim.id,
      "READY",
      { status: "DRAFT", patientName: "Unexpected Update" },
      { organizationId: ORG_ID }
    ),
    (error) => error?.status === 409 && error?.code === "CLAIM_STATE_CHANGED"
  );

  const stored = await prisma.claim.findUnique({ where: { id: claim.id } });
  assert.equal(stored.status, "SUBMITTING");
  assert.equal(stored.patientName, "CAS Patient");
});
