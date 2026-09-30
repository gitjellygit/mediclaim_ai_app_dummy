import test from "node:test";
import assert from "node:assert/strict";
import { parseClaimDate } from "../src/utils/claimDate.js";

test("B9 - valid US and ISO claim dates parse to exact calendar day", () => {
  for (const value of ["09/30/2026", "2026-09-30", "2026-09-30T13:42:07.120Z", "2026-09-30T13:42+05:30"]) {
    assert.equal(parseClaimDate(value)?.toISOString().slice(0, 10), "2026-09-30", value);
  }
  assert.equal(parseClaimDate(null), null);
  assert.equal(parseClaimDate(""), null);
});

test("B9 - invalid calendar values and malformed timestamp suffixes are rejected", () => {
  for (const value of [
    "2026-02-29", "02/31/2026", "13/05/2026", "2026-00-10",
    "2026-09-30Tgarbage", "2026-09-30T25:00Z", "2026-09-30T12:61:00Z",
    "2026-09-30T12:30:65Z", "not a date"
  ]) {
    assert.equal(parseClaimDate(value), null, value);
  }
});
