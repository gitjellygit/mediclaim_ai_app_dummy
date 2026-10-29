import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("patient payments persistence stores balances and immutable payment records", () => {
  const schema = read("backend/prisma/schema.prisma");
  const migration = read("backend/prisma/migrations/20261029100000_add_patient_payments/migration.sql");

  assert.match(schema, /model PatientBalance/);
  assert.match(schema, /model PatientPayment/);
  assert.match(schema, /@@unique\(\[organizationId, externalKey\]\)/);
  assert.match(schema, /patientResponsibility\s+Decimal/);
  assert.match(schema, /balanceAmount\s+Decimal/);
  assert.match(schema, /chargeDetails\s+Json\?/);

  assert.match(migration, /CREATE TABLE "PatientBalance"/);
  assert.match(migration, /CREATE TABLE "PatientPayment"/);
  assert.match(migration, /PatientBalance_organizationId_externalKey_key/);
});

test("EHR workflow routes self-pay to patient balances and blocks insurance claim materialization", () => {
  const route = read("backend/src/routes/integrations.js");
  const ui = read("frontend/src/modules/ai-claims/ClaimsList.jsx");

  assert.match(route, /router\.post\("\/:id\/patient-balance"/);
  assert.match(route, /INSURANCE_CLAIM_WORKFLOW_REQUIRED/);
  assert.match(route, /SELF_PAY_PATIENT_BALANCE_REQUIRED/);
  assert.match(route, /PATIENT_BALANCE_CREATED_FROM_EHR/);

  assert.match(ui, /Create Patient Balance/);
  assert.match(ui, /createPatientBalance/);
  assert.match(ui, /navigate\(\x60\/patient-payments\/\$\{result\.patientBalanceId\}\x60\)/);
  assert.match(ui, /Self-pay encounter detected/);
});

test("Patient Payments is a real financial workspace and cashier destination", () => {
  const app = read("frontend/src/App.jsx");
  const nav = read("frontend/src/layout/LeftNav.jsx");
  const workspace = read("frontend/src/modules/patient-payments/PatientPayments.jsx");
  const apiRoute = read("backend/src/routes/patientPayments.js");

  assert.match(app, /path: "\/patient-payments"/);
  assert.match(app, /path: "\/patient-payments\/:id"/);
  assert.match(app, /role === "CASHIER"[\s\S]*"\/patient-payments"/);
  assert.match(nav, /label="Patient Payments"/);
  assert.match(workspace, /Record Payment/);
  assert.match(workspace, /Mark Statement Sent/);
  assert.match(workspace, /Start Payment Plan/);
  assert.match(apiRoute, /PATIENT_PAYMENT_RECORDED/);
  assert.match(apiRoute, /PATIENT_PAYMENT_EXCEEDS_BALANCE/);
  assert.match(apiRoute, /requirePermission\(PERMISSIONS\.FINANCIAL_EDIT\)/);
});
