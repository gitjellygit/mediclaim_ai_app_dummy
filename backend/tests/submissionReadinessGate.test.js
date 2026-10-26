import test from "node:test";
import assert from "node:assert/strict";
import { liveMandatorySubmissionBlockers } from "../src/services/submissionReadinessGate.js";

function validClaim(overrides = {}) {
  return {
    billingProviderNpi: "1234567890",
    renderingProviderNpi: "1234567890",
    memberId: "MEM-100",
    policyStartDate: new Date("2026-01-01T00:00:00.000Z"),
    policyEndDate: new Date("2026-12-31T00:00:00.000Z"),
    dateOfService: new Date("2026-10-01T00:00:00.000Z"),
    timelyFilingDeadline: new Date("2027-01-01T00:00:00.000Z"),
    priorAuthRequired: false,
    priorAuthStatus: "NOT_REQUIRED",
    coordinationOfBenefits: "PRIMARY",
    payerConnectionMode: "SIMULATED",
    claimForm: "PROFESSIONAL",
    icd10Codes: ["Z00.00"],
    serviceLines: [
      {
        cptHcpcsCode: "99213",
        diagnosisPointers: ["Z00.00"],
        serviceDateFrom: new Date("2026-10-01T00:00:00.000Z"),
        serviceDateTo: new Date("2026-10-01T00:00:00.000Z"),
        verified: true,
        placeOfService: "11"
      }
    ],
    ...overrides
  };
}

test("live submit gate blocks date of service before policy coverage", () => {
  const blockers = liveMandatorySubmissionBlockers(
    validClaim({ dateOfService: new Date("2025-12-31T00:00:00.000Z") })
  );
  const coverage = blockers.find((issue) => issue.rule === "US_COVERAGE_DOS");
  assert.ok(coverage);
  assert.equal(coverage.severity, "BLOCK");
});

test("live submit gate blocks date of service after policy coverage", () => {
  const blockers = liveMandatorySubmissionBlockers(
    validClaim({ dateOfService: new Date("2027-01-01T00:00:00.000Z") })
  );
  assert.ok(blockers.some((issue) => issue.rule === "US_COVERAGE_DOS"));
});

test("live submit gate allows date of service on policy start date", () => {
  const blockers = liveMandatorySubmissionBlockers(
    validClaim({ dateOfService: new Date("2026-01-01T00:00:00.000Z") })
  );
  assert.equal(blockers.some((issue) => issue.rule === "US_COVERAGE_DOS"), false);
});

test("live submit gate allows date of service on policy end date", () => {
  const blockers = liveMandatorySubmissionBlockers(
    validClaim({ dateOfService: new Date("2026-12-31T00:00:00.000Z") })
  );
  assert.equal(blockers.some((issue) => issue.rule === "US_COVERAGE_DOS"), false);
});

test("live submit gate blocks claim date outside verified service-line range", () => {
  const blockers = liveMandatorySubmissionBlockers(
    validClaim({ dateOfService: new Date("2026-10-02T00:00:00.000Z") })
  );
  assert.ok(blockers.some((issue) => issue.rule === "US_SERVICE_DATE_CONSISTENCY"));
});

test("live submit gate ignores unverified service-line date for consistency blocker", () => {
  const blockers = liveMandatorySubmissionBlockers(
    validClaim({
      dateOfService: new Date("2026-10-02T00:00:00.000Z"),
      serviceLines: [{
        cptHcpcsCode: "99213",
        diagnosisPointers: ["Z00.00"],
        serviceDateFrom: new Date("2026-10-01T00:00:00.000Z"),
        serviceDateTo: new Date("2026-10-01T00:00:00.000Z"),
        verified: false,
        placeOfService: "11"
      }]
    })
  );
  assert.equal(blockers.some((issue) => issue.rule === "US_SERVICE_DATE_CONSISTENCY"), false);
});

test("coverage rule stays mandatory even if configured lower", () => {
  const blockers = liveMandatorySubmissionBlockers(
    validClaim({ dateOfService: new Date("2027-01-01T00:00:00.000Z") }),
    [{ code: "US_COVERAGE_DOS", enabled: false, severity: "INFO" }]
  );
  const coverage = blockers.find((issue) => issue.rule === "US_COVERAGE_DOS");
  assert.ok(coverage);
  assert.equal(coverage.severity, "BLOCK");
});
