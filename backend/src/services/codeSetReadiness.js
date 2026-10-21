const SYSTEM_MAP = Object.freeze({
  ICD10_CM: "ICD10_CM",
  ICD10_PCS: "ICD10_PCS",
  CPT_HCPCS: "CPT_HCPCS"
});

function isoDateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

async function authoritativeRelease(prisma, system, dos) {
  if (!dos) return null;
  return prisma.codeSetRelease.findFirst({
    where: {
      system,
      authoritative: true,
      effectiveFrom: { lte: dos },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: dos } }]
    },
    orderBy: { effectiveFrom: "desc" }
  });
}

async function validateCodes(prisma, system, codes, dos, { field, fixTarget }) {
  const release = await authoritativeRelease(prisma, system, dos);
  if (!release) return [];

  const normalized = [...new Set((codes || []).map(normalizeCode).filter(Boolean))];
  if (!normalized.length) return [];

  const definitions = await prisma.codeDefinition.findMany({
    where: { releaseId: release.id, code: { in: normalized } }
  });
  const byCode = new Map(definitions.map((item) => [normalizeCode(item.code), item]));
  const dosIso = isoDateOnly(dos);
  const issues = [];

  for (const code of normalized) {
    const definition = byCode.get(code);
    if (!definition) {
      issues.push({
        rule: "US_CODESET_ACTIVE",
        severity: "BLOCK",
        source: "AUTHORITATIVE_CODE_SET",
        system,
        code,
        releaseVersion: release.version,
        message: `${system} code ${code} is not present in the authoritative ${release.version} release for the date of service`,
        field,
        fixTarget
      });
      continue;
    }

    const activeFrom = isoDateOnly(definition.activeFrom);
    const activeTo = isoDateOnly(definition.activeTo);
    const outsideWindow =
      (activeFrom && dosIso && dosIso < activeFrom) ||
      (activeTo && dosIso && dosIso > activeTo);

    if (outsideWindow) {
      issues.push({
        rule: "US_CODESET_ACTIVE",
        severity: "BLOCK",
        source: "AUTHORITATIVE_CODE_SET",
        system,
        code,
        releaseVersion: release.version,
        message: `${system} code ${code} is not active for the date of service`,
        field,
        fixTarget
      });
    } else if (definition.billable === false) {
      issues.push({
        rule: "US_CODESET_BILLABLE",
        severity: "BLOCK",
        source: "AUTHORITATIVE_CODE_SET",
        system,
        code,
        releaseVersion: release.version,
        message: `${system} code ${code} is not billable in the authoritative ${release.version} release`,
        field,
        fixTarget
      });
    }
  }

  return issues;
}

export async function evaluateCodeSetReadiness(prisma, claim) {
  const dos = claim.dateOfService || claim.admissionDate || claim.procedureDate;
  if (!dos) return [];

  const serviceCodes = (claim.serviceLines || [])
    .filter((line) => line.verified !== false)
    .map((line) => line.cptHcpcsCode)
    .filter(Boolean);

  return [
    ...(await validateCodes(prisma, SYSTEM_MAP.ICD10_CM, claim.icd10Codes, dos, {
      field: "icd10Codes",
      fixTarget: "claim"
    })),
    ...(await validateCodes(prisma, SYSTEM_MAP.ICD10_PCS, claim.inpatientProcedureCodes, dos, {
      field: "inpatientProcedureCodes",
      fixTarget: "claim"
    })),
    ...(await validateCodes(prisma, SYSTEM_MAP.CPT_HCPCS, serviceCodes, dos, {
      field: "cptHcpcsCode",
      fixTarget: "serviceLines"
    }))
  ];
}
