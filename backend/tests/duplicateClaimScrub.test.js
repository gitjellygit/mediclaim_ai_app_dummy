import test from "node:test";
import assert from "node:assert/strict";
import { findLikelyDuplicateClaim } from "../src/services/duplicateClaimScrub.js";

function baseClaim(overrides = {}) {
  return {
    id: "claim-new",
    payerName: "Example Health",
    memberId: "MEM-100",
    dateOfService: new Date("2026-10-02T00:00:00.000Z"),
    amount: 125,
    serviceLines: [{
      cptHcpcsCode: "99213",
      modifiers: ["25"],
      serviceDateFrom: new Date("2026-10-02T00:00:00.000Z"),
      serviceDateTo: new Date("2026-10-02T00:00:00.000Z"),
      verified: true
    }],
    ...overrides
  };
}

test("Duplicate scrub returns matching prior claim", async () => {
  const prior = {
    id: "claim-prior",
    amount: 125,
    serviceLines: baseClaim().serviceLines
  };
  const prisma = {
    claim: {
      findMany: async () => [prior]
    }
  };
  assert.equal(
    (await findLikelyDuplicateClaim(prisma, baseClaim(), "org-1")).id,
    "claim-prior"
  );
});

test("Duplicate scrub ignores materially different service patterns", async () => {
  const prisma = {
    claim: {
      findMany: async () => [{
        id: "claim-prior",
        amount: 125,
        serviceLines: [{
          ...baseClaim().serviceLines[0],
          cptHcpcsCode: "93000"
        }]
      }]
    }
  };
  assert.equal(
    await findLikelyDuplicateClaim(prisma, baseClaim(), "org-1"),
    null
  );
});
