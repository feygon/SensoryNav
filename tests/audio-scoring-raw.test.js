// tests/audio-scoring-raw.test.js
"use strict";
const assert = require("assert");
const { roughnessScore, roughnessScoreRaw } = require("../recorder/audio-scoring");

const baseline = { effective_floor: { low: 1, mid: 1, high: 1 } };

// Energies equal to floor → zero residual → 0.
assert.strictEqual(roughnessScoreRaw({ low: 1, mid: 1, high: 1 }, baseline), 0);
assert.strictEqual(roughnessScore({ low: 1, mid: 1, high: 1 }, baseline), 0);

// A mid spike yields a continuous (non-integer) raw value, integer is its round.
const e = { low: 1, mid: 1.37, high: 1 };
const raw = roughnessScoreRaw(e, baseline);
assert.ok(raw > 0 && raw < 100, `raw=${raw}`);
assert.ok(!Number.isInteger(raw), `expected continuous, got ${raw}`);
assert.strictEqual(roughnessScore(e, baseline), Math.round(raw));

// Clamp at 100 for a huge residual.
assert.strictEqual(roughnessScoreRaw({ low: 1e6, mid: 1e6, high: 1e6 }, baseline), 100);
assert.strictEqual(roughnessScore({ low: 1e6, mid: 1e6, high: 1e6 }, baseline), 100);

console.log("audio-scoring-raw tests passed");
