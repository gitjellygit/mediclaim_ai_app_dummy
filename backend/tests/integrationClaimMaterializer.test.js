import test from "node:test";
import assert from "node:assert/strict";
import {
  canMaterializeCanonicalClaim,
  claimPatchFromCanonical,
  materializeCanonicalClaim
} from "../src/services/integrationClaimMaterializer.js";

test("integration materializer allows incomplete draft before payer completion", () => {
  const data = {
    patientName: "BILLING DEMO PATIENT",
    amount: 100,
    totalBilledAmount: 100
  };
  assert.equal(canMaterializeCanonicalClaim(data), true);
  const patch = claimPatchFromCanonical(data);
  assert.equal(patch.patientName, "BILLING DEMO PATIENT");
  assert.equal(patch.amount, 100);
  assert.equal(patch.payerName, undefined);
});

test("integration materializer still requires patient and positive amount", () => {
  assert.equal(canMaterializeCanonicalClaim({ patientName: "Patient" }), false);
  assert.equal(canMaterializeCanonicalClaim({ amount: 100 }), false);
  assert.equal(canMaterializeCanonicalClaim({ patientName: "Patient", amount: 0 }), false);
});


test("integration materializer replaces a soft-deleted linked claim with a fresh draft", async () => {
  const calls = { created: [], updatedIdentity: [] };
  const tx = {
    claimExternalIdentity: {
      findUnique: async () => ({
        id: "identity-1",
        claimId: "deleted-claim",
        claim: {
          id: "deleted-claim",
          deletedAt: new Date("2026-10-01T00:00:00.000Z"),
          fieldProvenance: {}
        }
      }),
      update: async ({ where, data }) => {
        calls.updatedIdentity.push({ where, data });
        return { id: where.id, ...data };
      },
      create: async () => {
        throw new Error("should not create a second external identity");
      }
    },
    claim: {
      create: async ({ data }) => {
        calls.created.push(data);
        return { id: "fresh-claim", deletedAt: null, ...data };
      },
      update: async () => {
        throw new Error("deleted claim should not be updated");
      }
    }
  };

  const result = await materializeCanonicalClaim(tx, {
    organizationId: "org-1",
    connectionId: "conn-1",
    externalClaimId: "oracle:12742419:97953601",
    data: {
      patientName: "CHIP JOHNSON",
      payerName: "Self Pay",
      amount: 100,
      totalBilledAmount: 100
    },
    actorUserId: "user-1"
  });

  assert.equal(result.materialized, true);
  assert.equal(result.created, true);
  assert.equal(result.claim.id, "fresh-claim");
  assert.equal(result.replacedDeletedClaimId, "deleted-claim");
  assert.equal(calls.created.length, 1);
  assert.deepEqual(calls.updatedIdentity, [
    { where: { id: "identity-1" }, data: { claimId: "fresh-claim" } }
  ]);
});
