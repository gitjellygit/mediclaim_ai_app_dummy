import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const uploadDir = process.env.UPLOAD_DIR || "uploads";
fs.mkdirSync(uploadDir, { recursive: true });

function buildDemoPdf(title) {
  const safeTitle = String(title || "Synthetic Demo Document")
    .replace(/[()\\]/g, " ")
    .slice(0, 90);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${52 + safeTitle.length} >>\nstream\nBT /F1 18 Tf 72 720 Td (${safeTitle}) Tj ET\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

function ensureDemoPdf(index, suffix) {
  const storedName = `demo-uat-${String(index).padStart(3, "0")}-${suffix}.pdf`;
  fs.writeFileSync(
    path.join(uploadDir, storedName),
    buildDemoPdf(`Synthetic Demo UAT: ${suffix.replaceAll("-", " ")}`)
  );
  return storedName;
}

function isLocalDatabaseUrl(raw) {
  try {
    const url = new URL(raw);
    return ["localhost", "127.0.0.1", "::1"].includes(String(url.hostname || "").toLowerCase());
  } catch {
    return false;
  }
}

if (!isLocalDatabaseUrl(process.env.DATABASE_URL || "")) {
  throw new Error("Refusing to seed demo UAT data into a non-local database.");
}

const NAMES = [
  "Emily Carter","Michael Thompson","Sophia Martinez","Daniel Anderson","Olivia Johnson",
  "Ethan Wilson","Ava Rodriguez","Noah Harris","Mia Clark","Liam Walker",
  "Isabella Lewis","James Hall","Amelia Young","Benjamin Allen","Charlotte King",
  "Lucas Wright","Harper Scott","Henry Green","Evelyn Baker","Alexander Adams",
  "Camila Nelson","Sebastian Hill","Luna Ramirez","Jack Mitchell","Sofia Roberts",
  "Owen Turner","Aria Phillips","Samuel Campbell","Ella Parker","Leo Evans",
  "Grace Edwards","Julian Collins","Chloe Stewart","Gabriel Sanchez","Lily Morris",
  "Mateo Rogers","Nora Reed","David Cook","Zoey Morgan","Joseph Bell",
  "Layla Murphy","Carter Bailey","Scarlett Rivera","Wyatt Cooper","Victoria Richardson",
  "Dylan Cox","Hannah Howard","Luke Ward","Penelope Torres","Isaac Peterson",
  "Riley Gray","Anthony James","Stella Watson","Lincoln Brooks","Natalie Kelly",
  "Christopher Sanders","Aurora Price","Andrew Bennett","Savannah Wood","Joshua Barnes"
];

const PAYERS = [
  ["Blue Horizon Health","BH001"],
  ["SummitCare","SC002"],
  ["MetroPlus Demo","MP003"],
  ["CareFirst Demo","CF004"],
  ["Apex Benefit Health","AB005"]
];

const SCENARIOS = [
  "COMPLETE_READY",
  "INCOMPLETE",
  "ELIGIBILITY",
  "PRIOR_AUTH",
  "SUBMITTED",
  "REJECTED",
  "DENIAL_OPEN",
  "APPEAL_PREPARED",
  "APPEAL_SUBMITTED",
  "PAID_POSTED",
  "UNDERPAYMENT_OPEN",
  "RECOVERED"
];

const daysFromNow = (days) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

const money = (n) => Number(n.toFixed(2));

function doc(type, index, suffix, verified = true) {
  return {
    type,
    fileName: `demo-uat-${String(index).padStart(3, "0")}-${suffix}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 2200 + index * 17,
    path: ensureDemoPdf(index, suffix),
    status: "PROCESSED",
    confidence: 96,
    verified,
    extracted: { synthetic: true, demoUat: true }
  };
}

function baseClaim(index, name) {
  const [payerName, payerEdiId] = PAYERS[(index - 1) % PAYERS.length];
  const institutional = index % 4 === 0;
  const billed = 650 + index * 113;
  const dobYear = 1955 + (index % 48);
  const dos = daysFromNow(-(12 + (index % 70)));
  const state = ["CO","TX","FL","NJ","CA"][index % 5];
  const city = ["Denver","Austin","Orlando","Newark","San Diego"][index % 5];

  return {
    patientName: name,
    patientDob: new Date(`${dobYear}-${String((index % 12) + 1).padStart(2, "0")}-15T00:00:00.000Z`),
    patientAge: new Date().getUTCFullYear() - dobYear,
    patientGender: index % 2 === 0 ? "FEMALE" : "MALE",
    patientAddress1: `${120 + index} Market Street`,
    patientCity: city,
    patientState: state,
    patientPostalCode: `${80000 + index}`,
    medicalRecordNumber: `DEMO-UAT-${String(index).padStart(3, "0")}`,
    patientMobile: `303555${String(1000 + index).slice(-4)}`,
    payerName,
    payerEdiId,
    policyNo: `POL-DEMO-${String(index).padStart(3, "0")}`,
    memberId: `MEM-DEMO-${String(index).padStart(3, "0")}`,
    groupNumber: `GRP-${100 + (index % 10)}`,
    subscriberId: `SUB-${String(index).padStart(3, "0")}`,
    subscriberName: name,
    subscriberDob: new Date(`${dobYear}-${String((index % 12) + 1).padStart(2, "0")}-15T00:00:00.000Z`),
    subscriberGender: index % 2 === 0 ? "FEMALE" : "MALE",
    subscriberAddress1: `${120 + index} Market Street`,
    subscriberCity: city,
    subscriberState: state,
    subscriberPostalCode: `${80000 + index}`,
    subscriberRelationship: "SELF",
    coordinationOfBenefits: "PRIMARY",
    planAdministratorName: payerName,
    policyStartDate: daysFromNow(-300),
    policyEndDate: daysFromNow(65),
    productType: index % 2 === 0 ? "PPO" : "HMO",
    coverageLimit: 250000,
    remainingCoverageLimit: 225000 - index * 250,
    amount: billed,
    totalBilledAmount: billed,
    claimForm: institutional ? "INSTITUTIONAL" : "PROFESSIONAL",
    claimType: "PROVIDER_BILLED",
    claimStage: "FINAL",
    billingProviderNpi: "1234567890",
    renderingProviderNpi: institutional ? null : "1987654321",
    providerTin: "123456789",
    providerTaxonomyCode: institutional ? "282N00000X" : "207Q00000X",
    hospitalName: "Demo Regional Medical Center",
    hospitalAddress: "500 Provider Ave, Denver, CO 80203",
    hospitalRegNo: "DEMO-HOSP-001",
    doctorName: institutional ? "Dr. Rebecca Moore" : "Dr. Jonathan Miller",
    doctorRegNo: institutional ? "CO-MD-45001" : "CO-MD-45002",
    diagnosisText: index % 3 === 0 ? "Low back pain" : index % 3 === 1 ? "Essential hypertension" : "Routine outpatient evaluation",
    icd10Codes: index % 3 === 0 ? ["M54.50"] : index % 3 === 1 ? ["I10"] : ["Z00.00"],
    procedureText: institutional ? "Hospital evaluation and management" : "Office or outpatient evaluation",
    dateOfService: dos,
    admissionDate: institutional ? daysFromNow(-(15 + (index % 30))) : null,
    dischargeDate: institutional ? daysFromNow(-(12 + (index % 30))) : null,
    admissionType: institutional ? (index % 2 === 0 ? "PLANNED" : "EMERGENCY") : null,
    roomCategory: institutional ? "PRIVATE" : null,
    icuDays: institutional ? 0 : null,
    typeOfBill: institutional ? "0111" : null,
    drgCode: institutional ? "470" : null,
    admissionTypeCode: institutional ? "1" : null,
    admissionSourceCode: institutional ? "7" : null,
    patientStatusCode: institutional ? "01" : null,
    timelyFilingDeadline: daysFromNow(60 + (index % 45)),
    claimFilingCode: "CI",
    claimFrequencyCode: "ORIGINAL",
    status: "READY",
    eligibilityStatus: "VERIFIED",
    eligibilityCheckedAt: daysFromNow(-1),
    coverageStatus: "ACTIVE",
    deductibleRemaining: 250,
    coinsurancePct: 20,
    networkStatus: "IN_NETWORK",
    priorAuthRequired: false,
    priorAuthStatus: "NOT_REQUIRED",
    priorAuthCheckedAt: daysFromNow(-2),
    remittanceStatus: "NOT_AVAILABLE",
    payerConnectionMode: "SIMULATED",
    simulatedPayerCode: "BLUE_HORIZON",
    fieldProvenance: { demoUat: { synthetic: true, scenarioIndex: index } },
    serviceLines: {
      create: [{
        cptHcpcsCode: institutional ? "99223" : "99213",
        units: 1,
        charge: billed,
        diagnosisPointers: [index % 3 === 0 ? "M54.50" : index % 3 === 1 ? "I10" : "Z00.00"],
        placeOfService: institutional ? "21" : "11",
        revenueCode: institutional ? "0450" : null,
        serviceDateFrom: dos,
        serviceDateTo: dos,
        verified: true,
        source: "USER"
      }]
    },
    documents: {
      create: [
        doc("FINAL_BILL", index, "final-bill"),
        doc("INSURANCE_CARD", index, "insurance-card"),
        ...(institutional ? [doc("DISCHARGE_SUMMARY", index, "discharge-summary")] : [doc("PROGRESS_NOTE", index, "progress-note")])
      ]
    },
    checks: {
      create: [{
        score: 94,
        issues: [],
        riskScore: 0.08,
        riskLevel: "LOW",
        riskFactors: []
      }]
    }
  };
}

function configureScenario(index, scenario, data) {
  const variant = (index - 1) % 5;
  data.fieldProvenance = {
    demoUat: {
      synthetic: true,
      scenarioIndex: index,
      scenario
    }
  };
  const amount = Number(data.amount);

  if (scenario === "INCOMPLETE") {
    data.status = "NEEDS_REVIEW";
    data.memberId = variant === 0 ? null : data.memberId;
    data.billingProviderNpi = variant === 1 ? null : data.billingProviderNpi;
    data.icd10Codes = variant === 2 ? [] : data.icd10Codes;
    data.policyNo = variant === 3 ? null : data.policyNo;
    if (variant === 4) data.serviceLines = undefined;
    data.checks = { create: [{ score: 48, issues: [{ rule: "DEMO_MISSING_DATA", severity: "BLOCK", message: "Synthetic required claim data is missing", fixTarget: "claim" }], riskScore: 0.72, riskLevel: "HIGH", riskFactors: ["Missing required claim data"] }] };
  }

  if (scenario === "ELIGIBILITY") {
    data.status = "NEEDS_REVIEW";
    data.eligibilityStatus = variant < 2 ? "FAILED" : variant < 4 ? "NEEDS_REVIEW" : "NOT_CHECKED";
    data.coverageStatus = variant < 2 ? "INACTIVE" : "UNKNOWN";
    data.checks = { create: [{ score: 58, issues: [{ rule: "DEMO_ELIGIBILITY", severity: "BLOCK", message: "Eligibility requires review before submission", fixTarget: "eligibility" }], riskScore: 0.7, riskLevel: "HIGH", riskFactors: ["Eligibility not verified"] }] };
  }

  if (scenario === "PRIOR_AUTH") {
    data.status = "NEEDS_REVIEW";
    data.priorAuthRequired = true;
    data.priorAuthStatus = variant < 2 ? "REQUIRED" : variant < 4 ? "DENIED" : "NEEDS_REVIEW";
    data.authorizationNo = null;
    data.checks = { create: [{ score: 63, issues: [{ rule: "DEMO_PRIOR_AUTH", severity: "BLOCK", message: "Prior authorization requires resolution", fixTarget: "prior-auth" }], riskScore: 0.65, riskLevel: "HIGH", riskFactors: ["Prior authorization unresolved"] }] };
  }

  if (scenario === "SUBMITTED") {
    const states = ["SUBMITTED","ACKNOWLEDGED","RECEIVED","IN_REVIEW","PENDED"];
    data.status = "SUBMITTED";
    data.claimSubmissionDate = daysFromNow(-(variant + 1));
    data.payerClaimStatus = states[variant];
    data.remittanceStatus = "AWAITING";
    data.patientControlNumber = `PCN-${String(index).padStart(5, "0")}`;
    data.insurerClaimNo = `PAYER-${String(index).padStart(6, "0")}`;
    data.payerTransactions = {
      create: [{
        transactionId: `DEMO-277-${index}`,
        payerCode: data.payerEdiId,
        transactionType: "276_277",
        status: states[variant],
        mode: "SIMULATED",
        responsePayload: { synthetic: true, status: states[variant] }
      }]
    };
  }

  if (scenario === "REJECTED") {
    data.status = "SUBMITTED";
    data.claimSubmissionDate = daysFromNow(-4);
    data.payerClaimStatus = "REJECTED";
    data.remittanceStatus = "AWAITING";
    data.patientControlNumber = `PCN-${String(index).padStart(5, "0")}`;
    data.insurerClaimNo = `REJ-${String(index).padStart(6, "0")}`;
    data.payerTransactions = {
      create: [{
        transactionId: `DEMO-277CA-${index}`,
        payerCode: data.payerEdiId,
        transactionType: "277CA",
        status: "REJECTED",
        mode: "SIMULATED",
        responsePayload: { synthetic: true, rejection: "Subscriber or claim data requires correction" }
      }]
    };
  }

  if (["DENIAL_OPEN","APPEAL_PREPARED","APPEAL_SUBMITTED"].includes(scenario)) {
    data.status = "DENIED";
    data.claimSubmissionDate = daysFromNow(-12);
    data.payerClaimStatus = "DENIED";
    data.remittanceStatus = "RECEIVED";
    data.patientControlNumber = `PCN-${String(index).padStart(5, "0")}`;
    data.insurerClaimNo = `DEN-${String(index).padStart(6, "0")}`;
    const categories = ["CODING","ELIGIBILITY","AUTHORIZATION","DOCUMENTATION","OTHER"];
    const carc = ["16","27","197","50","96"][variant];
    const appealStatus = scenario === "DENIAL_OPEN" ? (variant % 2 ? "ANALYZED" : "OPEN") : scenario === "APPEAL_PREPARED" ? "APPEAL_PREPARED" : "APPEAL_SUBMITTED";
    data.denialCases = {
      create: [{
        source: "ERA",
        status: appealStatus,
        denialCategory: categories[variant],
        groupCode: "CO",
        carcCode: carc,
        rarcCode: "N130",
        reasonText: "Synthetic payer denial for demonstration and workflow testing",
        denialDate: daysFromNow(-6),
        correctable: variant !== 4,
        appealEligible: true,
        appealDeadline: daysFromNow(8 + variant * 5),
        revenueAtRisk: amount,
        recoveredAmount: scenario === "APPEAL_SUBMITTED" && variant === 4 ? money(amount * 0.2) : 0,
        recommendedAction: "Review payer denial evidence and prepare the appropriate correction or appeal",
        requiredDocuments: ["FINAL_BILL","CLINICAL_SUPPORT"],
        aiExplanation: scenario === "DENIAL_OPEN" && variant === 0 ? null : "Synthetic rule-based recovery assessment for manual UAT.",
        aiConfidence: scenario === "DENIAL_OPEN" && variant === 0 ? null : 84,
        aiProvider: scenario === "DENIAL_OPEN" && variant === 0 ? null : "RULE_ENGINE",
        aiModel: scenario === "DENIAL_OPEN" && variant === 0 ? null : "denial-rules-v1",
        aiAnalyzedAt: scenario === "DENIAL_OPEN" && variant === 0 ? null : daysFromNow(-1),
        appealRationale: scenario === "DENIAL_OPEN" ? null : "The claim documentation supports reconsideration based on the attached synthetic clinical and billing evidence.",
        appealPreparedAt: scenario === "DENIAL_OPEN" ? null : daysFromNow(-1),
        appealSubmittedAt: scenario === "APPEAL_SUBMITTED" ? new Date() : null,
        appealSubmissionReference: scenario === "APPEAL_SUBMITTED" ? `EXT-APPEAL-${index}` : null
      }]
    };
  }

  if (["PAID_POSTED","UNDERPAYMENT_OPEN","RECOVERED"].includes(scenario)) {
    const allowed = money(amount * 0.82);
    const patientResp = money(allowed * 0.1);
    const expectedPayer = money(allowed - patientResp);
    const shortfall = scenario === "PAID_POSTED" ? 0 : money(45 + variant * 20);
    const actualPaid = money(expectedPayer - shortfall);

    data.status = "PAID";
    data.claimSubmissionDate = daysFromNow(-25);
    data.payerClaimStatus = "PAID";
    data.remittanceStatus = "POSTED";
    data.remittanceReceivedAt = daysFromNow(-2);
    data.allowedAmount = allowed;
    data.patientResponsibility = patientResp;
    data.paidAmount = actualPaid;
    data.approvedAmount = allowed;
    data.paymentReference = `EFT-DEMO-${String(index).padStart(5, "0")}`;
    data.insurerClaimNo = `PAID-${String(index).padStart(6, "0")}`;
    data.documents.create.push(doc("EOB", index, "eob"));
    data.payerTransactions = {
      create: [{
        transactionId: `DEMO-835-${index}`,
        payerCode: data.payerEdiId,
        transactionType: "835",
        status: "POSTED",
        mode: "SIMULATED",
        responsePayload: { synthetic: true, allowedAmount: allowed, patientResponsibility: patientResp, paidAmount: actualPaid }
      }]
    };

    if (scenario !== "PAID_POSTED") {
      data.underpaymentCase = {
        create: {
          status: scenario === "RECOVERED" ? "RECOVERED" : (variant % 2 ? "REVIEWING" : "OPEN"),
          expectedPayerPayment: expectedPayer,
          actualPaidAmount: actualPaid,
          varianceAmount: shortfall,
          recoveredAmount: scenario === "RECOVERED" ? shortfall : 0,
          reasonCategory: "PAYER_PAYMENT_BELOW_EXPECTED",
          notes: scenario === "RECOVERED" ? "Synthetic recovery completed for demo UAT." : "Synthetic underpayment awaiting payer follow-up.",
          detectedAt: daysFromNow(-2),
          resolvedAt: scenario === "RECOVERED" ? new Date() : null
        }
      };
    }
  }

  return data;
}

async function main() {
  const organization = await prisma.organization.findUnique({ where: { slug: "demo-hospital" } });
  if (!organization) throw new Error("Demo Hospital organization not found. Run node prisma/seed.js first.");

  const admin = await prisma.user.findUnique({ where: { email: "admin@hospital.com" } });
  if (!admin) throw new Error("Admin user not found. Run node prisma/seed.js first.");

  const existing = await prisma.claim.findMany({
    where: {
      organizationId: organization.id,
      medicalRecordNumber: { startsWith: "DEMO-UAT-" }
    },
    select: { id: true }
  });

  if (existing.length) {
    await prisma.claim.deleteMany({ where: { id: { in: existing.map((x) => x.id) } } });
  }

  const counts = Object.fromEntries(SCENARIOS.map((s) => [s, 0]));

  for (let index = 1; index <= NAMES.length; index += 1) {
    const scenario = SCENARIOS[Math.floor((index - 1) / 5)];
    const data = configureScenario(index, scenario, baseClaim(index, NAMES[index - 1]));
    await prisma.claim.create({
      data: {
        ...data,
        organizationId: organization.id,
        createdById: admin.id
      }
    });
    counts[scenario] += 1;
  }

  console.log(`Demo UAT seed complete: ${NAMES.length} synthetic patients created.`);
  for (const [scenario, count] of Object.entries(counts)) {
    console.log(`  ${scenario}: ${count}`);
  }
  console.log("All patient identities and claim data are synthetic. Existing non-DEMO-UAT claims were preserved.");
}

main()
  .catch((error) => {
    console.error("Demo UAT seed failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
