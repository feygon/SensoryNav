// tests/score-baseline.test.js
"use strict";
const assert = require("assert");
const { fitBaseline, floorAt, globalFloorAt, baselineMeta } = require("../harness/score/baseline");

// Build samples across two speed ranges, low band cleanly separable.
// 25 samples near 5 m/s with low≈1..2 (floor ~1), 25 near 15 m/s with low≈3..4 (floor ~3).
function mk(speed, low) { return { speed, low, mid: low, high: low, reliability: 1 }; }
const samples = [];
for (let i = 0; i < 25; i++) samples.push(mk(5, 1 + i * 0.04));   // 1.00..1.96
for (let i = 0; i < 25; i++) samples.push(mk(15, 3 + i * 0.04));  // 3.00..3.96
const b = fitBaseline(samples, { MIN_BIN_SAMPLES: 20 });

// Two bins qualified; meta reflects it.
assert.strictEqual(baselineMeta(b).low.qualified_bins, 2);
assert.strictEqual(baselineMeta(b).low.fell_back_to_global, false);
// floorAt near 5 ≈ ~1 (10th pct of 1.00..1.96), near 15 ≈ ~3.
assert.ok(floorAt(b, "low", 5) < 1.5, `floor@5=${floorAt(b, "low", 5)}`);
assert.ok(floorAt(b, "low", 15) > 2.5, `floor@15=${floorAt(b, "low", 15)}`);
// interpolation between bin centers gives an intermediate floor at 10 m/s.
const f10 = floorAt(b, "low", 10);
assert.ok(f10 > floorAt(b, "low", 5) && f10 < floorAt(b, "low", 15), `f10=${f10}`);
// clamp beyond the ends.
assert.strictEqual(floorAt(b, "low", 0), floorAt(b, "low", 5));
assert.strictEqual(floorAt(b, "low", 99), floorAt(b, "low", 15));
// global null floor exists and is the low quantile across all.
assert.ok(globalFloorAt(b, "low") <= floorAt(b, "low", 15));

// Sparse: too few samples → 0 qualifying bins → global fallback.
const sparse = []; for (let i = 0; i < 5; i++) sparse.push(mk(7, 2 + i * 0.1));
const bs = fitBaseline(sparse, { MIN_BIN_SAMPLES: 20 });
assert.strictEqual(baselineMeta(bs).low.qualified_bins, 0);
assert.strictEqual(baselineMeta(bs).low.fell_back_to_global, true);
assert.strictEqual(floorAt(bs, "low", 7), globalFloorAt(bs, "low"));

// EPS_FLOOR clamp: all-zero energy → floor clamped up to EPS_FLOOR.
const zeros = []; for (let i = 0; i < 25; i++) zeros.push(mk(5, 0));
const bz = fitBaseline(zeros, { MIN_BIN_SAMPLES: 20 });
assert.strictEqual(globalFloorAt(bz, "low"), 1e-6);

// No reliable samples → throw.
assert.throws(() => fitBaseline([{ speed: 5, low: 1, mid: 1, high: 1, reliability: 0 }], {}), /no reliable samples/);

console.log("score-baseline tests passed");
