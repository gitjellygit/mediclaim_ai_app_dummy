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
          create: [
            {
              type: "OTHER",
              fileName: "own.pdf",
              mimeType: "application/pdf",
              sizeBytes: 10,
              path: "e2e-fixture://own.pdf",
              status: "PROCESSED"
            },
            {
              type: "OTHER",
              fileName: "bulk-delete-own.pdf",
              mimeType: "application/pdf",
              sizeBytes: 10,
              path: "e2e-fixture://bulk-delete-own.pdf",
              status: "PROCESSED"
            }
          ]
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

    const ownDocument = own.documents.find((doc) => doc.fileName === "own.pdf");
    const bulkDeleteOwnDocument = own.documents.find(
      (doc) => doc.fileName === "bulk-delete-own.pdf"
    );

    res.json({
      ownClaimId: own.id,
      ownDocumentId: ownDocument.id,
      bulkDeleteOwnDocumentId: bulkDeleteOwnDocument.id,
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


router.post("/e2e/r3-claim-status/seed", async (req, res) => {
  if (process.env.E2E_TEST_MODE !== "true" || req.user?.role !== "ADMIN") {
    return res.status(404).json({ error: "Not found" });
  }

  const patientName = "E2E R3 Patient";

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
        subscriberName: patientName,
        patientDob: new Date("1982-03-14T00:00:00.000Z"),
        payerName: "Aetna E2E",
        payerEdiId: "60054",
        policyNo: "E2E-R3-POLICY",
        memberId: "E2E-R3-MEMBER",
        amount: 250,
        totalBilledAmount: 250,
        claimForm: "PROFESSIONAL",
        billingProviderNpi: "1999999984",
        hospitalName: "Riverside E2E Medical Center",
        diagnosisText: "Synthetic E2E claim status scenario",
        icd10Codes: ["M54.50"],
        dateOfService: new Date("2026-10-01T00:00:00.000Z"),
        eligibilityStatus: "VERIFIED",
        priorAuthRequired: false,
        priorAuthStatus: "NOT_REQUIRED",
        status: "SUBMITTED",
        claimSubmissionDate: new Date("2026-10-02T00:00:00.000Z"),
        payerClaimStatus: "ACKNOWLEDGED",
        claimStatusCheckedAt: new Date("2026-10-02T00:00:00.000Z"),
        insurerClaimNo: "E2E-R3-PAYER-CLAIM",
        remittanceStatus: "NOT_AVAILABLE",
        payerConnectionMode: "LIVE",
        payerConnectorId: "STEDI_PRODUCTION"
      }
    });

    res.json({ id: claim.id, patientName: claim.patientName });
  } catch (error) {
    console.error("[e2e-r3-claim-status] seed failed", {
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({ error: "Unable to seed R3 claim-status scenario" });
  }
});

router.delete("/e2e/r3-claim-status/cleanup", async (req, res) => {
  if (process.env.E2E_TEST_MODE !== "true" || req.user?.role !== "ADMIN") {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const result = await prisma.claim.deleteMany({
      where: {
        organizationId: req.user.organizationId,
        patientName: "E2E R3 Patient"
      }
    });
    res.json({ deleted: result.count });
  } catch (error) {
    console.error("[e2e-r3-claim-status] cleanup failed", {
      name: error?.name || "Error"
    });
    res.status(500).json({ error: "Unable to clean R3 claim-status scenario" });
  }
});


router.post("/e2e/approval-intelligence/seed", async (req, res) => {
  if (process.env.E2E_TEST_MODE !== "true" || req.user?.role !== "ADMIN") {
    return res.status(404).json({ error: "Not found" });
  }

  const prefix = "UAT-APPROVAL-";
  const organizationId = req.user.organizationId;
  const createdById = req.user.id;
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  const daysFromNow = (days) => new Date(now.getTime() + days * day);

  const base = (suffix, overrides = {}) => ({
    organizationId,
    createdById,
    patientName: `${prefix}${suffix}`,
    payerName: "UAT Health Plan",
    policyNo: `POL-UAT-${suffix}`,
    memberId: `MEM-UAT-${suffix}`,
    insurerClaimNo: `CLM-UAT-${suffix}`,
    amount: 1250,
    totalBilledAmount: 1250,
    claimForm: "PROFESSIONAL",
    claimType: "PROVIDER_BILLED",
    billingProviderNpi: "1234567890",
    renderingProviderNpi: "1987654321",
    diagnosisText: "Synthetic UAT outpatient evaluation",
    icd10Codes: ["Z00.00"],
    dateOfService: daysFromNow(-14),
    timelyFilingDeadline: daysFromNow(90),
    eligibilityStatus: "VERIFIED",
    eligibilityCheckedAt: daysFromNow(-1),
    coverageStatus: "ACTIVE",
    networkStatus: "IN_NETWORK",
    priorAuthRequired: false,
    priorAuthStatus: "NOT_REQUIRED",
    priorAuthCheckedAt: daysFromNow(-1),
    status: "DRAFT",
    remittanceStatus: "NOT_AVAILABLE",
    payerConnectionMode: "LOCAL",
    serviceLines: {
      create: [
        {
          cptHcpcsCode: "99213",
          units: 1,
          charge: 1250,
          diagnosisPointers: ["Z00.00"],
          placeOfService: "11",
          serviceDateFrom: daysFromNow(-14),
          serviceDateTo: daysFromNow(-14),
          verified: true,
          source: "USER"
        }
      ]
    },
    ...overrides
  });

  const check = ({
    score = 92,
    riskScore = 0.08,
    riskLevel = "LOW",
    issues = [],
    riskFactors = [],
    stale = false,
    staleReason = null
  } = {}) => ({
    create: [
      {
        score,
        riskScore,
        riskLevel,
        issues,
        riskFactors,
        isStale: stale,
        staleAt: stale ? now : null,
        staleReason
      }
    ]
  });

  const scenarios = [
    {
      key: "01-READY",
      expected: "ready",
      data: base("01-READY", {
        status: "READY",
        checks: check({ score: 96, riskScore: 0.04, riskLevel: "LOW" })
      })
    },
    {
      key: "02-ELIG-REVIEW",
      expected: "eligibility-needs-review",
      data: base("02-ELIG-REVIEW", {
        eligibilityStatus: "NEEDS_REVIEW",
        coverageStatus: "UNKNOWN",
        status: "NEEDS_REVIEW",
        checks: check({
          score: 78,
          riskScore: 0.36,
          riskLevel: "MED",
          issues: [
            {
              rule: "UAT_ELIGIBILITY",
              severity: "BLOCK",
              message: "Eligibility requires review before submission",
              fixTarget: "eligibility"
            }
          ],
          riskFactors: ["Eligibility requires review"]
        })
      })
    },
    {
      key: "03-ELIG-FAILED",
      expected: "eligibility-failed",
      data: base("03-ELIG-FAILED", {
        eligibilityStatus: "FAILED",
        coverageStatus: "INACTIVE",
        status: "NEEDS_REVIEW",
        checks: check({
          score: 65,
          riskScore: 0.72,
          riskLevel: "HIGH",
          issues: [
            {
              rule: "UAT_ELIGIBILITY",
              severity: "BLOCK",
              message: "Eligibility verification failed",
              fixTarget: "eligibility"
            }
          ],
          riskFactors: ["Eligibility verification failed"]
        })
      })
    },
    {
      key: "04-AUTH-REQUIRED",
      expected: "prior-auth-required",
      data: base("04-AUTH-REQUIRED", {
        priorAuthRequired: true,
        priorAuthStatus: "REQUIRED",
        authorizationNo: null,
        status: "NEEDS_REVIEW",
        checks: check({
          score: 72,
          riskScore: 0.55,
          riskLevel: "MED",
          issues: [
            {
              rule: "US_PRIOR_AUTH",
              severity: "BLOCK",
              message: "Required prior authorization must be approved with an authorization number",
              fixTarget: "prior-auth"
            }
          ],
          riskFactors: ["Prior authorization unresolved"]
        })
      })
    },
    {
      key: "05-AUTH-DENIED",
      expected: "prior-auth-denied",
      data: base("05-AUTH-DENIED", {
        priorAuthRequired: true,
        priorAuthStatus: "DENIED",
        status: "NEEDS_REVIEW",
        checks: check({
          score: 62,
          riskScore: 0.78,
          riskLevel: "HIGH",
          issues: [
            {
              rule: "US_PRIOR_AUTH",
              severity: "BLOCK",
              message: "Prior authorization was denied",
              fixTarget: "prior-auth"
            }
          ],
          riskFactors: ["Prior authorization denied"]
        })
      })
    },
    {
      key: "06-AUTH-EXPIRED",
      expected: "prior-auth-expired",
      data: base("06-AUTH-EXPIRED", {
        priorAuthRequired: true,
        priorAuthStatus: "APPROVED",
        authorizationNo: "AUTH-UAT-EXPIRED",
        priorAuthExpiry: daysFromNow(-2),
        status: "NEEDS_REVIEW",
        checks: check({
          score: 90,
          riskScore: 0.22,
          riskLevel: "LOW",
          riskFactors: ["Authorization must be renewed"]
        })
      })
    },
    {
      key: "07-FILING-EXPIRED",
      expected: "filing-expired",
      data: base("07-FILING-EXPIRED", {
        timelyFilingDeadline: daysFromNow(-5),
        checks: check({ score: 90, riskScore: 0.2, riskLevel: "LOW" })
      })
    },
    {
      key: "08-FILING-URGENT",
      expected: "filing-urgent",
      data: base("08-FILING-URGENT", {
        timelyFilingDeadline: daysFromNow(3),
        checks: check({ score: 91, riskScore: 0.18, riskLevel: "LOW" })
      })
    },
    {
      key: "09-FILING-SOON",
      expected: "filing-due-soon",
      data: base("09-FILING-SOON", {
        timelyFilingDeadline: daysFromNow(21),
        checks: check({ score: 93, riskScore: 0.12, riskLevel: "LOW" })
      })
    },
    {
      key: "10-STALE",
      expected: "stale-readiness",
      data: base("10-STALE", {
        status: "NEEDS_REVIEW",
        checks: check({
          score: 88,
          riskScore: 0.2,
          riskLevel: "LOW",
          stale: true,
          staleReason: "Claim details changed after the last readiness check"
        })
      })
    },
    {
      key: "11-BLOCKED",
      expected: "readiness-blocked",
      data: base("11-BLOCKED", {
        status: "NEEDS_REVIEW",
        checks: check({
          score: 58,
          riskScore: 0.82,
          riskLevel: "HIGH",
          issues: [
            {
              rule: "US_NPI_VALID",
              severity: "BLOCK",
              message: "Billing provider NPI requires correction",
              field: "billingProviderNpi",
              fixTarget: "claim"
            },
            {
              rule: "US_DIAGNOSIS_CPT_LINK",
              severity: "WARN",
              message: "Review diagnosis linkage before submission",
              fixTarget: "serviceLines"
            }
          ],
          riskFactors: ["Provider identifier issue", "Readiness gaps indicate elevated submission risk"]
        })
      })
    },
    {
      key: "12-CODING-PENDING",
      expected: "coding-pending",
      codingSuggestion: true,
      data: base("12-CODING-PENDING", {
        status: "DRAFT",
        checks: undefined
      })
    },
    {
      key: "13-SUBMITTED",
      expected: "submitted",
      data: base("13-SUBMITTED", {
        status: "SUBMITTED",
        claimSubmissionDate: daysFromNow(-2),
        payerClaimStatus: "ACKNOWLEDGED",
        remittanceStatus: "AWAITING",
        checks: check({ score: 94, riskScore: 0.08, riskLevel: "LOW" })
      })
    },
    {
      key: "14-DENIED",
      expected: "denied",
      data: base("14-DENIED", {
        status: "DENIED",
        claimSubmissionDate: daysFromNow(-10),
        payerClaimStatus: "DENIED",
        remittanceStatus: "RECEIVED",
        checks: check({ score: 91, riskScore: 0.15, riskLevel: "LOW" })
      })
    },
    {
      key: "15-PAID",
      expected: "paid",
      data: base("15-PAID", {
        status: "PAID",
        claimSubmissionDate: daysFromNow(-20),
        payerClaimStatus: "PAID",
        remittanceStatus: "POSTED",
        approvedAmount: 980,
        allowedAmount: 1050,
        patientResponsibility: 70,
        paidAmount: 980,
        paymentReference: "UAT-PAY-15",
        checks: check({ score: 97, riskScore: 0.03, riskLevel: "LOW" })
      })
    }
  ];

  try {
    await prisma.claim.deleteMany({
      where: {
        organizationId,
        patientName: { startsWith: prefix }
      }
    });

    const created = [];

    for (const scenario of scenarios) {
      const data = { ...scenario.data };
      if (data.checks === undefined) delete data.checks;

      const claim = await prisma.claim.create({ data });

      if (scenario.codingSuggestion) {
        const document = await prisma.document.create({
          data: {
            claimId: claim.id,
            type: "FINAL_BILL",
            fileName: "uat-approval-coding-pending.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024,
            path: "e2e-fixture://uat-approval-coding-pending.pdf",
            status: "PROCESSED",
            confidence: 98
          }
        });

        await prisma.codingSuggestion.create({
          data: {
            claimId: claim.id,
            documentId: document.id,
            system: "CPT",
            suggestedCode: "99214",
            confidence: 91,
            evidenceText: "Synthetic UAT coding suggestion",
            status: "PENDING"
          }
        });
      }

      created.push({
        key: scenario.key,
        expected: scenario.expected,
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
    console.error("[e2e-approval-intelligence] seed failed", {
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({
      error: "Unable to seed Approval Intelligence UAT scenarios"
    });
  }
});

router.delete("/e2e/approval-intelligence/cleanup", async (req, res) => {
  if (process.env.E2E_TEST_MODE !== "true" || req.user?.role !== "ADMIN") {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const result = await prisma.claim.deleteMany({
      where: {
        organizationId: req.user.organizationId,
        patientName: { startsWith: "UAT-APPROVAL-" }
      }
    });

    res.json({ deleted: result.count });
  } catch (error) {
    console.error("[e2e-approval-intelligence] cleanup failed", {
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({
      error: "Unable to clean Approval Intelligence UAT scenarios"
    });
  }
});


  return router;
}
