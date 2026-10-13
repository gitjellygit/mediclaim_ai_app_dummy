
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFinalUatScenarios,
  finalUatLocalSafety
} from "../src/services/finalUatFixtures.js";

test("Final UAT safety allows only local test databases", () => {
  assert.equal(
    finalUatLocalSafety({
      E2E_TEST_MODE: "true",
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://app:app@localhost:5432/claim_ai?schema=public"
    }).ok,
    true
  );

  assert.equal(
    finalUatLocalSafety({
      E2E_TEST_MODE: "true",
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://app:app@prod-db.example.com:5432/claim_ai"
    }).ok,
    false
  );

  assert.equal(
    finalUatLocalSafety({
      E2E_TEST_MODE: "false",
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://app:app@localhost:5432/claim_ai"
    }).ok,
    false
  );
});

test("Final UAT generator creates 100 deterministic synthetic scenarios", () => {
  const fixture = buildFinalUatScenarios({
    organizationId: "org-test",
    createdById: "user-test",
    now: new Date("2026-10-13T12:00:00Z")
  });

  assert.equal(fixture.prefix, "UAT-FINAL-");
  assert.equal(fixture.scenarios.length, 100);
  assert.equal(fixture.categories.length, 10);

  for (const category of fixture.categories) {
    assert.equal(
      fixture.scenarios.filter((item) => item.category === category).length,
      10
    );
  }

  const names = new Set(
    fixture.scenarios.map((item) => item.createData.patientName)
  );
  assert.equal(names.size, 100);

  for (const scenario of fixture.scenarios) {
    assert.match(
      scenario.createData.patientName,
      /^UAT-FINAL-\d{3} [A-Za-z]+ [A-Za-z]+$/
    );
    assert.ok(scenario.createData.patientDob instanceof Date);
    assert.ok(Number.isInteger(scenario.createData.patientAge));
    assert.equal(
      scenario.createData.fieldProvenance.finalUat.synthetic,
      true
    );
  }

  assert.ok(
    fixture.scenarios.some(
      (item) => item.expected.payerStatus === "REJECTED"
    )
  );
  assert.ok(
    fixture.scenarios.some(
      (item) => item.expected.persistedStatus === "DENIED"
    )
  );
  assert.ok(
    fixture.scenarios.some(
      (item) => item.expected.persistedStatus === "PAID"
    )
  );
  assert.ok(
    fixture.scenarios.some(
      (item) => item.createData.underpaymentCase?.create
    )
  );
  assert.ok(
    fixture.scenarios.some(
      (item) => item.createData.denialCases?.create?.length
    )
  );
});
