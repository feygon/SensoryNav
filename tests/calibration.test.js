const assert = require("assert");
const { computeBaseline, median } = require("../recorder/calibration");

assert.strictEqual(median([3, 1, 2]), 2);            // odd
assert.strictEqual(median([1, 2, 3, 4]), 2.5);       // even -> mean of middle two
assert.strictEqual(median([]), 0);                   // empty guard

const baseline = computeBaseline([
  { low: 10, mid: 20, high: 30 },
  { low: 30, mid: 40, high: 50 }
]);
assert.strictEqual(baseline.low_median, 20);
assert.strictEqual(baseline.mid_median, 30);
assert.strictEqual(baseline.high_median, 40);
assert.strictEqual(baseline.effective_floor.low, 20); // median > floor

// A silent baseline floors to ENERGY_FLOOR_MIN so it can never be a zero denominator.
const silent = computeBaseline([
  { low: 0, mid: 0, high: 0 },
  { low: 0, mid: 0, high: 0 }
]);
assert.strictEqual(silent.low_median, 0);
assert.strictEqual(silent.effective_floor.low, 1e-6);
assert.strictEqual(silent.effective_floor.mid, 1e-6);
assert.strictEqual(silent.effective_floor.high, 1e-6);

console.log("calibration tests passed");
