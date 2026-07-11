"use strict";

const assert = require("assert");
const { CONSTANTS } = require("../recorder/constants");

assert.strictEqual(CONSTANTS.FFT_SIZE, 2048);
assert.strictEqual(CONSTANTS.SMOOTHING_TIME_CONSTANT, 0);
assert.strictEqual(CONSTANTS.ASSUMED_SAMPLE_RATE_HZ, 48000);
assert.strictEqual(CONSTANTS.WINDOW_DURATION_MS, 1000);
assert.strictEqual(CONSTANTS.ENERGY_FLOOR_MIN, 1e-6);
assert.strictEqual(CONSTANTS.PAIR_MAX_SKEW_SECONDS, 5);
assert.deepStrictEqual(CONSTANTS.WEIGHTS, { low: 0.6, mid: 0.3, high: 0.1 });
assert.deepStrictEqual(CONSTANTS.BANDS, {
  low: [80, 250],
  mid: [250, 1000],
  high: [1000, 4000]
});
assert.throws(() => { CONSTANTS.FFT_SIZE = 1; }, TypeError);

console.log("constants tests passed");
