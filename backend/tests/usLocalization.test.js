import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyDocument } from "../src/services/docIntel.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("U2 - claim schema uses US insurance terminology and claim types", () => {
  const schema = read("backend/prisma/schema.prisma");

  for (const expected of [
    "PROVIDER_BILLED",
    "MEMBER_REIMBURSEMENT",
    "medicalRecordNumber String?",
    "planAdministratorName String?",
    "coverageLimit      Decimal?",
    "remainingCoverageLimit Decimal?",
    "payerReferenceNo    String?"
  ]) {
    assert.ok(schema.includes(expected), expected);
  }

  assert.equal(/\bCASHLESS\b/.test(schema), false, "CASHLESS");
  assert.equal(
    /(^|\n)\s*REIMBURSEMENT\s*($|\n)/m.test(schema),
    false,
    "legacy REIMBURSEMENT enum value"
  );

  for (const legacy of [
    "uhid",
    "tpaName",
    "sumInsured",
    "balanceSumInsured",
    "tpaReferenceNo"
  ]) {
    assert.equal(schema.includes(legacy), false, legacy);
  }
});

test("U2 - migration preserves existing data while renaming US fields", () => {
  const migration = read(
    "backend/prisma/migrations/20261001193000_us_claim_domain/migration.sql"
  );

  assert.ok(migration.includes("RENAME VALUE 'CASHLESS' TO 'PROVIDER_BILLED'"));
  assert.ok(
    migration.includes(
      "RENAME VALUE 'REIMBURSEMENT' TO 'MEMBER_REIMBURSEMENT'"
    )
  );
  assert.ok(
    migration.includes(
      'RENAME COLUMN "uhid" TO "medicalRecordNumber"'
    )
  );
  assert.ok(
    migration.includes(
      'RENAME COLUMN "tpaName" TO "planAdministratorName"'
    )
  );
});

test("U2 - OCR defaults and identity classification are US-oriented", () => {
  const docIntel = read("backend/src/services/docIntel.js");

  assert.ok(docIntel.includes('process.env.AWS_REGION || "us-east-1"'));
  for (const legacy of ["ap-south-1", "₹", "INR", "aadhaar", "aadhar", "permanent account number"]) {
    assert.equal(docIntel.toLowerCase().includes(legacy.toLowerCase()), false, legacy);
  }

  assert.equal(
    classifyDocument({ fileName: "state_id.pdf", text: "" }).suggestedType,
    "ID_PROOF"
  );
  assert.equal(
    classifyDocument({ fileName: "drivers_license.pdf", text: "" }).suggestedType,
    "ID_PROOF"
  );
  assert.notEqual(
    classifyDocument({ fileName: "pan_card.pdf", text: "" }).suggestedType,
    "ID_PROOF"
  );
});

test("U2 - frontend uses US claim terminology", () => {
  const newClaim = read("frontend/src/pages/NewClaim.jsx");
  const claimDetail = read("frontend/src/modules/ai-claims/ClaimDetail.jsx");

  for (const source of [newClaim, claimDetail]) {
    assert.equal(source.includes("CASHLESS"), false);
    assert.equal(source.includes('"REIMBURSEMENT"'), false);
    assert.equal(source.includes("TPA:"), false);
    assert.equal(source.includes("₹"), false);
  }

  assert.ok(newClaim.includes("Provider Billed"));
  assert.ok(newClaim.includes("Member Reimbursement"));
  assert.ok(newClaim.includes("Medical Record Number (MRN"));
  assert.ok(claimDetail.includes("Plan Administrator"));
  assert.ok(claimDetail.includes("Coverage Limit"));
  assert.ok(claimDetail.includes("Payer Reference"));
});
