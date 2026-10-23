import assert from "node:assert/strict";
import { test } from "node:test";
import { capitalize, formatDuration, formatInteger, formatNumber, mw, percent, plural } from "../src/format.ts";

test("numbers in the game's format (English)", () => {
  assert.equal(formatNumber(1234.56), "1,234.6");
  assert.equal(formatInteger(1234567.8), "1,234,568");
  assert.equal(mw(6750), "6,750 MW");
  assert.equal(percent(50.44), "50.4%");
});

test("plural and capitals", () => {
  assert.equal(plural(0, "machine"), "0 machines");
  assert.equal(plural(1, "machine"), "1 machine");
  assert.equal(plural(2, "switch", "switches"), "2 switches");
  assert.equal(capitalize("iron plate"), "Iron plate");
});

test("durations: minutes, then hours, then days", () => {
  assert.equal(formatDuration(45), "45 min");
  assert.equal(formatDuration(125), "2h 05m");
  assert.equal(formatDuration(3000), "2d 2h");
});
