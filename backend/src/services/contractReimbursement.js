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
    return 0;
  }

  const claimName = normalizeName(claim?.payerName);
  const connectedName = normalizeName(claim?.connectedPayerName);
  const contractName = normalizeName(contract?.payerName);
  if (contractName && (contractName === claimName || contractName === connectedName)) return 2;
  return 0;
}

function contractScopeResult(contract, claim) {
  const dimensions = [
    ["productType", contract?.productType, claim?.productType],
    ["groupNumber", contract?.groupNumber, claim?.groupNumber],
    ["networkStatus", contract?.networkStatus, claim?.networkStatus],
    ["providerTin", contract?.providerTin, claim?.providerTin]
  ];

  const missing = [];
  const mismatched = [];
  let specificity = 0;

  for (const [field, expected, actual] of dimensions) {
    if (!expected) continue;
    specificity += 1;
    if (!actual) {
      missing.push(field);
      continue;
    }
    if (normalize(expected) !== normalize(actual)) mismatched.push(field);
  }

  if (contract?.placeOfService) {
    specificity += 1;
    const expected = normalize(contract.placeOfService);
    const values = (claim?.serviceLines || [])
      .filter((line) => line?.verified !== false)
      .map((line) => normalize(line?.placeOfService))
      .filter(Boolean);

    if (!values.length) {
      missing.push("placeOfService");
    } else if (values.some((value) => value !== expected)) {
      mismatched.push("placeOfService");
    }
  }

  return {
    matches: missing.length === 0 && mismatched.length === 0,
    specificity,
    missing,
    mismatched
  };
}

function contractCandidateSummary(item) {
  return {
    contractId: item.contract.id,
    contractName: item.contract.name,
    contractVersion: item.contract.version,
    payerMatchScore: item.payerScore,
    applicabilitySpecificity: item.scope.specificity,
    effectiveFrom: item.contract.effectiveFrom,
    effectiveTo: item.contract.effectiveTo || null,
    missingApplicability: item.scope.missing || [],
    mismatchedApplicability: item.scope.mismatched || []
  };
}

export function resolveApplicableContract(claim, contracts = []) {
  const dos = claimDate(claim);
  if (!dos) {
    return {
      status: "UNAVAILABLE",
      reason: "CLAIM_SERVICE_DATE_MISSING",
      contract: null,
      candidates: []
    };
  }

  const payerCandidates = contracts
    .filter((contract) => String(contract.status || "").toUpperCase() === "ACTIVE")
    .filter((contract) => inEffectiveWindow(contract, dos))
    .map((contract) => ({
      contract,
      payerScore: payerMatchScore(contract, claim),
      scope: contractScopeResult(contract, claim)
    }))
    .filter((item) => item.payerScore > 0);

  const applicable = payerCandidates.filter((item) => item.scope.matches);
  if (!applicable.length) {
    return {
      status: "UNAVAILABLE",
      reason: payerCandidates.length
        ? "CONTRACT_APPLICABILITY_NOT_VERIFIABLE"
        : "NO_APPLICABLE_CONTRACT",
      contract: null,
      candidates: payerCandidates.map(contractCandidateSummary)
    };
  }

  const bestPayerScore = Math.max(...applicable.map((item) => item.payerScore));
  const payerBest = applicable.filter((item) => item.payerScore === bestPayerScore);
  const bestSpecificity = Math.max(...payerBest.map((item) => item.scope.specificity));
  const best = payerBest.filter((item) => item.scope.specificity === bestSpecificity);

  if (best.length > 1) {
    return {
      status: "AMBIGUOUS",
      reason: "AMBIGUOUS_CONTRACT_MATCH",
      contract: null,
      candidates: best.map(contractCandidateSummary)
    };
  }

  return {
    status: "MATCHED",
    reason: null,
    contract: best[0].contract,
    candidates: [contractCandidateSummary(best[0])]
  };
}

export function selectApplicableContract(claim, contracts = []) {
  const resolved = resolveApplicableContract(claim, contracts);
  return resolved.status === "MATCHED" ? resolved.contract : null;
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

  const feeLines = Array.isArray(contract.feeScheduleLines)
    ? contract.feeScheduleLines
    : [];
  const calculatedLines = [];
  const unmatchedLines = [];
  let expectedCents = 0n;

  for (const serviceLine of serviceLines) {
    const matches = feeLines
      .map((fee) => ({ fee, score: feeLineScore(fee, serviceLine) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score);

    const bestScore = matches[0]?.score ?? -1;
    const bestMatches = matches.filter((item) => item.score === bestScore);
    if (bestMatches.length > 1) {
      unmatchedLines.push({
        serviceLineId: serviceLine.id,
        cptHcpcsCode: serviceLine.cptHcpcsCode,
        modifiers: serviceLine.modifiers || [],
        placeOfService: serviceLine.placeOfService || null,
        reason: "AMBIGUOUS_FEE_SCHEDULE_MATCH",
        candidateFeeScheduleLineIds: bestMatches.map((item) => item.fee.id)
      });
      continue;
    }

    const matched = bestMatches[0]?.fee || null;
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
      expectedAmount: Number(moneyFromCents(lineCents))
    });
  }

  if (unmatchedLines.length) {
    const ambiguous = unmatchedLines.some(
      (line) => line.reason === "AMBIGUOUS_FEE_SCHEDULE_MATCH"
    );
    return {
      available: false,
      reason: ambiguous
        ? "AMBIGUOUS_FEE_SCHEDULE_MATCH"
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
          source: "CONTRACT_FEE_SCHEDULE",
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
    source: "CONTRACT_FEE_SCHEDULE",
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
        source: "CONTRACT_FEE_SCHEDULE",
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
    calculatedLines
  };
}
