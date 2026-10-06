import { mergeProvenance, systemProvenance } from "./claimFieldProvenance.js";

function uniqueCodes(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean)
  )];
}

function evidenceSnippet(rawText, code) {
  const text = String(rawText || "");
  if (!text || !code) return null;
  const index = text.toUpperCase().indexOf(String(code).toUpperCase());
  if (index < 0) return null;
  const start = Math.max(0, index - 90);
  const end = Math.min(text.length, index + String(code).length + 90);
  return text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 300) || null;
}

export function buildDocumentCodingSuggestions({
  extracted = {},
  rawText = "",
  confidence = null
} = {}) {
  const items = [];

  for (const code of uniqueCodes(extracted.icd10Codes)) {
    items.push({
      system: "ICD10_CM",
      suggestedCode: code,
      confidence: Number.isInteger(confidence) ? confidence : null,
      evidenceText: evidenceSnippet(rawText, code)
    });
  }

  for (const code of uniqueCodes(extracted.cptCodes)) {
    items.push({
      system: /^[A-Z]\d{4}$/.test(code) ? "HCPCS" : "CPT",
      suggestedCode: code,
      confidence: Number.isInteger(confidence) ? confidence : null,
      evidenceText: evidenceSnippet(rawText, code)
    });
  }

  for (const code of uniqueCodes(extracted.icd10PcsCodes)) {
    items.push({
      system: "ICD10_PCS",
      suggestedCode: code,
      confidence: Number.isInteger(confidence) ? confidence : null,
      evidenceText: evidenceSnippet(rawText, code)
    });
  }

  return items;
}

export async function syncDocumentCodingSuggestions(
  prismaClient,
  {
    claimId,
    documentId,
    extracted = {},
    rawText = "",
    confidence = null
  }
) {
  const candidates = buildDocumentCodingSuggestions({
    extracted,
    rawText,
    confidence
  });

  const existing = await prismaClient.codingSuggestion.findMany({
    where: { documentId },
    select: {
      id: true,
      system: true,
      suggestedCode: true,
      status: true,
      finalCode: true,
      reviewedAt: true,
      reviewedById: true
    }
  });

  const acceptedOnClaim = await prismaClient.codingSuggestion.findMany({
    where: {
      claimId,
      status: "ACCEPTED"
    },
    select: {
      system: true,
      suggestedCode: true,
      finalCode: true,
      reviewedAt: true,
      reviewedById: true
    }
  });
  const acceptedByKey = new Map(
    acceptedOnClaim
      .filter((item) => item.finalCode === item.suggestedCode)
      .map((item) => [`${item.system}:${item.suggestedCode}`, item])
  );

  // If an identical code was already accepted elsewhere on this claim, a
  // pending duplicate does not need another human decision.
  for (const item of existing) {
    const key = `${item.system}:${item.suggestedCode}`;
    const accepted = acceptedByKey.get(key);
    if (item.status === "PENDING" && accepted) {
      await prismaClient.codingSuggestion.update({
        where: { id: item.id },
        data: {
          status: "ACCEPTED",
          finalCode: item.suggestedCode,
          reviewedAt: accepted.reviewedAt || new Date(),
          reviewedById: accepted.reviewedById || null
        }
      });
      item.status = "ACCEPTED";
      item.finalCode = item.suggestedCode;
    }
  }

  const desiredKeys = new Set(
    candidates.map((item) => `${item.system}:${item.suggestedCode}`)
  );
  const existingKeys = new Set(
    existing.map((item) => `${item.system}:${item.suggestedCode}`)
  );

  const obsoletePendingIds = existing
    .filter(
      (item) =>
        item.status === "PENDING" &&
        !desiredKeys.has(`${item.system}:${item.suggestedCode}`)
    )
    .map((item) => item.id);

  if (obsoletePendingIds.length > 0) {
    await prismaClient.codingSuggestion.deleteMany({
      where: { id: { in: obsoletePendingIds } }
    });
  }

  for (const candidate of candidates) {
    const key = `${candidate.system}:${candidate.suggestedCode}`;
    if (existingKeys.has(key)) continue;
    const accepted = acceptedByKey.get(key);
    await prismaClient.codingSuggestion.create({
      data: {
        claimId,
        documentId,
        ...candidate,
        ...(accepted
          ? {
              status: "ACCEPTED",
              finalCode: candidate.suggestedCode,
              reviewedAt: accepted.reviewedAt || new Date(),
              reviewedById: accepted.reviewedById || null
            }
          : {})
      }
    });
  }

  return prismaClient.codingSuggestion.findMany({
    where: { documentId },
    orderBy: { createdAt: "asc" }
  });
}

export function validateCodingCode(system, value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code) return { code: "", error: "Code is required" };

  if (system === "ICD10_CM" && !/^[A-Z]\d{2}(?:\.[A-Z0-9]{1,4})?$/.test(code)) {
    return { code, error: "Enter a valid ICD-10-CM code" };
  }
  if (system === "ICD10_PCS" && !/^[A-Z0-9]{7}$/.test(code)) {
    return { code, error: "Enter a valid 7-character ICD-10-PCS code" };
  }
  if (system === "CPT" && !/^\d{5}$/.test(code)) {
    return { code, error: "Enter a valid 5-digit CPT code" };
  }
  if (system === "HCPCS" && !/^[A-Z]\d{4}$/.test(code)) {
    return { code, error: "Enter a valid HCPCS code" };
  }

  return { code, error: null };
}

export async function applyCodingSuggestionToClaim(
  prismaClient,
  suggestion,
  finalCode
) {
  if (suggestion.system === "ICD10_CM") {
    const claim = await prismaClient.claim.findUnique({
      where: { id: suggestion.claimId },
      select: { icd10Codes: true, fieldProvenance: true, documentDerivedFields: true }
    });
    const codes = uniqueCodes([...(claim?.icd10Codes || []), finalCode]);
    await prismaClient.claim.update({
      where: { id: suggestion.claimId },
      data: {
        icd10Codes: codes,
        documentDerivedFields: (claim?.documentDerivedFields || []).filter(
          (field) => field !== "icd10Codes"
        ),
        fieldProvenance: mergeProvenance(
          claim?.fieldProvenance,
          systemProvenance(["icd10Codes"], {
            source: "DOCUMENT_CODING_REVIEW",
            label: "Human-verified document coding",
            sourceDetail: "Accepted or changed from a document coding suggestion",
            verified: true
          })
        )
      }
    });
    return;
  }

  if (suggestion.system === "ICD10_PCS") {
    const claim = await prismaClient.claim.findUnique({
      where: { id: suggestion.claimId },
      select: { inpatientProcedureCodes: true, fieldProvenance: true }
    });
    const codes = uniqueCodes([
      ...(claim?.inpatientProcedureCodes || []),
      finalCode
    ]);
    await prismaClient.claim.update({
      where: { id: suggestion.claimId },
      data: {
        inpatientProcedureCodes: codes,
        fieldProvenance: mergeProvenance(
          claim?.fieldProvenance,
          systemProvenance(["inpatientProcedureCodes"], {
            source: "DOCUMENT_CODING_REVIEW",
            label: "Human-verified document coding",
            sourceDetail: "Accepted or changed from a document coding suggestion",
            verified: true
          })
        )
      }
    });
    return;
  }

  const existing = await prismaClient.serviceLine.findFirst({
    where: {
      claimId: suggestion.claimId,
      sourceDocumentId: suggestion.documentId,
      cptHcpcsCode: suggestion.suggestedCode
    }
  });

  if (existing) {
    await prismaClient.serviceLine.update({
      where: { id: existing.id },
      data: {
        cptHcpcsCode: finalCode,
        verified: true,
        source: "DOCUMENT_CODING_REVIEW"
      }
    });
    return;
  }

  await prismaClient.serviceLine.create({
    data: {
      claimId: suggestion.claimId,
      cptHcpcsCode: finalCode,
      units: 1,
      verified: true,
      source: "DOCUMENT_CODING_REVIEW",
      sourceDocumentId: suggestion.documentId
    }
  });
}
