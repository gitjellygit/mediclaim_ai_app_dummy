import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_APPEAL_WINDOW_DAYS,
  appealDeadlineState,
  computeAppealDeadline,
  interpretDenialCodes,
  lookupDenialCode,
  parseAppealWindowDays
} from "../src/services/denialCodes.js";

test("U8 - CARC/RARC lookup classifies common US denial codes", () => {
  const auth = lookupDenialCode("CARC", "197");
  assert.equal(auth.category, "AUTHORIZATION");
  assert.match(auth.recommendedAction, /authorization/i);

  const interpreted = interpretDenialCodes({ carcCode: "CARC 29", rarcCode: "N390" });
  assert.equal(interpreted.carc.code, "29");
  assert.equal(interpreted.category, "TIMELY_FILING");
  assert.equal(interpreted.rarc.category, "MISSING_INFORMATION");
});

test("U8 - unknown denial codes remain visible without inventing a meaning", () => {
  const unknown = lookupDenialCode("CARC", "9999");
  assert.equal(unknown.code, "9999");
  assert.equal(unknown.category, null);
  assert.match(unknown.label, /not in the local reference set/i);
});

test("U8 - appeal deadline uses the configured calendar-day window", () => {
  assert.equal(DEFAULT_APPEAL_WINDOW_DAYS, 180);
  const deadline = computeAppealDeadline("2026-10-02", 180);
  assert.equal(deadline.toISOString().slice(0, 10), "2027-03-31");
});

test("U8 - appeal window rejects unsafe values", () => {
  assert.equal(parseAppealWindowDays(undefined), 180);
  assert.throws(() => parseAppealWindowDays(0), (error) => error.status === 400);
  assert.throws(() => parseAppealWindowDays(731), (error) => error.status === 400);
});

test("U8 - deadline state distinguishes open, due-soon and overdue cases", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  assert.deepEqual(appealDeadlineState("2026-12-15", now), { state: "OPEN", daysRemaining: 74 });
  assert.deepEqual(appealDeadlineState("2026-10-20", now), { state: "DUE_SOON", daysRemaining: 18 });
  assert.deepEqual(appealDeadlineState("2026-10-01", now), { state: "OVERDUE", daysRemaining: -1 });
});
