import express from "express";

/** Synthetic test fixtures only. Never mount this router in normal environments. */
export function e2eFixturesRouter(prisma) {
  const router = express.Router();

/**
 * Local Playwright medical-consistency fixtures.
 *
 * This route is intentionally unavailable unless E2E_TEST_MODE=true and the
 * caller is an ADMIN. It creates synthetic, non-PHI claims only.
 */
router.post("/e2e/medical-consistency/seed", async (req, res) => {
  if (process.env.E2E_TEST_MODE !== "true" || req.user?.role !== "ADMIN") {
    return res.status(404).json({ error: "Not found" });
  }

  const prefix = "E2E-MC-";

  const makeClaim = (suffix, overrides = {}) => ({
    patientName: `${prefix}${suffix}`,
    payerName: "Automation Test Payer",
    policyNo: `POL-${suffix}`,
    memberId: `MEM-${suffix}`,
    amount: 12000,
    totalBilledAmount: 12000,
    diagnosisText: "Community acquired pneumonia",
    icd10Codes: ["J18.9"],
    eligibilityStatus: "VERIFIED",
    priorAuthRequired: false,
    priorAuthStatus: "NOT_REQUIRED",
    admissionDate: new Date("2026-09-20T00:00:00.000Z"),
    dischargeDate: new Date("2026-09-22T00:00:00.000Z"),
    dateOfService: new Date("2026-09-21T00:00:00.000Z"),
    admissionType: "EMERGENCY",
    roomCategory: "PRIVATE",
    icuDays: 0,
    status: "DRAFT",
    ...overrides
  });

  const doc = (type, fileName, extracted = {}) => ({
    type,
    fileName,
    mimeType: "application/pdf",
    sizeBytes: 1024,
    path: `e2e-fixture://${fileName}`,
    status: "PROCESSED",
    confidence: 99,
    extracted
  });

  const scenarios = [
    {
      key: "01-CLEAN",
      expectedStatus: "CONSISTENT",
      claim: makeClaim("01-CLEAN"),
      documents: [
        doc("DISCHARGE_SUMMARY", "01-clean-discharge.pdf", {
          diagnosisText: "Community acquired pneumonia",
          dateOfService: "2026-09-21",
          admissionDate: "2026-09-20",
          dischargeDate: "2026-09-22"
        })
      ]
    },
    {
      key: "02-DATE-ORDER",
      expectedStatus: "BLOCKED",
      claim: makeClaim("02-DATE-ORDER", {
        admissionDate: new Date("2026-09-23T00:00:00.000Z"),
        dischargeDate: new Date("2026-09-20T00:00:00.000Z"),
        dateOfService: new Date("2026-09-21T00:00:00.000Z")
      }),
      documents: [doc("DISCHARGE_SUMMARY", "02-date-order.pdf")]
    },
    {
      key: "03-DOS-OUTSIDE",
      expectedStatus: "NEEDS_REVIEW",
      claim: makeClaim("03-DOS-OUTSIDE", {
        dateOfService: new Date("2026-09-25T00:00:00.000Z")
      }),
      documents: [doc("DISCHARGE_SUMMARY", "03-dos-outside.pdf")]
    },
    {
      key: "04-PROCEDURE-OUTSIDE",
      expectedStatus: "BLOCKED",
      claim: makeClaim("04-PROCEDURE-OUTSIDE", {
        procedureText: "Laparoscopic appendectomy",
        procedureDate: new Date("2026-09-25T00:00:00.000Z")
      }),
      documents: [
        doc("DISCHARGE_SUMMARY", "04-procedure-discharge.pdf"),
        doc("OPERATIVE_NOTE", "04-operative-note.pdf")
      ]
    },
    {
      key: "05-ICU-EXCEEDS-STAY",
      expectedStatus: "BLOCKED",
      claim: makeClaim("05-ICU-EXCEEDS-STAY", {
        roomCategory: "ICU",
        icuDays: 5
      }),
      documents: [doc("DISCHARGE_SUMMARY", "05-icu-exceeds.pdf")]
    },
    {
      key: "06-ICU-ROOM-CONFLICT",
      expectedStatus: "NEEDS_REVIEW",
      claim: makeClaim("06-ICU-ROOM-CONFLICT", {
        roomCategory: "PRIVATE",
        icuDays: 2
      }),
      documents: [doc("DISCHARGE_SUMMARY", "06-icu-room-conflict.pdf")]
    },
    {
      key: "07-ICU-DAYS-MISSING",
      expectedStatus: "NEEDS_REVIEW",
      claim: makeClaim("07-ICU-DAYS-MISSING", {
        roomCategory: "ICU",
        icuDays: null
      }),
      documents: [doc("DISCHARGE_SUMMARY", "07-icu-days-missing.pdf")]
    },
    {
      key: "08-MISSING-DISCHARGE",
      expectedStatus: "NEEDS_REVIEW",
      claim: makeClaim("08-MISSING-DISCHARGE"),
      documents: [doc("FINAL_BILL", "08-final-bill.pdf")]
    },
    {
      key: "09-PROCEDURE-NO-SUPPORT",
      expectedStatus: "NEEDS_REVIEW",
      claim: makeClaim("09-PROCEDURE-NO-SUPPORT", {
        procedureText: "Laparoscopic appendectomy",
        procedureDate: new Date("2026-09-21T00:00:00.000Z")
      }),
      // Intentionally omit all clinical support documents. A FINAL_BILL alone
      // must not satisfy procedure-documentation support.
      documents: [
        doc("FINAL_BILL", "09-final-bill.pdf")
      ]
    },
    {
      key: "10-CONFLICTING-DOS",
      expectedStatus: "NEEDS_REVIEW",
      claim: makeClaim("10-CONFLICTING-DOS"),
      documents: [
        doc("FINAL_BILL", "10-final-bill.pdf", {
          dateOfService: "2026-09-20"
        }),
        doc("DISCHARGE_SUMMARY", "10-discharge.pdf", {
          dateOfService: "2026-09-21"
        })
      ]
    },
    {
      key: "11-CONFLICTING-ADMISSION",
      expectedStatus: "NEEDS_REVIEW",
      claim: makeClaim("11-CONFLICTING-ADMISSION"),
      documents: [
        doc("FINAL_BILL", "11-final-bill.pdf", {
          admissionDate: "2026-09-19"
        }),
        doc("DISCHARGE_SUMMARY", "11-discharge.pdf", {
          admissionDate: "2026-09-20"
        })
      ]
    },
    {
      key: "12-CONFLICTING-DIAGNOSIS",
      expectedStatus: "NEEDS_REVIEW",
      claim: makeClaim("12-CONFLICTING-DIAGNOSIS"),
      documents: [
        doc("FINAL_BILL", "12-final-bill.pdf", {
          diagnosisText: "Acute bronchitis"
        }),
        doc("DISCHARGE_SUMMARY", "12-discharge.pdf", {
          diagnosisText: "Community acquired pneumonia"
        })
      ]
    }
  ];

  try {
    const existing = await prisma.claim.findMany({
      where: { organizationId: req.user.organizationId, patientName: { startsWith: prefix } },
      select: { id: true }
    });

    if (existing.length) {
      await prisma.claim.deleteMany({
        where: { id: { in: existing.map((item) => item.id) } }
      });
    }

    const created = [];

    for (const scenario of scenarios) {
      const claim = await prisma.claim.create({
        data: {
          ...scenario.claim,
          organizationId: req.user.organizationId,
          createdById: req.user.id,
          documents: {
            create: scenario.documents
          }
        },
        include: { documents: true }
      });

      created.push({
        key: scenario.key,
        expectedStatus: scenario.expectedStatus,
        id: claim.id,
        patientName: claim.patientName
      });
    }

    res.json({
      prefix,
      count: created.length,
      scenarios: created
    });
  } catch (error) {
    console.error("[e2e-medical-consistency] seed failed", {
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({ error: "Unable to seed E2E medical-consistency data" });
  }
});

router.delete("/e2e/medical-consistency/cleanup", async (req, res) => {
  if (process.env.E2E_TEST_MODE !== "true" || req.user?.role !== "ADMIN") {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const result = await prisma.claim.deleteMany({
      where: { organizationId: req.user.organizationId, patientName: { startsWith: "E2E-MC-" } }
    });

    res.json({ deleted: result.count });
  } catch (error) {
    console.error("[e2e-medical-consistency] cleanup failed", {
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({ error: "Unable to clean E2E medical-consistency data" });
  }
});

router.post("/e2e/payer-journey/seed", async (req, res) => {
  if (process.env.E2E_TEST_MODE !== "true" || req.user?.role !== "ADMIN") {
    return res.status(404).json({ error: "Not found" });
  }

  const prefix = "E2E-PAYER-";
  const doc = (type, fileName) => ({
    type,
    fileName,
    mimeType: "application/pdf",
    sizeBytes: 1024,
    path: `e2e-fixture://${fileName}`,
    status: "PROCESSED",
    confidence: 99
  });

  const base = (suffix, overrides = {}) => ({
    patientName: `${prefix}${suffix}`,
    payerName: "Payer Setup",
    policyNo: `POL-${suffix}`,
    memberId: `MEM-${suffix}`,
    amount: 20000,
    totalBilledAmount: 20000,
    claimForm: "PROFESSIONAL",
    billingProviderNpi: "1234567890",
    renderingProviderNpi: "1987654321",
    diagnosisText: "Routine test diagnosis",
    icd10Codes: ["Z00.00"],
    dateOfService: new Date("2026-09-21T00:00:00.000Z"),
    timelyFilingDeadline: new Date("2027-12-31T00:00:00.000Z"),
    status: "DRAFT",
    eligibilityStatus: "NOT_CHECKED",
    priorAuthStatus: "NOT_CHECKED",
    remittanceStatus: "NOT_AVAILABLE",
    serviceLines: {
      create: [{
        cptHcpcsCode: "99213",
        units: 1,
        charge: 20000,
        diagnosisPointers: ["Z00.00"],
        placeOfService: "11",
        serviceDateFrom: new Date("2026-09-21T00:00:00.000Z"),
        serviceDateTo: new Date("2026-09-21T00:00:00.000Z"),
        verified: true,
        source: "USER"
      }]
    },
    ...overrides
  });

  const scenarios = [
    {
      key: "BLUE",
      payerCode: "BLUE_HORIZON",
      claim: base("BLUE"),
      documents: [doc("FINAL_BILL", "blue-final-bill.pdf")]
    },
    {
      key: "SUMMIT",
      payerCode: "SUMMITCARE",
      claim: base("SUMMIT", {
        procedureText: "MRI lumbar spine"
      }),
      documents: [
        doc("FINAL_BILL", "summit-final-bill.pdf"),
        doc("RADIOLOGY", "summit-radiology.pdf")
      ]
    },
    {
      key: "METRO",
      payerCode: "METROPLUS_DEMO",
      claim: base("METRO", {
        admissionDate: new Date("2026-09-20T00:00:00.000Z"),
        dischargeDate: new Date("2026-09-22T00:00:00.000Z"),
        admissionType: "EMERGENCY",
        roomCategory: "PRIVATE",
        icuDays: 0
      }),
      documents: [doc("FINAL_BILL", "metro-final-bill.pdf")]
    },
    {
      key: "CEDAR",
      payerCode: "CAREFIRST_DEMO",
      claim: base("CEDAR", {
        memberId: "CF-1001"
      }),
      documents: [doc("FINAL_BILL", "cedar-final-bill.pdf")]
    },
    {
      key: "APEX",
      payerCode: "APEX_BENEFIT",
      claim: base("APEX"),
      documents: [doc("FINAL_BILL", "apex-final-bill.pdf")]
    },
    {
      key: "SWITCH",
      payerCode: "BLUE_HORIZON",
      claim: base("SWITCH"),
      documents: [doc("FINAL_BILL", "switch-final-bill.pdf")]
    }
  ];

  try {
    await prisma.claim.deleteMany({
      where: { organizationId: req.user.organizationId, patientName: { startsWith: prefix } }
    });

    const created = [];
    for (const scenario of scenarios) {
      const claim = await prisma.claim.create({
        data: {
          ...scenario.claim,
          organizationId: req.user.organizationId,
          createdById: req.user.id,
          documents: { create: scenario.documents }
        }
      });
      created.push({
        id: claim.id,
        patientName: claim.patientName,
        key: scenario.key,
        payerCode: scenario.payerCode
      });
    }

    res.json({ count: created.length, scenarios: created });
  } catch (error) {
    console.error("[e2e-payer-journey] seed failed", {
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({ error: "Unable to seed payer Journey scenarios" });
  }
});

router.post("/e2e/payment-variance/seed", async (req, res) => {
  if (process.env.E2E_TEST_MODE !== "true" || req.user?.role !== "ADMIN") {
    return res.status(404).json({ error: "Not found" });
  }

  const patientName = "E2E-PAYMENT-VARIANCE";

  try {
    await prisma.claim.deleteMany({
      where: {
        organizationId: req.user.organizationId,
        patientName
      }
    });

    const claim = await prisma.claim.create({
      data: {
        organizationId: req.user.organizationId,
        createdById: req.user.id,
        patientName,
        payerName: "Payer Setup",
        policyNo: "PAY-VAR-100",
        memberId: "APEX-MEMBER-100",
        amount: 1000,
        totalBilledAmount: 1000,
        claimForm: "PROFESSIONAL",
        billingProviderNpi: "1234567890",
        renderingProviderNpi: "1234567890",
        diagnosisText: "Routine outpatient evaluation",
        icd10Codes: ["M54.50"],
        dateOfService: new Date("2026-10-01T00:00:00.000Z"),
        timelyFilingDeadline: new Date("2027-12-31T00:00:00.000Z"),
        status: "DRAFT",
        eligibilityStatus: "NOT_CHECKED",
        priorAuthStatus: "NOT_CHECKED",
        remittanceStatus: "NOT_AVAILABLE",
        documents: {
          create: [{
            type: "FINAL_BILL",
            fileName: "payment-variance-final-bill.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024,
            path: "e2e-fixture://payment-variance-final-bill.pdf",
            status: "PROCESSED",
            confidence: 99
          }]
        },
        serviceLines: {
          create: [{
            cptHcpcsCode: "99213",
            units: 1,
            charge: 1000,
            diagnosisPointers: ["M54.50"],
            placeOfService: "11",
            serviceDateFrom: new Date("2026-10-01T00:00:00.000Z"),
            serviceDateTo: new Date("2026-10-01T00:00:00.000Z")
          }]
        }
      },
      include: {
        documents: true,
        serviceLines: true
      }
    });

    res.json({
      id: claim.id,
      patientName: claim.patientName
    });
  } catch (error) {
    console.error("[e2e-payment-variance] seed failed", {
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({ error: "Unable to seed payment variance scenario" });
  }
});

router.delete("/e2e/payment-variance/cleanup", async (req, res) => {
  if (process.env.E2E_TEST_MODE !== "true" || req.user?.role !== "ADMIN") {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const result = await prisma.claim.deleteMany({
      where: {
        organizationId: req.user.organizationId,
        patientName: "E2E-PAYMENT-VARIANCE"
      }
    });
    res.json({ deleted: result.count });
  } catch (error) {
    console.error("[e2e-payment-variance] cleanup failed", {
      name: error?.name || "Error"
    });
    res.status(500).json({ error: "Unable to clean payment variance scenario" });
  }
});

router.delete("/e2e/payer-journey/cleanup", async (req, res) => {
  if (process.env.E2E_TEST_MODE !== "true" || req.user?.role !== "ADMIN") {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const result = await prisma.claim.deleteMany({
      where: { organizationId: req.user.organizationId, patientName: { startsWith: "E2E-PAYER-" } }
    });
    res.json({ deleted: result.count });
  } catch (error) {
    console.error("[e2e-payer-journey] cleanup failed", {
      name: error?.name || "Error"
    });
    res.status(500).json({ error: "Unable to clean payer Journey scenarios" });
  }
});

router.post("/e2e/tenant-isolation/seed", async (req, res) => {
  if (process.env.E2E_TEST_MODE !== "true" || req.user?.role !== "ADMIN") {
    return res.status(404).json({ error: "Not found" });
  }

  const ownPatient = "E2E-TENANT-OWN";
  const foreignPatient = "E2E-TENANT-FOREIGN";

  try {
    const foreignOrg = await prisma.organization.upsert({
      where: { slug: "e2e-foreign-org" },
      update: {},
      create: { name: "E2E Foreign Org", slug: "e2e-foreign-org" }
    });

    await prisma.claim.deleteMany({
      where: {
        OR: [
          { organizationId: req.user.organizationId, patientName: ownPatient },
          { organizationId: foreignOrg.id, patientName: foreignPatient }
        ]
      }
    });

    const own = await prisma.claim.create({
      data: {
        organizationId: req.user.organizationId,
        createdById: req.user.id,
        patientName: ownPatient,
        payerName: "Test Payer",
        status: "DRAFT",
        documents: {
          create: [{
            type: "OTHER",
            fileName: "own.pdf",
            mimeType: "application/pdf",
            sizeBytes: 10,
            path: "e2e-fixture://own.pdf",
            status: "PROCESSED"
          }]
        }
      },
      include: { documents: true }
    });

    const foreign = await prisma.claim.create({
      data: {
        organizationId: foreignOrg.id,
        createdById: req.user.id,
        patientName: foreignPatient,
        payerName: "Foreign Test Payer",
        status: "DRAFT",
        documents: {
          create: [{
            type: "OTHER",
            fileName: "foreign.pdf",
            mimeType: "application/pdf",
            sizeBytes: 10,
            path: "e2e-fixture://foreign.pdf",
            status: "PROCESSED"
          }]
        }
      },
      include: { documents: true }
    });

    res.json({
      ownClaimId: own.id,
      ownDocumentId: own.documents[0].id,
      foreignClaimId: foreign.id,
      foreignDocumentId: foreign.documents[0].id,
      foreignOrganizationId: foreignOrg.id
    });
  } catch (error) {
    console.error("[e2e-tenant-isolation] seed failed", {
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({ error: "Unable to seed tenant isolation scenario" });
  }
});

router.post("/e2e/tenant-isolation/verify", async (req, res) => {
  if (process.env.E2E_TEST_MODE !== "true" || req.user?.role !== "ADMIN") {
    return res.status(404).json({ error: "Not found" });
  }

  const { ownDocumentId, foreignDocumentId } = req.body || {};
  const [own, foreign] = await Promise.all([
    prisma.document.findUnique({ where: { id: ownDocumentId } }),
    prisma.document.findUnique({ where: { id: foreignDocumentId } })
  ]);

  res.json({ ownExists: Boolean(own), foreignExists: Boolean(foreign) });
});

router.delete("/e2e/tenant-isolation/cleanup", async (req, res) => {
  if (process.env.E2E_TEST_MODE !== "true" || req.user?.role !== "ADMIN") {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const foreignOrg = await prisma.organization.findUnique({
      where: { slug: "e2e-foreign-org" }
    });

    await prisma.claim.deleteMany({
      where: {
        OR: [
          { organizationId: req.user.organizationId, patientName: "E2E-TENANT-OWN" },
          ...(foreignOrg
            ? [{ organizationId: foreignOrg.id, patientName: "E2E-TENANT-FOREIGN" }]
            : [])
        ]
      }
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Unable to clean tenant isolation scenario" });
  }
});


  return router;
}
