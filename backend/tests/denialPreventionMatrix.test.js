import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateUsReadinessRules,
  US_READINESS_RULE_DEFAULTS
} from "../src/services/usReadinessRules.js";

function cleanClaim(index) {
  const day = String((index % 20) + 1).padStart(2, "0");
  const dos = new Date(`2026-10-${day}T00:00:00.000Z`);
  return {
    billingProviderNpi: "1234567890",
    renderingProviderNpi: "1987654321",
    referringProviderNpi: null,
    memberId: `MEM-${index}`,
    icd10Codes: ["M54.50"],
    timelyFilingDeadline: new Date("2026-12-31T00:00:00.000Z"),
    priorAuthRequired: false,
    priorAuthStatus: "NOT_REQUIRED",
    authorizationNo: null,
    dateOfService: dos,
    policyStartDate: new Date("2026-01-01T00:00:00.000Z"),
    policyEndDate: new Date("2026-12-31T00:00:00.000Z"),
    coordinationOfBenefits: "PRIMARY",
    serviceLines: [{
      cptHcpcsCode: "99213",
      diagnosisPointers: ["M54.50"],
      serviceDateFrom: dos,
      serviceDateTo: dos,
      verified: true
    }]
  };
}

const defectFamilies = [
  {
    name: "missing member",
    rule: "US_MEMBER_ID",
    mutate: (claim) => ({ ...claim, memberId: null })
  },
  {
    name: "expired filing",
    rule: "US_TIMELY_FILING",
    mutate: (claim) => ({ ...claim, timelyFilingDeadline: new Date("2026-09-01T00:00:00.000Z") })
  },
  {
    name: "coverage outside DOS",
    rule: "US_COVERAGE_DOS",
    mutate: (claim) => ({ ...claim, policyEndDate: new Date("2026-09-30T00:00:00.000Z") })
  },
  {
    name: "service date mismatch",
    rule: "US_SERVICE_DATE_CONSISTENCY",
    mutate: (claim) => ({
      ...claim,
      serviceLines: [{
        ...claim.serviceLines[0],
        serviceDateFrom: new Date("2026-11-01T00:00:00.000Z"),
        serviceDateTo: new Date("2026-11-01T00:00:00.000Z")
      }]
    })
  },
  {
    name: "missing required auth",
    rule: "US_PRIOR_AUTH",
    mutate: (claim) => ({
      ...claim,
      priorAuthRequired: true,
      priorAuthStatus: "REQUIRED",
      authorizationNo: null
    })
  },
  {
    name: "invalid diagnosis link",
    rule: "US_DIAGNOSIS_CPT_LINK",
    mutate: (claim) => ({
      ...claim,
      serviceLines: [{ ...claim.serviceLines[0], diagnosisPointers: ["J18.9"] }]
    })
  }
];

test("Denial prevention matrix catches 120 deliberately planted supported defects", () => {
  let tested = 0;
  for (let familyIndex = 0; familyIndex < defectFamilies.length; familyIndex += 1) {
    const family = defectFamilies[familyIndex];
    for (let i = 0; i < 20; i += 1) {
      const source = cleanClaim(familyIndex * 20 + i + 1);
      const issues = evaluateUsReadinessRules(
        family.mutate(source),
        US_READINESS_RULE_DEFAULTS,
        { now: new Date("2026-10-21T12:00:00.000Z") }
      );
      assert.ok(
        issues.some((issue) => issue.rule === family.rule && issue.severity === "BLOCK"),
        `${family.name} scenario ${i + 1} was not blocked`
      );
      tested += 1;
    }
  }
  assert.equal(tested, 120);
});

test("Denial prevention matrix clean controls do not trigger supported blockers", () => {
  for (let i = 1; i <= 20; i += 1) {
    const issues = evaluateUsReadinessRules(
      cleanClaim(i),
      US_READINESS_RULE_DEFAULTS,
      { now: new Date("2026-10-21T12:00:00.000Z") }
    );
    assert.deepEqual(
      issues.filter((issue) =>
        [
          "US_MEMBER_ID",
          "US_TIMELY_FILING",
          "US_COVERAGE_DOS",
          "US_SERVICE_DATE_CONSISTENCY",
          "US_PRIOR_AUTH",
          "US_DIAGNOSIS_CPT_LINK"
        ].includes(issue.rule)
      ),
      []
    );
  }
});
