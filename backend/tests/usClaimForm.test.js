import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("U4 - schema and migration distinguish professional and institutional claims", () => {
  const schema = read("backend/prisma/schema.prisma");
  const migration = read(
    "backend/prisma/migrations/20261002112000_claim_form_837p_837i/migration.sql"
  );

  assert.ok(schema.includes("enum ClaimForm"));
  assert.ok(schema.includes("PROFESSIONAL"));
  assert.ok(schema.includes("INSTITUTIONAL"));
  assert.ok(schema.includes("claimForm         ClaimForm?"));

  assert.ok(migration.includes('CREATE TYPE "ClaimForm"'));
  assert.ok(migration.includes("'PROFESSIONAL'"));
  assert.ok(migration.includes("'INSTITUTIONAL'"));
  assert.ok(migration.includes('ADD COLUMN "claimForm" "ClaimForm"'));
});

test("U4 - API accepts claimForm and readiness rules differ for 837P vs 837I", () => {
  const claimsRoute = read("backend/src/routes/claims.js");
  const mutations = read("backend/src/validation/claimMutations.js");

  assert.ok(
    mutations.includes('claimForm: z.enum(["PROFESSIONAL", "INSTITUTIONAL"])')
  );
  assert.ok(
    claimsRoute.includes('claimForm: z.enum(["PROFESSIONAL", "INSTITUTIONAL"])')
  );

  for (const expected of [
    "837P professional claim requires rendering provider NPI",
    "837P professional service lines require Place of Service",
    "837I institutional claim requires Type of Bill",
    "837I institutional service lines require revenue code"
  ]) {
    assert.ok(claimsRoute.includes(expected), expected);
  }
});

test("U4 - new claim and claim detail expose 837P / 837I discriminator", () => {
  const newClaim = read("frontend/src/pages/NewClaim.jsx");
  const detail = read("frontend/src/modules/ai-claims/ClaimDetail.jsx");

  for (const source of [newClaim, detail]) {
    assert.ok(source.includes("Professional (837P)"));
    assert.ok(source.includes("Institutional (837I)"));
    assert.ok(source.includes("claimForm"));
  }

  assert.ok(newClaim.includes("Rendering provider NPI is required for 837P"));
  assert.ok(newClaim.includes("Type of Bill is required for 837I"));
  assert.ok(newClaim.includes("Place of Service is required on every 837P service line"));
  assert.ok(newClaim.includes("Revenue Code is required on every 837I service line"));
});
