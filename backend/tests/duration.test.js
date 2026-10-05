import test from "node:test";
import assert from "node:assert/strict";
import { durationToMs } from "../src/utils/duration.js";

test("P5 - token duration parser honors days, hours, minutes and seconds", () => {
  assert.equal(durationToMs("7d", 1), 7 * 24 * 60 * 60 * 1000);
  assert.equal(durationToMs("12h", 1), 12 * 60 * 60 * 1000);
  assert.equal(durationToMs("15m", 1), 15 * 60 * 1000);
  assert.equal(durationToMs("30s", 1), 30 * 1000);
});

test("P5 - bare numeric duration follows jsonwebtoken seconds semantics", () => {
  assert.equal(durationToMs("3600", 1), 3600 * 1000);
});

test("P5 - invalid duration falls back safely", () => {
  assert.equal(durationToMs("nonsense", 12345), 12345);
  assert.equal(durationToMs("0d", 12345), 12345);
});
