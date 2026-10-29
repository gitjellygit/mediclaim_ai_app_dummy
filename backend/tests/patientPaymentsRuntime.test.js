import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/db.js";

const ORG_ID = "org_patient_payments_runtime";

after(async () => {
  await prisma.patientPayment.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.patientBalance.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
});

test("Patient Payments Prisma models are generated and usable at runtime", async () => {
  assert.ok(prisma.patientBalance, "PatientBalance Prisma delegate must exist");
  assert.ok(prisma.patientPayment, "PatientPayment Prisma delegate must exist");

  await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: { id: ORG_ID, name: "Patient Payments Runtime Test", slug: "patient-payments-runtime-test" }
  });

  const balance = await prisma.patientBalance.create({
    data: {
      organizationId: ORG_ID,
      sourceType: "TEST",
      externalKey: "runtime-test:encounter-1",
      patientName: "RUNTIME TEST PATIENT",
      totalCharges: 200,
      insuranceResponsibility: 0,
      patientResponsibility: 200,
      paidAmount: 0,
      balanceAmount: 200,
      status: "UNPAID"
    }
  });

  const payment = await prisma.patientPayment.create({
    data: {
      organizationId: ORG_ID,
      patientBalanceId: balance.id,
      amount: 50,
      method: "CARD"
    }
  });

  const loaded = await prisma.patientBalance.findUnique({
    where: { id: balance.id },
    include: { payments: true }
  });

  assert.equal(loaded.patientName, "RUNTIME TEST PATIENT");
  assert.equal(Number(loaded.patientResponsibility), 200);
  assert.equal(loaded.payments.length, 1);
  assert.equal(Number(loaded.payments[0].amount), 50);
  assert.equal(payment.patientBalanceId, balance.id);
});
