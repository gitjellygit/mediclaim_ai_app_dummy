
export function finalUatLocalSafety(env = process.env) {
  if (env.E2E_TEST_MODE !== "true" || env.NODE_ENV !== "test") {
    return {
      ok: false,
      reason: "Final UAT reset/seed requires E2E_TEST_MODE=true and NODE_ENV=test"
    };
  }

  try {
    const parsed = new URL(env.DATABASE_URL || "");
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (!localHosts.has(parsed.hostname)) {
      return {
        ok: false,
        reason: "Final UAT reset/seed is restricted to a local PostgreSQL database"
      };
    }
  } catch {
    return {
      ok: false,
      reason: "Final UAT reset/seed requires a valid local DATABASE_URL"
    };
  }

  return { ok: true };
}

export function buildFinalUatScenarios({
  organizationId,
  createdById,
  now = new Date()
}) {
  const prefix = "UAT-FINAL-";
  const day = 24 * 60 * 60 * 1000;
  const daysFromNow = (days) => new Date(now.getTime() + days * day);

  const firstNames = [
    "Alice", "Benjamin", "Chloe", "Daniel", "Emma",
    "Felix", "Grace", "Henry", "Isabella", "Jack",
    "Katherine", "Liam", "Maya", "Noah", "Olivia",
    "Patrick", "Quinn", "Rachel", "Samuel", "Tara"
  ];
  const lastNames = ["Morgan", "Carter", "Anderson", "Wilson", "Bennett"];

  const categories = [
    "CLEAN_READY",
    "MISSING_DATA",
    "ELIGIBILITY",
    "PRIOR_AUTH",
    "TIMELY_FILING",
    "SUBMITTED_STATUS",
    "DENIAL_REJECTION",
    "PAYMENT_REMITTANCE",
    "DOCUMENT_CODING",
    "EDGE_SEARCH_FILTER"
  ];

  const check = ({
    score = 95,
    riskScore = 0.05,
    riskLevel = "LOW",
    issues = [],
    riskFactors = [],
    stale = false,
    staleReason = null
  } = {}) => ({
    create: [{
      score,
      riskScore,
      riskLevel,
      issues,
      riskFactors,
      isStale: stale,
      staleAt: stale ? now : null,
      staleReason
    }]
  });

  const baseClaim = (index, category) => {
    const first = firstNames[(index - 1) % firstNames.length];
    const last = lastNames[Math.floor((index - 1) / firstNames.length)];
    const birthYear = 1955 + ((index * 7) % 50);
    const birthMonth = ((index * 3) % 12) + 1;
    const birthDay = ((index * 5) % 27) + 1;
    const dob = new Date(Date.UTC(birthYear, birthMonth - 1, birthDay));
    const age =
      now.getUTCFullYear() -
      birthYear -
      ((now.getUTCMonth() + 1 < birthMonth ||
        (now.getUTCMonth() + 1 === birthMonth && now.getUTCDate() < birthDay))
        ? 1
        : 0);
    const amount = 250 + index * 37;
    const institutional = index % 5 === 0;
    const serviceDate = daysFromNow(-(10 + (index % 45)));

    return {
      organizationId,
      createdById,
      patientName:
        prefix +
        String(index).padStart(3, "0") +
        " " +
        first +
        " " +
        last,
      patientAge: age,
      patientDob: dob,
      patientGender:
        index % 3 === 0 ? "OTHER" : index % 2 === 0 ? "FEMALE" : "MALE",
      patientAddress1: String(100 + index) + " Synthetic Avenue",
      patientCity: index % 2 === 0 ? "Denver" : "Austin",
      patientState: index % 2 === 0 ? "CO" : "TX",
      patientPostalCode: index % 2 === 0 ? "80203" : "78701",
      payerName:
        index % 4 === 0
          ? "Apex Benefit Network"
          : index % 4 === 1
          ? "Blue Horizon Health"
          : index % 4 === 2
          ? "SummitCare Insurance"
          : "Cedar Health Plan",
      payerEdiId: "UAT" + String(1000 + index),
      policyNo: "POL-FINAL-" + String(index).padStart(3, "0"),
      memberId: "MEM-FINAL-" + String(index).padStart(3, "0"),
      groupNumber: "GRP-" + String(100 + (index % 12)),
      subscriberId: "SUB-" + String(index).padStart(3, "0"),
      subscriberName: first + " " + last,
      subscriberDob: dob,
      subscriberRelationship: "SELF",
      amount,
      totalBilledAmount: amount,
      claimForm: institutional ? "INSTITUTIONAL" : "PROFESSIONAL",
      claimType: "PROVIDER_BILLED",
      claimStage: "FINAL",
      billingProviderNpi: "1234567890",
      renderingProviderNpi: institutional ? null : "1987654321",
      providerTin: "123456789",
      providerTaxonomyCode: institutional ? "282N00000X" : "207Q00000X",
      diagnosisText: "Synthetic outpatient evaluation",
      icd10Codes: ["Z00.00"],
      dateOfService: serviceDate,
      timelyFilingDeadline: daysFromNow(90 - (index % 40)),
      status: "READY",
      eligibilityStatus: "VERIFIED",
      eligibilityCheckedAt: daysFromNow(-1),
      coverageStatus: "ACTIVE",
      networkStatus: "IN_NETWORK",
      priorAuthRequired: false,
      priorAuthStatus: "NOT_REQUIRED",
      priorAuthCheckedAt: daysFromNow(-1),
      remittanceStatus: "NOT_AVAILABLE",
      payerConnectionMode: "SIMULATED",
      simulatedPayerCode: "BLUE_HORIZON",
      checks: check({
        score: 90 + (index % 10),
        riskScore: 0.03 + (index % 6) * 0.02,
        riskLevel: "LOW"
      }),
      serviceLines: {
        create: [{
          cptHcpcsCode: institutional ? "99223" : "99213",
          units: 1,
          charge: amount,
          diagnosisPointers: ["Z00.00"],
          placeOfService: institutional ? "21" : "11",
          revenueCode: institutional ? "0450" : null,
          serviceDateFrom: serviceDate,
          serviceDateTo: serviceDate,
          verified: true,
          source: "USER"
        }]
      },
      typeOfBill: institutional ? "0111" : null,
      patientStatusCode: institutional ? "01" : null,
      admissionDate: institutional ? daysFromNow(-(12 + (index % 45))) : null,
      dischargeDate: institutional ? daysFromNow(-(9 + (index % 45))) : null,
      admissionType: institutional ? "PLANNED" : null,
      roomCategory: institutional ? "PRIVATE" : null,
      icuDays: institutional ? 0 : null,
      claimFilingCode: "CI",
      fieldProvenance: {
        finalUat: {
          synthetic: true,
          category,
          scenarioNumber: index
        }
      }
    };
  };

  const scenarioFor = (index) => {
    const category = categories[Math.floor((index - 1) / 10)];
    const data = baseClaim(index, category);
    const expected = {
      category,
      persistedStatus: data.status,
      payerStatus: null
    };
    const variant = index % 10;

    if (category === "MISSING_DATA") {
      data.status = "NEEDS_REVIEW";
      data.checks = check({
        score: 45 + index,
        riskScore: 0.65,
        riskLevel: "HIGH",
        issues: [{
          rule: "FINAL_UAT_MISSING_DATA",
          severity: "BLOCK",
          message: "Synthetic required claim data is missing",
          fixTarget: "claim"
        }],
        riskFactors: ["Missing required claim data"]
      });
      if (variant === 1) data.memberId = null;
      if (variant === 2) data.policyNo = null;
      if (variant === 3) data.billingProviderNpi = null;
      if (variant === 4) data.icd10Codes = [];
      if (variant === 5) data.diagnosisText = null;
      if (variant === 6) data.timelyFilingDeadline = null;
      if (variant === 7) data.payerEdiId = null;
      if (variant === 8) {
        data.memberId = null;
        data.policyNo = null;
        data.billingProviderNpi = null;
      }
      if (variant === 9) data.serviceLines = undefined;
      if (variant === 0) {
        data.patientAddress1 = null;
        data.patientPostalCode = null;
      }
    }

    if (category === "ELIGIBILITY") {
      data.status = "NEEDS_REVIEW";
      data.eligibilityStatus =
        variant <= 3
          ? "FAILED"
          : variant <= 6
          ? "NEEDS_REVIEW"
          : variant <= 8
          ? "NOT_CHECKED"
          : "VERIFIED";
      data.coverageStatus =
        data.eligibilityStatus === "VERIFIED"
          ? "ACTIVE"
          : variant % 2 === 0
          ? "INACTIVE"
          : "UNKNOWN";
      data.checks = check({
        score: data.eligibilityStatus === "VERIFIED" ? 88 : 62,
        riskScore: data.eligibilityStatus === "VERIFIED" ? 0.18 : 0.7,
        riskLevel: data.eligibilityStatus === "VERIFIED" ? "LOW" : "HIGH",
        issues:
          data.eligibilityStatus === "VERIFIED"
            ? []
            : [{
                rule: "FINAL_UAT_ELIGIBILITY",
                severity: "BLOCK",
                message: "Eligibility requires review before submission",
                fixTarget: "eligibility"
              }],
        riskFactors:
          data.eligibilityStatus === "VERIFIED"
            ? []
            : ["Eligibility not verified"]
      });
    }

    if (category === "PRIOR_AUTH") {
      data.status = "NEEDS_REVIEW";
      data.priorAuthRequired = true;
      if (variant <= 2) data.priorAuthStatus = "REQUIRED";
      else if (variant <= 4) data.priorAuthStatus = "DENIED";
      else if (variant <= 6) {
        data.priorAuthStatus = "APPROVED";
        data.authorizationNo = "AUTH-FINAL-" + String(index);
        data.priorAuthExpiry = daysFromNow(-2);
      } else if (variant <= 8) {
        data.priorAuthStatus = "NEEDS_REVIEW";
      } else {
        data.priorAuthStatus = "APPROVED";
        data.authorizationNo = "AUTH-FINAL-" + String(index);
        data.priorAuthExpiry = daysFromNow(45);
        data.status = "READY";
      }
      data.checks = check({
        score: data.status === "READY" ? 94 : 68,
        riskScore: data.status === "READY" ? 0.1 : 0.62,
        riskLevel: data.status === "READY" ? "LOW" : "HIGH",
        issues:
          data.status === "READY"
            ? []
            : [{
                rule: "FINAL_UAT_PRIOR_AUTH",
                severity: "BLOCK",
                message: "Prior authorization requires resolution",
                fixTarget: "prior-auth"
              }],
        riskFactors:
          data.status === "READY" ? [] : ["Prior authorization unresolved"]
      });
    }

    if (category === "TIMELY_FILING") {
      const offsets = [-30, -7, -1, 0, 3, 7, 14, 21, 30, 90];
      const offset = offsets[variant];
      data.status = variant <= 4 ? "NEEDS_REVIEW" : "READY";
      data.timelyFilingDeadline = daysFromNow(offset);
      data.checks = check({
        score: offset < 0 ? 55 : 92,
        riskScore: offset < 0 ? 0.85 : offset <= 7 ? 0.55 : 0.12,
        riskLevel: offset < 0 ? "HIGH" : offset <= 7 ? "MED" : "LOW",
        riskFactors:
          offset <= 7 ? ["Timely filing deadline requires attention"] : []
      });
    }

    if (category === "SUBMITTED_STATUS") {
      const payerStatuses = [
        "SUBMITTED",
        "ACKNOWLEDGED",
        "RECEIVED",
        "IN_REVIEW",
        "PENDED",
        "APPROVED",
        "PARTIALLY_APPROVED",
        "REJECTED",
        "ACKNOWLEDGED",
        "IN_REVIEW"
      ];
      data.status = "SUBMITTED";
      data.claimSubmissionDate = daysFromNow(-(variant + 1));
      data.remittanceStatus = "AWAITING";
      data.payerClaimStatus = payerStatuses[variant];
      data.checks = check({
        score: 94,
        riskScore: 0.08,
        riskLevel: "LOW"
      });
    }

    if (category === "DENIAL_REJECTION") {
      const rejected = variant % 3 === 0;
      data.status = rejected ? "SUBMITTED" : "DENIED";
      data.claimSubmissionDate = daysFromNow(-(variant + 5));
      data.payerClaimStatus = rejected ? "REJECTED" : "DENIED";
      data.remittanceStatus = rejected ? "AWAITING" : "RECEIVED";
      if (!rejected) {
        data.denialCases = {
          create: [{
            source: "SIMULATED_PAYER_STATUS",
            status: variant % 2 === 0 ? "OPEN" : "ANALYZED",
            denialCategory:
              variant % 4 === 0
                ? "CODING"
                : variant % 4 === 1
                ? "ELIGIBILITY"
                : variant % 4 === 2
                ? "AUTHORIZATION"
                : "DOCUMENTATION",
            groupCode: "CO",
            carcCode: variant % 2 === 0 ? "16" : "197",
            rarcCode: "N130",
            reasonText: "Synthetic Final UAT denial",
            denialDate: daysFromNow(-3),
            correctable: true,
            appealEligible: true,
            appealDeadline: daysFromNow(30),
            revenueAtRisk: data.amount,
            recoveredAmount: 0,
            recommendedAction:
              "Review synthetic denial and prepare correction or appeal"
          }]
        };
      }
    }

    if (category === "PAYMENT_REMITTANCE") {
      const partial = variant % 2 === 0;
      data.status = "PAID";
      data.claimSubmissionDate = daysFromNow(-20);
      data.payerClaimStatus = "PAID";
      data.remittanceStatus = "POSTED";
      data.allowedAmount = Math.max(100, data.amount - 40);
      data.patientResponsibility = 25;
      data.paidAmount =
        data.allowedAmount - (partial ? 80 : 25);
      data.approvedAmount = data.allowedAmount;
      data.paymentReference = "PAY-FINAL-" + String(index);
      if (partial) {
        const expectedPayment =
          Number(data.allowedAmount) - Number(data.patientResponsibility);
        const actualPaid = Number(data.paidAmount);
        data.underpaymentCase = {
          create: {
            status: variant % 4 === 0 ? "REVIEWING" : "OPEN",
            expectedPayerPayment: expectedPayment,
            actualPaidAmount: actualPaid,
            varianceAmount: Math.max(0, expectedPayment - actualPaid),
            recoveredAmount: 0,
            reasonCategory: "PAYER_PAYMENT_BELOW_EXPECTED",
            notes: "Synthetic Final UAT partial payment"
          }
        };
      }
    }

    if (category === "DOCUMENT_CODING") {
      data.status = variant % 2 === 0 ? "NEEDS_REVIEW" : "READY";
      data.documents = {
        create: [{
          type: variant % 3 === 0 ? "OTHER" : "FINAL_BILL",
          fileName:
            "final-uat-" +
            String(index) +
            "-" +
            (variant % 3 === 0 ? "unrelated" : "bill") +
            ".pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048 + index,
          path: "e2e-fixture://final-uat-" + String(index) + ".pdf",
          status: variant % 4 === 0 ? "FAILED" : "PROCESSED",
          confidence: variant % 4 === 0 ? 35 : 94,
          extracted: {
            patientName: data.patientName,
            amount: Number(data.amount),
            synthetic: true
          }
        }]
      };
      if (variant % 2 === 0) data.checks = undefined;
    }

    if (category === "EDGE_SEARCH_FILTER") {
      data.status =
        variant < 2
          ? "DRAFT"
          : variant < 4
          ? "NEEDS_REVIEW"
          : variant < 6
          ? "READY"
          : variant < 8
          ? "SUBMITTED"
          : variant === 8
          ? "DENIED"
          : "PAID";
      if (["SUBMITTED", "DENIED", "PAID"].includes(data.status)) {
        data.claimSubmissionDate = daysFromNow(-5);
      }
      if (data.status === "DENIED") data.payerClaimStatus = "DENIED";
      if (data.status === "PAID") {
        data.payerClaimStatus = "PAID";
        data.remittanceStatus = "POSTED";
        data.allowedAmount = data.amount - 20;
        data.patientResponsibility = 10;
        data.paidAmount = data.amount - 30;
        data.approvedAmount = data.allowedAmount;
        data.paymentReference = "PAY-EDGE-" + String(index);
      }
      if (variant === 0) {
        data.checks = check({
          score: 72,
          riskScore: 0.48,
          riskLevel: "MED",
          stale: true,
          staleReason: "Synthetic claim edited after readiness check"
        });
      }
    }

    expected.persistedStatus = data.status;
    expected.payerStatus = data.payerClaimStatus || null;

    return {
      index,
      category,
      expected,
      createData: data,
      addPendingCodingSuggestion:
        category === "DOCUMENT_CODING" && variant % 2 === 0
    };
  };

  return {
    prefix,
    categories,
    scenarios: Array.from({ length: 100 }, (_, offset) =>
      scenarioFor(offset + 1)
    )
  };
}
