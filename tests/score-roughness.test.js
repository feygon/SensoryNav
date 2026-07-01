// tests/score-roughness.test.js
"use strict";
const assert = require("assert");
const { scoreWindowRoughness } = require("../harness/score/roughness");

// A hand-built baseline: speed-conditioned low floor differs from global.
const baseline = {
  low:  { points: [{ speed: 5, floor: 1 }, { speed: 15, floor: 4 }], global: 1, meta: {} },
  mid:  { points: [{ speed: 5, floor: 1 }, { speed: 15, floor: 1 }], global: 1, meta: {} },
  high: { points: [{ speed: 5, floor: 1 }, { speed: 15, floor: 1 }], global: 1, meta: {} }
};
const win = { low_energy: 2, mid_energy: 1, high_energy: 1 };

// At 5 m/s, low floor = 1, so low residual = 2/1 - 1 = 1 → nonzero roughness.
const r5 = scoreWindowRoughness(win, 5, baseline, { DETECT_TAU: 12 });
assert.ok(r5.roughness_raw > 0);
assert.strictEqual(r5.roughness, Math.round(r5.roughness_raw));
assert.strictEqual(r5.magnitude, r5.roughness_raw);

// At 15 m/s, low floor = 4, so 2 < 4 → residual 0 → roughness 0.
const r15 = scoreWindowRoughness(win, 15, baseline, { DETECT_TAU: 12 });
assert.strictEqual(r15.roughness_raw, 0);
assert.strictEqual(r15.detected, false);

// useNullFloor uses global (1) regardless of speed → nonzero at 15.
const rNull = scoreWindowRoughness(win, 15, baseline, { DETECT_TAU: 12, useNullFloor: true });
assert.ok(rNull.roughness_raw > 0);

// detection threshold honored.
const big = { low_energy: 100, mid_energy: 100, high_energy: 100 };
assert.strictEqual(scoreWindowRoughness(big, 5, baseline, { DETECT_TAU: 12 }).detected, true);

console.log("score-roughness tests passed");
