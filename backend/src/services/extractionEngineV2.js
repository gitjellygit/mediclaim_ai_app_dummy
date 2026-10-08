import { parseClaimDate } from "../utils/claimDate.js";
import { validMoney } from "../utils/money.js";
import { mergeProvenance } from "./claimFieldProvenance.js";

export const EXTRACTION_ENGINE_VERSION = "v2.0";

const PLACEHOLDER_VALUES = new Set([
  "",
  "unknown",
  "unknown patient",
  "unknown payer",
  "insurance",
  "payer"
]);

const DOC = {
  IDENTITY: ["INSURANCE_CARD", "ID_PROOF", "PRIOR_AUTHORIZATION"],
  CLINICAL: [
    "PROGRESS_NOTE",
    "OPERATIVE_NOTE",
    "DISCHARGE_SUMMARY",
    "LAB_REPORT",
    "RADIOLOGY"
  ],
  BILLING: ["FINAL_BILL", "BREAKUP_BILL", "EOB"],
  ALL_CLAIM: [
    "INSURANCE_CARD",
    "ID_PROOF",
    "PRIOR_AUTHORIZATION",
    "PROGRESS_NOTE",
    "OPERATIVE_NOTE",
    "DISCHARGE_SUMMARY",
    "LAB_REPORT",
    "RADIOLOGY",
    "FINAL_BILL",
    "BREAKUP_BILL",
    "EOB"
  ]
};

const FIELDS = {
  patientName: {
    extracted: ["patientName"],
    docs: DOC.ALL_CLAIM,
    criticality: "CRITICAL",
    normalize: normalizeName,
    validate: validateName,
    threshold: 97,
    consensusForAuto: 1
  },
  patientDob: {
    extracted: ["dateOfBirth", "patientDob", "dob"],
    docs: [...DOC.IDENTITY, ...DOC.CLINICAL, ...DOC.BILLING],
    criticality: "CRITICAL",
    normalize: normalizeDate,
    validate: validateDate,
    threshold: 99,
    consensusForAuto: 2
  },
  memberId: {
    extracted: ["memberId", "member_id"],
    docs: ["INSURANCE_CARD", "PRIOR_AUTHORIZATION", "FINAL_BILL", "EOB"],
    criticality: "CRITICAL",
    normalize: normalizeIdentifier,
    validate: validateIdentifier,
    threshold: 99,
    consensusForAuto: 2
  },
  policyNo: {
    extracted: ["policyNo", "policyNumber", "policy_number"],
    docs: ["INSURANCE_CARD", "PRIOR_AUTHORIZATION", "FINAL_BILL", "EOB"],
    criticality: "CRITICAL",
    normalize: normalizeIdentifier,
    validate: validateIdentifier,
    threshold: 99,
    consensusForAuto: 2
  },
  groupNumber: {
    extracted: ["groupNumber", "group_number"],
    docs: ["INSURANCE_CARD", "PRIOR_AUTHORIZATION", "EOB"],
    criticality: "STANDARD",
    normalize: normalizeIdentifier,
    validate: validateIdentifier,
    threshold: 95
  },
  subscriberId: {
    extracted: ["subscriberId", "subscriber_id"],
    docs: ["INSURANCE_CARD", "PRIOR_AUTHORIZATION", "EOB"],
    criticality: "CRITICAL",
    normalize: normalizeIdentifier,
    validate: validateIdentifier,
    threshold: 99,
    consensusForAuto: 2
  },
  subscriberName: {
    extracted: ["subscriberName", "subscriber_name", "policyHolder"],
    docs: ["INSURANCE_CARD", "PRIOR_AUTHORIZATION", "EOB"],
    criticality: "STANDARD",
    normalize: normalizeName,
    validate: validateName,
    threshold: 95
  },
  payerName: {
    extracted: ["payerName", "payer_name"],
    docs: ["INSURANCE_CARD", "PRIOR_AUTHORIZATION", "FINAL_BILL", "EOB"],
    criticality: "CRITICAL",
    normalize: normalizeName,
    validate: validateName,
    threshold: 97,
    consensusForAuto: 1
  },
  payerEdiId: {
    extracted: ["payerEdiId", "payer_edi_id"],
    docs: ["INSURANCE_CARD", "PRIOR_AUTHORIZATION", "EOB"],
    criticality: "CRITICAL",
    normalize: normalizeIdentifier,
    validate: validatePayerEdi,
    threshold: 99,
    consensusForAuto: 1
  },
  medicalRecordNumber: {
    extracted: ["medicalRecordNumber", "mrn"],
    docs: [...DOC.CLINICAL, "FINAL_BILL"],
    criticality: "STANDARD",
    normalize: normalizeIdentifier,
    validate: validateIdentifier,
    threshold: 95
  },
  patientMobile: {
    extracted: ["patientMobile", "phone", "mobile"],
    docs: [...DOC.IDENTITY, ...DOC.CLINICAL],
    criticality: "STANDARD",
    normalize: normalizePhone,
    validate: validatePhone,
    threshold: 96
  },
  insurerClaimNo: {
    extracted: ["claimNo", "claimNumber", "claim_number"],
    docs: ["FINAL_BILL", "EOB"],
    criticality: "STANDARD",
    normalize: normalizeIdentifier,
    validate: validateIdentifier,
    threshold: 96
  },
  hospitalName: {
    extracted: ["hospitalName", "hospital_name"],
    docs: [...DOC.CLINICAL, "FINAL_BILL", "PRIOR_AUTHORIZATION"],
    criticality: "STANDARD",
    normalize: normalizeName,
    validate: validateName,
    threshold: 94
  },
  doctorName: {
    extracted: ["doctorName", "doctor_name"],
    docs: [...DOC.CLINICAL, "PRIOR_AUTHORIZATION"],
    criticality: "STANDARD",
    normalize: normalizeName,
    validate: validateName,
    threshold: 94
  },
  diagnosisText: {
    extracted: ["diagnosisText", "diagnosis"],
    docs: [...DOC.CLINICAL, "DISCHARGE_SUMMARY", "FINAL_BILL"],
    criticality: "STANDARD",
    normalize: normalizeText,
    validate: validateText,
    threshold: 92
  },
  authorizationNo: {
    extracted: ["authorizationNo", "authorization_number"],
    docs: ["PRIOR_AUTHORIZATION"],
    criticality: "CRITICAL",
    normalize: normalizeIdentifier,
    validate: validateIdentifier,
    threshold: 98,
    consensusForAuto: 1
  },
  dateOfService: {
    extracted: ["dateOfService", "serviceDate"],
    docs: [...DOC.CLINICAL, ...DOC.BILLING, "PRIOR_AUTHORIZATION"],
    criticality: "CRITICAL",
    normalize: normalizeDate,
    validate: validateDate,
    threshold: 98,
    consensusForAuto: 1
  },
  admissionDate: {
    extracted: ["admissionDate"],
    docs: ["DISCHARGE_SUMMARY", "FINAL_BILL"],
    criticality: "STANDARD",
    normalize: normalizeDate,
    validate: validateDate,
    threshold: 96
  },
  dischargeDate: {
    extracted: ["dischargeDate"],
    docs: ["DISCHARGE_SUMMARY", "FINAL_BILL"],
    criticality: "STANDARD",
    normalize: normalizeDate,
    validate: validateDate,
    threshold: 96
  },
  amount: {
    extracted: ["amount"],
    docs: ["FINAL_BILL", "BREAKUP_BILL"],
    criticality: "CRITICAL",
    normalize: normalizeMoney,
    validate: validateMoney,
    threshold: 99,
    consensusForAuto: 1
  },
  totalBilledAmount: {
    extracted: ["amount", "totalBilledAmount"],
    docs: ["FINAL_BILL", "BREAKUP_BILL"],
    criticality: "CRITICAL",
    normalize: normalizeMoney,
    validate: validateMoney,
    threshold: 99,
    consensusForAuto: 1
  },
  billingProviderNpi: {
    extracted: ["billingProviderNpi"],
    docs: ["FINAL_BILL", "BREAKUP_BILL", "PROGRESS_NOTE", "OPERATIVE_NOTE"],
    criticality: "CRITICAL",
    normalize: normalizeDigits,
    validate: validateNpi,
    threshold: 99,
    consensusForAuto: 1
  },
  renderingProviderNpi: {
    extracted: ["renderingProviderNpi"],
    docs: ["PROGRESS_NOTE", "OPERATIVE_NOTE", "FINAL_BILL"],
    criticality: "CRITICAL",
    normalize: normalizeDigits,
    validate: validateNpi,
    threshold: 99,
    consensusForAuto: 1
  },
  referringProviderNpi: {
    extracted: ["referringProviderNpi"],
    docs: ["PROGRESS_NOTE", "OPERATIVE_NOTE", "PRIOR_AUTHORIZATION"],
    criticality: "STANDARD",
    normalize: normalizeDigits,
    validate: validateNpi,
    threshold: 98
  },
  providerTin: {
    extracted: ["providerTin"],
    docs: ["FINAL_BILL", "BREAKUP_BILL", "PROGRESS_NOTE"],
    criticality: "STANDARD",
    normalize: normalizeTin,
    validate: validateTin,
    threshold: 98
  },
  providerTaxonomyCode: {
    extracted: ["providerTaxonomyCode", "providerTaxonomy"],
    docs: ["FINAL_BILL", "PROGRESS_NOTE"],
    criticality: "STANDARD",
    normalize: normalizeIdentifier,
    validate: validateTaxonomy,
    threshold: 98
  },
  typeOfBill: {
    extracted: ["typeOfBill"],
    docs: ["FINAL_BILL", "BREAKUP_BILL", "DISCHARGE_SUMMARY"],
    criticality: "CRITICAL",
    normalize: normalizeDigits,
    validate: validateTypeOfBill,
    threshold: 99
  },
  drgCode: {
    extracted: ["drgCode"],
    docs: ["FINAL_BILL", "DISCHARGE_SUMMARY"],
    criticality: "STANDARD",
    normalize: normalizeDigits,
    validate: validateDrg,
    threshold: 97
  },
  planAdministratorName: {
    extracted: ["planAdministratorName"],
    docs: ["INSURANCE_CARD", "EOB"],
    criticality: "STANDARD",
    normalize: normalizeName,
    validate: validateName,
    threshold: 95
  },
  coverageLimit: {
    extracted: ["coverageLimit"],
    docs: ["INSURANCE_CARD", "EOB"],
    criticality: "STANDARD",
    normalize: normalizeMoney,
    validate: validateMoney,
    threshold: 98
  },
  remainingCoverageLimit: {
    extracted: ["remainingCoverageLimit"],
    docs: ["INSURANCE_CARD", "EOB"],
    criticality: "STANDARD",
    normalize: normalizeMoney,
    validate: validateMoney,
    threshold: 98
  }
};

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function normalizeName(value) {
  return normalizeText(value)
    .replace(/\b(?:mr|mrs|ms|dr)\.?\s+/gi, "")
    .trim();
}
function normalizeIdentifier(value) {
  return normalizeText(value).toUpperCase().replace(/\s+/g, "");
}
function normalizeDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}
function normalizeTin(value) {
  const digits = normalizeDigits(value);
  return digits.length === 9 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits;
}
function normalizePhone(value) {
  return normalizeDigits(value);
}
function normalizeDate(value) {
  const parsed = parseClaimDate(value);
  return parsed ? parsed.toISOString().slice(0, 10) : "";
}
function normalizeMoney(value) {
  const precise = validMoney(value);
  return precise == null ? "" : Number(precise).toFixed(2);
}

function ok() {
  return { status: "VALID", message: null };
}
function invalid(message) {
  return { status: "INVALID", message };
}
function validateText(value) {
  return normalizeText(value).length >= 3 ? ok() : invalid("Value is too short");
}
function validateName(value) {
  const text = normalizeText(value);
  if (text.length < 3 || text.length > 120) return invalid("Name length is invalid");
  if (/^(?:identification|member|policy|unknown)$/i.test(text)) {
    return invalid("Value looks like a field label, not a name");
  }
  return ok();
}
function validateIdentifier(value) {
  const text = normalizeIdentifier(value);
  if (text.length < 3 || text.length > 60) return invalid("Identifier length is invalid");
  if (/^(?:IDENTIFICATION|MEMBER|POLICY|NUMBER|ID)$/i.test(text)) {
    return invalid("Value looks like a field label");
  }
  if (!/[0-9]/.test(text)) return invalid("Identifier has no numeric component");
  return ok();
}
function validatePayerEdi(value) {
  const text = normalizeIdentifier(value);
  return /^[A-Z0-9-]{3,20}$/.test(text) ? ok() : invalid("Invalid payer EDI ID");
}
function validatePhone(value) {
  const digits = normalizePhone(value);
  return digits.length >= 10 && digits.length <= 15 ? ok() : invalid("Invalid phone number");
}
function validateDate(value) {
  const normalized = normalizeDate(value);
  if (!normalized) return invalid("Invalid date");
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return invalid("Invalid date");
  const year = parsed.getUTCFullYear();
  if (year < 1900 || year > new Date().getUTCFullYear() + 2) {
    return invalid("Date is outside expected range");
  }
  return ok();
}
function validateMoney(value) {
  const normalized = normalizeMoney(value);
  if (!normalized) return invalid("Invalid monetary amount");
  const number = Number(normalized);
  return number > 0 && number <= 100000000
    ? ok()
    : invalid("Amount is outside supported range");
}
function validateNpi(value) {
  const digits = normalizeDigits(value);
  if (!/^\d{10}$/.test(digits)) return invalid("NPI must contain 10 digits");
  const prefixed = `80840${digits.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < prefixed.length; i += 1) {
    let n = Number(prefixed[prefixed.length - 1 - i]);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === Number(digits[9]) ? ok() : invalid("NPI checksum failed");
}
function validateTin(value) {
  return /^\d{2}-?\d{7}$/.test(String(value ?? "").replace(/\s/g, ""))
    ? ok()
    : invalid("TIN must contain 9 digits");
}
function validateTaxonomy(value) {
  return /^[A-Z0-9]{10}$/i.test(normalizeIdentifier(value))
    ? ok()
    : invalid("Invalid taxonomy code");
}
function validateTypeOfBill(value) {
  return /^\d{3,4}$/.test(normalizeDigits(value)) ? ok() : invalid("Invalid Type of Bill");
}
function validateDrg(value) {
  return /^\d{3}$/.test(normalizeDigits(value)) ? ok() : invalid("Invalid DRG code");
}

function extractedValue(extracted, keys) {
  for (const key of keys) {
    const value = extracted?.[key];
    if (value == null || value === "") continue;
    return value;
  }
  return null;
}

function evidenceFor(rawText, value) {
  const text = String(rawText || "");
  const needle = String(value ?? "").trim();
  if (!text || !needle) return null;
  const index = text.toUpperCase().indexOf(needle.toUpperCase());
  if (index < 0) return null;
  const lineStart = Math.max(text.lastIndexOf("\n", index) + 1, 0);
  const nextNewline = text.indexOf("\n", index + needle.length);
  const lineEnd = nextNewline < 0 ? text.length : nextNewline;
  return text.slice(lineStart, lineEnd).replace(/\s+/g, " ").trim().slice(0, 300);
}

function providerEvidence(intel, fieldName) {
  const evidence = intel?.fieldEvidence?.[fieldName];
  return evidence && typeof evidence === "object" ? evidence : null;
}

function defaultSourceConfidence(intel) {
  const provider = String(intel?.ocrProvider || intel?.extractionSource || "").toUpperCase();
  if (provider === "PDF_PARSE") return 99;
  if (provider.includes("TEXTRACT")) return 92;
  if (provider.includes("E2E")) return 99;
  return 88;
}

export function documentAllowsField(documentType, fieldName) {
  const spec = FIELDS[fieldName];
  return Boolean(spec && spec.docs.includes(String(documentType || "OTHER")));
}

export function fieldSpec(fieldName) {
  return FIELDS[fieldName] || null;
}

export function buildFieldCandidates({
  claimId,
  documentId,
  documentType,
  extracted = {},
  intel = {},
  rawText = ""
}) {
  const candidates = [];

  for (const [fieldName, spec] of Object.entries(FIELDS)) {
    const rawValue = extractedValue(extracted, spec.extracted);
    if (rawValue == null || rawValue === "") continue;

    const normalized = spec.normalize(rawValue);
    const validation = spec.validate(rawValue);
    const allowed = documentAllowsField(documentType, fieldName);
    const structured = providerEvidence(intel, fieldName);
    const sourceConfidence = Math.max(
      0,
      Math.min(
        100,
        Number(structured?.confidence ?? defaultSourceConfidence(intel))
      )
    );

    const semanticConfidence = allowed
      ? validation.status === "VALID"
        ? Math.max(sourceConfidence, 95)
        : Math.min(sourceConfidence, 60)
      : 0;

    candidates.push({
      claimId,
      documentId,
      fieldName,
      normalizedKey:
        typeof normalized === "string" ? normalized.toUpperCase() : JSON.stringify(normalized),
      rawValue: Array.isArray(rawValue) ? JSON.stringify(rawValue) : String(rawValue),
      normalizedValue: normalized,
      evidenceText:
        structured?.evidenceText || evidenceFor(rawText, rawValue) || null,
      pageNumber: structured?.pageNumber || null,
      boundingBox: structured?.boundingBox || null,
      documentType: String(documentType || "OTHER"),
      sourceProvider: intel?.ocrProvider || intel?.extractionSource || null,
      sourceConfidence: Math.round(sourceConfidence),
      semanticConfidence: Math.round(semanticConfidence),
      validationStatus: allowed ? validation.status : "FORBIDDEN_SOURCE",
      validationMessage: allowed
        ? validation.message
        : `${documentType || "OTHER"} is not an approved source for ${fieldName}`,
      decision:
        !allowed || validation.status !== "VALID" ? "ABSTAINED" : "PENDING",
      decisionReason:
        !allowed
          ? "DOCUMENT_TYPE_NOT_ALLOWED"
          : validation.status !== "VALID"
          ? "VALIDATION_FAILED"
          : null,
      criticality: spec.criticality,
      engineVersion: EXTRACTION_ENGINE_VERSION
    });
  }

  return candidates;
}

function valueComparable(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value?.toFixed === "function") return value.toFixed(2);
  return String(value).trim().toUpperCase();
}

function claimFieldIsEmpty(claim, fieldName) {
  const value = claim?.[fieldName];
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  const text = String(value).trim().toLowerCase();
  return PLACEHOLDER_VALUES.has(text);
}

function toClaimValue(fieldName, normalizedValue) {
  if (["patientDob", "dateOfService", "admissionDate", "dischargeDate"].includes(fieldName)) {
    return parseClaimDate(normalizedValue);
  }
  if (["amount", "totalBilledAmount", "coverageLimit", "remainingCoverageLimit"].includes(fieldName)) {
    return Number(normalizedValue);
  }
  return normalizedValue;
}

function candidateScore(candidate) {
  return Math.round(
    Number(candidate.semanticConfidence || 0) * 0.55 +
      Number(candidate.sourceConfidence || 0) * 0.45
  );
}

export function safeInitialClaimSeed({
  documentType,
  extracted = {},
  intel = {},
  rawText = ""
}) {
  const candidates = buildFieldCandidates({
    claimId: "seed",
    documentId: "seed",
    documentType,
    extracted,
    intel,
    rawText
  });
  const patch = {};

  for (const candidate of candidates) {
    const spec = FIELDS[candidate.fieldName];
    if (!spec) continue;
    if (candidate.validationStatus !== "VALID") continue;
    if ((spec.consensusForAuto || 1) > 1) continue;
    if (candidateScore(candidate) < spec.threshold) continue;
    const value = toClaimValue(candidate.fieldName, candidate.normalizedValue);
    if (value != null && value !== "") patch[candidate.fieldName] = value;
  }

  return patch;
}

export async function persistAndReconcileFieldCandidates(
  prisma,
  {
    claim,
    document,
    extracted = {},
    intel = {},
    rawText = "",
    provenanceLabel = "Evidence-verified document extraction"
  }
) {
  const documentType = document.type || document.suggestedType || "OTHER";
  const built = buildFieldCandidates({
    claimId: claim.id,
    documentId: document.id,
    documentType,
    extracted,
    intel,
    rawText
  });

  for (const candidate of built) {
    await prisma.fieldCandidate.upsert({
      where: {
        documentId_fieldName_normalizedKey_engineVersion: {
          documentId: document.id,
          fieldName: candidate.fieldName,
          normalizedKey: candidate.normalizedKey,
          engineVersion: EXTRACTION_ENGINE_VERSION
        }
      },
      create: candidate,
      update: {
        rawValue: candidate.rawValue,
        normalizedValue: candidate.normalizedValue,
        evidenceText: candidate.evidenceText,
        pageNumber: candidate.pageNumber,
        boundingBox: candidate.boundingBox,
        sourceProvider: candidate.sourceProvider,
        sourceConfidence: candidate.sourceConfidence,
        semanticConfidence: candidate.semanticConfidence,
        validationStatus: candidate.validationStatus,
        validationMessage: candidate.validationMessage,
        criticality: candidate.criticality,
        decision:
          candidate.decision === "ABSTAINED" ? "ABSTAINED" : undefined,
        decisionReason:
          candidate.decision === "ABSTAINED" ? candidate.decisionReason : undefined
      }
    });
  }

  const all = await prisma.fieldCandidate.findMany({
    where: {
      claimId: claim.id,
      engineVersion: EXTRACTION_ENGINE_VERSION,
      validationStatus: "VALID"
    },
    orderBy: { createdAt: "asc" }
  });

  const fields = new Map();
  for (const item of all) {
    if (!fields.has(item.fieldName)) fields.set(item.fieldName, []);
    fields.get(item.fieldName).push(item);
  }

  const patch = {};
  let nextProvenance = claim.fieldProvenance || {};
  const decisions = [];

  for (const [fieldName, items] of fields.entries()) {
    const spec = FIELDS[fieldName];
    if (!spec) continue;

    const byValue = new Map();
    for (const item of items) {
      if (!byValue.has(item.normalizedKey)) byValue.set(item.normalizedKey, []);
      byValue.get(item.normalizedKey).push(item);
    }

    const ranked = [...byValue.entries()]
      .map(([key, group]) => ({
        key,
        group,
        distinctDocuments: new Set(group.map((item) => item.documentId)).size,
        bestScore: Math.max(...group.map(candidateScore))
      }))
      .sort(
        (a, b) =>
          b.distinctDocuments - a.distinctDocuments ||
          b.bestScore - a.bestScore
      );

    const winner = ranked[0];
    const conflicts = ranked.slice(1).reduce(
      (sum, item) => sum + item.distinctDocuments,
      0
    );
    if (!winner) continue;

    const representative = winner.group
      .slice()
      .sort((a, b) => candidateScore(b) - candidateScore(a))[0];
    const currentComparable = valueComparable(claim[fieldName]);
    const winnerComparable = valueComparable(representative.normalizedValue);
    const matchesCurrent =
      currentComparable != null && currentComparable === winnerComparable;

    const manualSource = claim?.fieldProvenance?.[fieldName]?.source === "USER";
    const neededConsensus = spec.consensusForAuto || 1;
    const meetsThreshold = winner.bestScore >= spec.threshold;
    const hasConsensus = winner.distinctDocuments >= neededConsensus;
    const noConflict = conflicts === 0;

    let decision = "CONFIRM";
    let reason = "HUMAN_CONFIRMATION_REQUIRED";

    if (matchesCurrent) {
      decision = "SUPPORTED";
      reason = "MATCHES_CURRENT_CLAIM";
    } else if (manualSource && !claimFieldIsEmpty(claim, fieldName)) {
      decision = "CONFIRM";
      reason = "MANUAL_VALUE_PROTECTED";
    } else if (meetsThreshold && hasConsensus && noConflict) {
      decision = "AUTO_FILLED";
      reason =
        winner.distinctDocuments > 1
          ? "CROSS_DOCUMENT_CONSENSUS"
          : "HIGH_CONFIDENCE_APPROVED_SOURCE";
    } else if (conflicts > 0) {
      decision = "CONFIRM";
      reason = "CONFLICTING_DOCUMENT_VALUES";
    } else if (!meetsThreshold) {
      decision = "CONFIRM";
      reason = "BELOW_AUTO_FILL_THRESHOLD";
    } else if (!hasConsensus) {
      decision = "CONFIRM";
      reason = "ADDITIONAL_CORROBORATION_REQUIRED";
    }

    const groupIds = winner.group.map((item) => item.id);
    await prisma.fieldCandidate.updateMany({
      where: { id: { in: groupIds } },
      data: {
        consensusCount: winner.distinctDocuments,
        conflictingCount: conflicts,
        decision,
        decisionReason: reason
      }
    });

    const losingIds = ranked
      .slice(1)
      .flatMap((entry) => entry.group.map((item) => item.id));
    if (losingIds.length) {
      await prisma.fieldCandidate.updateMany({
        where: { id: { in: losingIds }, decision: "PENDING" },
        data: {
          consensusCount: 1,
          conflictingCount: winner.distinctDocuments,
          decision: "CONFIRM",
          decisionReason: "CONFLICTING_DOCUMENT_VALUES"
        }
      });
    }

    if (decision === "AUTO_FILLED" && claimFieldIsEmpty(claim, fieldName)) {
      const claimValue = toClaimValue(fieldName, representative.normalizedValue);
      if (claimValue != null && claimValue !== "") {
        patch[fieldName] = claimValue;
        nextProvenance = mergeProvenance(nextProvenance, {
          [fieldName]: {
            source: "DOCUMENT_AI_V2",
            label: provenanceLabel,
            sourceDetail:
              winner.distinctDocuments > 1
                ? `Confirmed by ${winner.distinctDocuments} documents`
                : `${documentType} extraction passed validation`,
            confidence: winner.bestScore,
            verified: winner.distinctDocuments > 1,
            documentId: representative.documentId,
            updatedAt: new Date().toISOString()
          }
        });
      }
    }

    decisions.push({
      fieldName,
      value: representative.normalizedValue,
      decision,
      reason,
      score: winner.bestScore,
      consensusCount: winner.distinctDocuments,
      conflictingCount: conflicts
    });
  }

  return { patch, fieldProvenance: nextProvenance, decisions };
}

export function candidateClaimPatch(candidate) {
  const value = candidate?.normalizedValue;
  if (!candidate?.fieldName || value == null) return {};
  return {
    [candidate.fieldName]: toClaimValue(candidate.fieldName, value)
  };
}

export function summarizeExtractionQuality(candidates = []) {
  const total = candidates.length;
  const auto = candidates.filter((item) => item.decision === "AUTO_FILLED").length;
  const confirm = candidates.filter((item) => item.decision === "CONFIRM").length;
  const abstained = candidates.filter((item) => item.decision === "ABSTAINED").length;
  const supported = candidates.filter((item) => item.decision === "SUPPORTED").length;
  return {
    total,
    autoFilled: auto,
    confirmationRequired: confirm,
    abstained,
    supported,
    safeAutomationRate: total ? Math.round(((auto + supported) / total) * 100) : 0
  };
}
