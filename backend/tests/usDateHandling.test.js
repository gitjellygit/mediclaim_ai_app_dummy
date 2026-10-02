import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatUSDateOnly,
  parseClaimDate,
  toDateOnlyString
} from "../src/utils/claimDate.js";
import { extractFields } from "../src/services/docIntel.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("U5 - US slash dates are interpreted as MM/DD/YYYY", () => {
  assert.equal(toDateOnlyString("03/04/2026"), "2026-03-04");
  assert.equal(toDateOnlyString("12/31/2026"), "2026-12-31");
  assert.equal(formatUSDateOnly("2026-03-04"), "03/04/2026");
});

test("U5 - impossible or non-US calendar values are rejected", () => {
  assert.equal(parseClaimDate("13/01/2026"), null);
  assert.equal(parseClaimDate("02/30/2026"), null);
  assert.equal(parseClaimDate("2026-02-30"), null);
  assert.equal(parseClaimDate("2026-10-01T99:99:99Z"), null);
  assert.equal(parseClaimDate("2026-10-01T10:30:00+15:00"), null);
});

test("U5 - date-only conversion stays stable across timestamp offsets", () => {
  assert.equal(
    toDateOnlyString("2026-10-01T00:00:00.000Z"),
    "2026-10-01"
  );
  assert.equal(
    toDateOnlyString("2026-10-01T23:59:59-07:00"),
    "2026-10-01"
  );
});

test("U5 - OCR dates are normalized from US format to ISO date-only values", () => {
  const extracted = extractFields(
    [
      "Patient Name: Jane Doe",
      "Date of Birth: 03/04/1980",
      "Date of Service: 10/01/2026",
      "Admission Date: 09/30/2026",
      "Discharge Date: 10/02/2026"
    ].join("\n")
  );

  assert.equal(extracted.dateOfBirth, "1980-03-04");
  assert.equal(extracted.dateOfService, "2026-10-01");
  assert.equal(extracted.admissionDate, "2026-09-30");
  assert.equal(extracted.dischargeDate, "2026-10-02");
});

test("U5 - OCR rejects invalid US calendar dates instead of swapping day/month", () => {
  const extracted = extractFields(
    "Date of Service: 13/01/2026\nDate of Birth: 02/30/1980"
  );

  assert.equal(extracted.dateOfService, null);
  assert.equal(extracted.dateOfBirth, null);
});

test("U5 - Prisma and migration use PostgreSQL DATE for claim calendar fields", () => {
  const schema = read("backend/prisma/schema.prisma");
  const migration = read(
    "backend/prisma/migrations/20261002124500_us_date_only_fields/migration.sql"
  );

  for (const expected of [
    "patientDob    DateTime? @db.Date",
    "admissionDate DateTime? @db.Date",
    "dischargeDate DateTime? @db.Date",
    "procedureDate DateTime? @db.Date",
    "dateOfService DateTime? @db.Date",
    "policyStartDate   DateTime? @db.Date",
    "policyEndDate     DateTime? @db.Date",
    "timelyFilingDeadline   DateTime? @db.Date",
    "serviceDateFrom   DateTime? @db.Date",
    "serviceDateTo     DateTime? @db.Date"
  ]) {
    assert.ok(schema.includes(expected), expected);
  }

  assert.ok(migration.includes('ALTER COLUMN "dateOfService" TYPE DATE'));
  assert.ok(migration.includes('ALTER COLUMN "serviceDateFrom" TYPE DATE'));
});
