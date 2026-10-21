import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCodeSetReadiness } from "../src/services/codeSetReadiness.js";

function mockPrisma({ releases = {}, definitions = {} } = {}) {
  return {
    codeSetRelease: {
      findFirst: async ({ where }) => releases[where.system] || null
    },
    codeDefinition: {
      findMany: async ({ where }) =>
        (definitions[where.releaseId] || []).filter((item) =>
          where.code.in.includes(item.code)
        )
    }
  };
}

function claim(overrides = {}) {
  return {
    dateOfService: new Date("2026-10-02T00:00:00.000Z"),
    icd10Codes: ["M54.50"],
    inpatientProcedureCodes: [],
    serviceLines: [{ cptHcpcsCode: "99213", verified: true }],
    ...overrides
  };
}

test("Code-set readiness is fail-open when no authoritative release is loaded", async () => {
  const issues = await evaluateCodeSetReadiness(mockPrisma(), claim());
  assert.deepEqual(issues, []);
});

test("Authoritative code-set release blocks unknown and nonbillable codes", async () => {
  const releaseIcd = { id: "icd-r1", version: "FY2026" };
  const releaseCpt = { id: "cpt-r1", version: "2026" };
  const prisma = mockPrisma({
    releases: {
      ICD10_CM: releaseIcd,
      CPT_HCPCS: releaseCpt
    },
    definitions: {
      "icd-r1": [{ code: "M54.50", billable: false, activeFrom: null, activeTo: null }],
      "cpt-r1": []
    }
  });

  const issues = await evaluateCodeSetReadiness(prisma, claim());
  assert.ok(issues.some((item) => item.rule === "US_CODESET_BILLABLE" && item.code === "M54.50"));
  assert.ok(issues.some((item) => item.rule === "US_CODESET_ACTIVE" && item.code === "99213"));
});

test("Authoritative code-set release enforces code effective dates", async () => {
  const release = { id: "icd-r1", version: "FY2026" };
  const prisma = mockPrisma({
    releases: { ICD10_CM: release },
    definitions: {
      "icd-r1": [{
        code: "M54.50",
        billable: true,
        activeFrom: new Date("2026-10-03T00:00:00.000Z"),
        activeTo: null
      }]
    }
  });

  const issues = await evaluateCodeSetReadiness(
    prisma,
    claim({ serviceLines: [] })
  );
  assert.ok(issues.some((item) => item.rule === "US_CODESET_ACTIVE"));
});
