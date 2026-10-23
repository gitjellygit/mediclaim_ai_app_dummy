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
  if (claimEdi && contractEdi && claimEdi === contractEdi) return 3;

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

export function calculateContractExpectedPayment(claim, contract) {
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

    const matched = matches[0]?.fee || null;
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
    const units = Number(serviceLine.units || 1);
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
    return {
      available: false,
      reason: "INCOMPLETE_FEE_SCHEDULE",
      contractId: contract.id,
      contractName: contract.name,
      contractVersion: contract.version,
      unmatchedLines,
      calculatedLines
    };
  }

  const expectedPayerPayment = Number(moneyFromCents(expectedCents));
  return {
    available: true,
    source: "CONTRACT_FEE_SCHEDULE",
    contractId: contract.id,
    contractName: contract.name,
    contractVersion: contract.version,
    effectiveFrom: contract.effectiveFrom,
    effectiveTo: contract.effectiveTo || null,
    expectedPayerPayment,
    calculatedLines
  };
}
