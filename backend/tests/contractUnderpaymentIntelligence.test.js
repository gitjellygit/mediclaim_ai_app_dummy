import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("underpayment cases preserve frozen calculation provenance", () => {
  const schema = read("backend/prisma/schema.prisma");
  const recovery = read("backend/src/services/underpaymentRecovery.js");
  const underpayments = read("backend/src/routes/underpayments.js");

  assert.match(schema, /model PayerContract/);
  assert.match(schema, /model FeeScheduleLine/);
  assert.match(schema, /expectedPaymentSource String\?/);
  assert.match(schema, /calculationSnapshot\s+Json\?/);
  assert.match(recovery, /CONTRACT_FEE_SCHEDULE/);
  assert.match(recovery, /REMITTANCE_EXPECTATION/);
  assert.match(underpayments, /calculationSnapshot: detected\.calculationSnapshot/);
});

test("automatic simulated and live ERA paths use the shared contract-first resolver", () => {
  const simulated = read("backend/src/routes/claimPayerSimulation.js");
  const live = read("backend/src/routes/claimJourney.js");

  assert.match(simulated, /resolveUnderpaymentExpectation/);
  assert.match(simulated, /expectedPaymentSource: expectation\.expectedPaymentSource/);
  assert.match(live, /resolveUnderpaymentExpectation/);
  assert.match(live, /expectedPaymentSource: expectation\.expectedPaymentSource/);
});

test("underpayment workspace explains contractual or fallback expected payment basis", () => {
  const ui = read("frontend/src/modules/recovery/UnderpaymentWorkspace.jsx");
  assert.match(ui, /Expected Payment Basis/);
  assert.match(ui, /Contract Fee Schedule/);
  assert.match(ui, /Remittance Expectation/);
  assert.match(ui, /PRISM did not invent a contractual amount/);
});
