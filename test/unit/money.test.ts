import assert from "node:assert/strict";
import test from "node:test";

import {
  addDecimal,
  averageDecimal,
  compareDecimal,
  percentDifference,
  subtractDecimal,
} from "../../src/domain/money.js";
import { median, percentile } from "../../src/analytics/statistics.js";

test("decimal operations remain deterministic for large and fractional values", () => {
  assert.equal(addDecimal("9007199254740992.25", "0.75"), "9007199254740993");
  assert.equal(subtractDecimal("10.00", "0.125"), "9.875");
  assert.equal(averageDecimal(["1", "2", "4"]), "2.33333333");
  assert.equal(percentDifference("8", "10"), "-0.2");
  assert.equal(compareDecimal("1.000", "1"), 0);
});

test("statistics use exact decimal ordering and bounded percentile selection", () => {
  assert.equal(median(["0.1", "0.2", "0.3", "0.4"]), "0.25");
  assert.equal(percentile(["1", "2", "3", "4"], 25), "1");
  assert.equal(percentile(["1", "2", "3", "4"], 75), "3");
});
