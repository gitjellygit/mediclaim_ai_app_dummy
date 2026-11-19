import { moneyCents, moneyFromCents, validMoney } from "../utils/money.js";

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function claimDate(claim) {
  const raw =
    claim?.dateOfService ||
    claim?.serviceLines?.find((line) => line?.serviceDateFrom)?.serviceDateFrom ||
    null;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function inEffectiveWindow(contract, date) {
  if (!date) return false;
  const from = new Date(contract.effectiveFrom);
  const to = contract.effectiveTo ? new Date(contract.effectiveTo) : null;
  if (Number.isNaN(from.getTime())) return false;
  return date >= from && (!to || date <= to);
}

function payerMatchScore(contract, claim) {
  const claimEdi = normalize(claim?.payerEdiId);
  const contractEdi = normalize(contract?.payerEdiId);
  if (claimEdi && contractEdi) {
    if (claimEdi === contractEdi) return 3;
    // When both sides carry an explicit payer identifier, a mismatch is
    // authoritative. Never fall back to a name match and risk applying the
    // wrong contract.
    return 0;
  }

  const claimName = normalizeName(claim?.payerName);
  const connectedName = normalizeName(claim?.connectedPayerName);
  const contractName = normalizeName(contract?.payerName);
  if (contractName && (contractName === claimName || contractName === connectedName)) return 2;
  return 0;
}

export function selectApplicableContract(claim, contracts = []) {
  const dos = claimDate(claim);
  const candidates = contracts
    .filter((contract) => String(contract.status || "").toUpperCase() === "ACTIVE")
    .filter((contract) => inEffectiveWindow(contract, dos))
    .map((contract) => ({ contract, score: payerMatchScore(contract, claim) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.contract.effectiveFrom) - new Date(a.contract.effectiveFrom);
    });

  return candidates[0]?.contract || null;
}

function feeLineScore(fee, serviceLine) {
  if (normalize(fee.cptHcpcsCode) !== normalize(serviceLine.cptHcpcsCode)) return -1;

  let score = 0;
  if (fee.modifier) {
    const modifiers = Array.isArray(serviceLine.modifiers)
      ? serviceLine.modifiers.map(normalize)
      : [];
    if (!modifiers.includes(normalize(fee.modifier))) return -1;
    score += 2;
  }
  if (fee.placeOfService) {
    if (normalize(fee.placeOfService) !== normalize(serviceLine.placeOfService)) return -1;
    score += 1;
  }
  return score;
}

function percentageTermApproved(contract) {
  return (
    contract?.pricingReviewStatus === "APPROVED" &&
    Boolean(contract?.pricingSourceDocumentId) &&
    Boolean(contract?.pricingSourcePage || contract?.pricingSourceClause) &&
    Boolean(contract?.pricingReviewedByUserId) &&
    Boolean(contract?.pricingReviewedAt)
  );
}

function percentageValue(contract) {
  const value = Number(contract?.referencePercent);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function percentOfCents(baseCents, percent) {
  const scaled = Number(baseCents) * percent / 100;
  return BigInt(Math.round(scaled));
}

function serviceLineUnits(serviceLine) {
  const raw = serviceLine?.units;
  if (raw == null || raw === "") return 1;
  const units = Number(raw);
  return Number.isFinite(units) && units > 0 ? units : null;
}

function percentagePricingProvenance(contract, extra = {}) {
  return {
    reviewStatus: contract.pricingReviewStatus,
    reviewedByUserId: contract.pricingReviewedByUserId,
    reviewedAt: contract.pricingReviewedAt,
    extractionMethod: contract.pricingExtractionMethod,
    sourceDocumentId: contract.pricingSourceDocumentId,
    sourcePage: contract.pricingSourcePage || null,
    sourceClause: contract.pricingSourceClause || null,
    referencePercent: Number(contract.referencePercent),
    roundingMode: contract.roundingMode || "HALF_UP",
    ...extra
  };
}

function calculatePercentChargeAllowance(serviceLines, contract) {
  if (!percentageTermApproved(contract)) {
    return { available: false, reason: "CONTRACT_PRICING_REVIEW_REQUIRED" };
  }
  const percent = percentageValue(contract);
  if (percent == null) {
    return { available: false, reason: "REFERENCE_PERCENT_MISSING" };
  }

  let expectedCents = 0n;
  const calculatedLines = [];
  const unmatchedLines = [];

  for (const line of serviceLines) {
    const charge = validMoney(line.charge);
    if (charge == null) {
      unmatchedLines.push({
        serviceLineId: line.id,
        cptHcpcsCode: line.cptHcpcsCode,
        reason: "LINE_CHARGE_MISSING"
      });
      continue;
    }
    const lineCents = percentOfCents(moneyCents(charge), percent);
    expectedCents += lineCents;
    calculatedLines.push({
      serviceLineId: line.id,
      cptHcpcsCode: line.cptHcpcsCode,
      billedCharge: Number(charge),
      referencePercent: percent,
      expectedAmount: Number(moneyFromCents(lineCents)),
      pricingMethod: "PERCENT_CHARGE",
      termProvenance: percentagePricingProvenance(contract)
    });
  }

  if (unmatchedLines.length) {
    return {
      available: false,
      reason: "PERCENT_CHARGE_INPUTS_INCOMPLETE",
      unmatchedLines,
      calculatedLines
    };
  }

  return {
    available: true,
    source: "CONTRACT_PERCENT_CHARGE",
    contractualAllowedAmount: Number(moneyFromCents(expectedCents)),
    calculatedLines,
    pricingEvidence: percentagePricingProvenance(contract)
  };
}

function calculatePercentMedicareAllowance(claim, serviceLines, contract) {
  if (!percentageTermApproved(contract)) {
    return { available: false, reason: "CONTRACT_PRICING_REVIEW_REQUIRED" };
  }
  const percent = percentageValue(contract);
  if (percent == null) {
    return { available: false, reason: "REFERENCE_PERCENT_MISSING" };
  }

  const schedule = contract.medicareRateSchedule;
  if (!schedule) {
    return { available: false, reason: "MEDICARE_SCHEDULE_MISSING" };
  }

  const dos = claimDate(claim);
  if (!dos) {
    return { available: false, reason: "CLAIM_SERVICE_DATE_MISSING" };
  }

  const scheduleFrom = new Date(schedule.effectiveFrom);
  const scheduleTo = schedule.effectiveTo ? new Date(schedule.effectiveTo) : null;
  if (
    Number.isNaN(scheduleFrom.getTime()) ||
    dos < scheduleFrom ||
    (scheduleTo && dos > scheduleTo)
  ) {
    return {
      available: false,
      reason: "MEDICARE_SCHEDULE_NOT_EFFECTIVE_FOR_DOS",
      scheduleYear: schedule.year,
      locality: schedule.locality
    };
  }

  if (Number(schedule.year) !== dos.getUTCFullYear()) {
    return {
      available: false,
      reason: "MEDICARE_SCHEDULE_YEAR_MISMATCH",
      scheduleYear: schedule.year,
      serviceYear: dos.getUTCFullYear(),
      locality: schedule.locality
    };
  }

  const rateLines = Array.isArray(schedule.lines) ? schedule.lines : [];
  let expectedCents = 0n;
  const calculatedLines = [];
  const unmatchedLines = [];

  for (const line of serviceLines) {
    const units = serviceLineUnits(line);
    if (units == null) {
      unmatchedLines.push({
        serviceLineId: line.id,
        cptHcpcsCode: line.cptHcpcsCode,
        reason: "INVALID_RATE_OR_UNITS"
      });
      continue;
    }

    const matches = rateLines
      .map((rate) => ({ rate, score: feeLineScore(rate, line) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score);

    const bestScore = matches[0]?.score ?? -1;
    const best = matches.filter((item) => item.score === bestScore);
    if (best.length !== 1) {
      unmatchedLines.push({
        serviceLineId: line.id,
        cptHcpcsCode: line.cptHcpcsCode,
        reason: best.length > 1
          ? "AMBIGUOUS_MEDICARE_RATE"
          : "MEDICARE_RATE_NOT_FOUND"
      });
      continue;
    }

    const amount = validMoney(best[0].rate.amount);
    if (amount == null) {
      unmatchedLines.push({
        serviceLineId: line.id,
        cptHcpcsCode: line.cptHcpcsCode,
        reason: "INVALID_MEDICARE_RATE"
      });
      continue;
    }

    const baseCents = BigInt(Math.round(Number(moneyCents(amount)) * units));
    const lineCents = percentOfCents(baseCents, percent);
    expectedCents += lineCents;
    calculatedLines.push({
      serviceLineId: line.id,
      cptHcpcsCode: line.cptHcpcsCode,
      units,
      medicareRateLineId: best[0].rate.id,
      medicareAmountPerUnit: Number(amount),
      medicareScheduleYear: schedule.year,
      medicareLocality: schedule.locality,
      referencePercent: percent,
      expectedAmount: Number(moneyFromCents(lineCents)),
      pricingMethod: "PERCENT_MEDICARE",
      termProvenance: percentagePricingProvenance(contract, {
        medicareScheduleId: schedule.id,
        medicareScheduleYear: schedule.year,
        medicareLocality: schedule.locality,
        medicareSource: schedule.source
      })
    });
  }

  if (unmatchedLines.length) {
    return {
      available: false,
      reason: "MEDICARE_PRICING_INPUTS_INCOMPLETE",
      scheduleYear: schedule.year,
      locality: schedule.locality,
      unmatchedLines,
      calculatedLines
    };
  }

  return {
    available: true,
    source: "CONTRACT_PERCENT_MEDICARE",
    contractualAllowedAmount: Number(moneyFromCents(expectedCents)),
    calculatedLines,
    pricingEvidence: percentagePricingProvenance(contract, {
      medicareScheduleId: schedule.id,
      medicareScheduleYear: schedule.year,
      medicareLocality: schedule.locality,
      medicareSource: schedule.source
    })
  };
}

function verifiedPatientResponsibility(claim, explicitEvidence = null) {
  if (explicitEvidence?.amount != null) {
    const explicitAmount = validMoney(explicitEvidence.amount);
    if (explicitAmount != null) {
      return {
        amount: Number(explicitAmount),
        source: explicitEvidence.source || "PAYER_REMITTANCE",
        label: explicitEvidence.label || "Payer-reported patient responsibility",
        sourceDetail: explicitEvidence.sourceDetail || null
      };
    }
  }

  const amount = validMoney(claim?.patientResponsibility);
  if (amount == null) return null;

  const provenance = claim?.fieldProvenance?.patientResponsibility || null;
  if (!provenance || provenance.verified !== true) return null;

  return {
    amount: Number(amount),
    source: provenance.source || "VERIFIED_CLAIM_FIELD",
    label: provenance.label || "Verified patient responsibility",
    sourceDetail: provenance.sourceDetail || null
  };
}

export function calculateContractExpectedPayment(
  claim,
  contract,
  { patientResponsibilityEvidence = null } = {}
) {
  if (!claim || !contract) {
    return { available: false, reason: "CONTRACT_NOT_AVAILABLE" };
  }
  if (String(claim.claimForm || "").toUpperCase() === "INSTITUTIONAL") {
    return {
      available: false,
      reason: "INSTITUTIONAL_CONTRACT_CALCULATION_NOT_SUPPORTED"
    };
  }

  const serviceLines = (claim.serviceLines || []).filter(
    (line) => line?.verified !== false && String(line?.cptHcpcsCode || "").trim()
  );
  if (!serviceLines.length) {
    return { available: false, reason: "NO_VERIFIED_SERVICE_LINES" };
  }

  const pricingMethod = String(contract.pricingMethod || "FEE_SCHEDULE").toUpperCase();

  let allowanceCalculation = null;
  if (pricingMethod === "PERCENT_CHARGE") {
    allowanceCalculation = calculatePercentChargeAllowance(serviceLines, contract);
  } else if (pricingMethod === "PERCENT_MEDICARE") {
    allowanceCalculation = calculatePercentMedicareAllowance(claim, serviceLines, contract);
  }

  if (allowanceCalculation && allowanceCalculation.available === false) {
    return {
      ...allowanceCalculation,
      contractId: contract.id,
      contractName: contract.name,
      contractVersion: contract.version
    };
  }

  const feeLines = Array.isArray(contract.feeScheduleLines)
    ? contract.feeScheduleLines
    : [];
  const calculatedLines = allowanceCalculation?.calculatedLines || [];
  const unmatchedLines = [];
  let expectedCents = allowanceCalculation
    ? moneyCents(allowanceCalculation.contractualAllowedAmount)
    : 0n;

  if (pricingMethod === "FEE_SCHEDULE") {
  for (const serviceLine of serviceLines) {
    const matches = feeLines
      .map((fee) => ({ fee, score: feeLineScore(fee, serviceLine) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score);

    const executableMatches = matches.filter(({ fee }) =>
      fee.reviewStatus === "APPROVED" &&
      Boolean(fee.sourceDocumentId || fee.sourceDocument?.id) &&
      Boolean(fee.sourcePage || fee.sourceClause) &&
      Boolean(fee.reviewedAt) &&
      Boolean(fee.reviewedByUserId)
    );

    if (matches.length && !executableMatches.length) {
      unmatchedLines.push({
        serviceLineId: serviceLine.id,
        cptHcpcsCode: serviceLine.cptHcpcsCode,
        modifiers: serviceLine.modifiers || [],
        placeOfService: serviceLine.placeOfService || null,
        reason: "CONTRACT_TERM_NOT_APPROVED",
        candidateFeeScheduleLineIds: matches.map((item) => item.fee.id)
      });
      continue;
    }

    const matched = executableMatches[0]?.fee || null;
    if (!matched) {
      unmatchedLines.push({
        serviceLineId: serviceLine.id,
        cptHcpcsCode: serviceLine.cptHcpcsCode,
        modifiers: serviceLine.modifiers || [],
        placeOfService: serviceLine.placeOfService || null
      });
      continue;
    }

    const rate = validMoney(matched.unitRate);
    const rawUnits = serviceLine.units;
    const units =
      rawUnits == null || rawUnits === ""
        ? 1
        : Number(rawUnits);
    if (rate == null || !Number.isFinite(units) || units <= 0) {
      unmatchedLines.push({
        serviceLineId: serviceLine.id,
        cptHcpcsCode: serviceLine.cptHcpcsCode,
        reason: "INVALID_RATE_OR_UNITS"
      });
      continue;
    }

    const rateCents = moneyCents(rate);
    const lineCents = BigInt(Math.round(Number(rateCents) * units));
    expectedCents += lineCents;
    calculatedLines.push({
      serviceLineId: serviceLine.id,
      cptHcpcsCode: serviceLine.cptHcpcsCode,
      modifiers: serviceLine.modifiers || [],
      placeOfService: serviceLine.placeOfService || null,
      units,
      feeScheduleLineId: matched.id,
      unitRate: Number(rate),
      expectedAmount: Number(moneyFromCents(lineCents)),
      termProvenance: {
        reviewStatus: matched.reviewStatus,
        reviewedByUserId: matched.reviewedByUserId,
        reviewedAt: matched.reviewedAt,
        extractionMethod: matched.extractionMethod,
        sourceDocumentId: matched.sourceDocumentId || matched.sourceDocument?.id || null,
        sourceDocumentName: matched.sourceDocument?.fileName || null,
        sourceDocumentType: matched.sourceDocument?.documentType || null,
        sourcePage: matched.sourcePage || null,
        sourceClause: matched.sourceClause || null
      }
    });
  }
  }

  if (unmatchedLines.length) {
    const hasUnapprovedTerm = unmatchedLines.some(
      (line) => line.reason === "CONTRACT_TERM_NOT_APPROVED"
    );
    return {
      available: false,
      reason: hasUnapprovedTerm
        ? "CONTRACT_TERM_REVIEW_REQUIRED"
        : "INCOMPLETE_FEE_SCHEDULE",
      contractId: contract.id,
      contractName: contract.name,
      contractVersion: contract.version,
      unmatchedLines,
      calculatedLines
    };
  }

  const contractualAllowedAmount = Number(moneyFromCents(expectedCents));
  const patientShare = verifiedPatientResponsibility(
    claim,
    patientResponsibilityEvidence
  );

  if (!patientShare) {
    return {
      available: false,
      reason: "PATIENT_RESPONSIBILITY_NOT_VERIFIED",
      contractId: contract.id,
      contractName: contract.name,
      contractVersion: contract.version,
      effectiveFrom: contract.effectiveFrom,
      effectiveTo: contract.effectiveTo || null,
      contractualAllowedAmount,
      calculatedLines,
      components: {
        contractualAllowedAmount: {
          amount: contractualAllowedAmount,
          source: allowanceCalculation?.source || "CONTRACT_FEE_SCHEDULE",
          contractId: contract.id,
          contractVersion: contract.version
        },
        patientResponsibility: {
          amount: claim?.patientResponsibility == null
            ? null
            : Number(claim.patientResponsibility),
          source: "UNVERIFIED"
        },
        expectedPayerPayment: {
          amount: null,
          source: "CANNOT_VERIFY"
        }
      }
    };
  }

  const expectedPayerCents = expectedCents - moneyCents(patientShare.amount);
  if (expectedPayerCents < 0n) {
    return {
      available: false,
      reason: "PATIENT_RESPONSIBILITY_EXCEEDS_CONTRACT_ALLOWANCE",
      contractId: contract.id,
      contractName: contract.name,
      contractVersion: contract.version,
      contractualAllowedAmount,
      patientResponsibility: patientShare.amount,
      calculatedLines
    };
  }

  const expectedPayerPayment = Number(moneyFromCents(expectedPayerCents));
  return {
    available: true,
    source: allowanceCalculation?.source || "CONTRACT_FEE_SCHEDULE",
    contractId: contract.id,
    contractName: contract.name,
    contractVersion: contract.version,
    effectiveFrom: contract.effectiveFrom,
    effectiveTo: contract.effectiveTo || null,
    contractualAllowedAmount,
    patientResponsibility: patientShare.amount,
    expectedPayerPayment,
    components: {
      contractualAllowedAmount: {
        amount: contractualAllowedAmount,
        source: allowanceCalculation?.source || "CONTRACT_FEE_SCHEDULE",
        contractId: contract.id,
        contractVersion: contract.version
      },
      patientResponsibility: patientShare,
      expectedPayerPayment: {
        amount: expectedPayerPayment,
        source: "DERIVED",
        formula: "contractualAllowedAmount - verifiedPatientResponsibility"
      }
    },
    calculatedLines,
    pricingEvidence: allowanceCalculation?.pricingEvidence || null
  };
}
