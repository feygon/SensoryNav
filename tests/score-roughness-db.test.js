"use strict";
const assert = require("assert");
const { toDb, bandDeltaDb, roughnessDb } = require("../harness/score/roughness-db");
const close = (a, b, t = 1e-9) => Math.abs(a - b) < t;

// toDb: power ratios -> decibels. 1->0, 10->+10, 0.1->-10, 0 clamps very negative.
assert.ok(close(toDb(1), 0));
assert.ok(close(toDb(10), 10));
assert.ok(close(toDb(0.1), -10));
assert.ok(toDb(0) < -100, "zero energy clamps to a very low dB, not -Infinity");

// bandDeltaDb: excess over the floor in dB, clamped at 0 (at/below floor = smooth, never negative).
assert.ok(close(bandDeltaDb(5, 5), 0), "energy at floor -> 0 dB");
assert.ok(close(bandDeltaDb(50, 5), 10), "10x floor -> +10 dB");
assert.ok(close(bandDeltaDb(1, 5), 0), "below floor -> clamped to 0, not negative");

// roughnessDb: weighted sum of per-band deltas.
const w = { low: 0.6, mid: 0.3, high: 0.1 };
const unitFloor = { low: 1, mid: 1, high: 1 };
assert.ok(close(roughnessDb({ low: 10, mid: 1, high: 1 }, unitFloor, w), 0.6 * 10), "only low band +10 dB");
assert.ok(close(roughnessDb({ low: 1, mid: 1, high: 1 }, unitFloor, w), 0), "all bands at floor -> 0");
assert.ok(close(roughnessDb({ low: 1, mid: 10, high: 100 }, unitFloor, w), 0.3 * 10 + 0.1 * 20), "mid +10, high +20");

// ARCHITECTURE CONTRACT: the baseline (road+car+conditions noise per speed) is a PER-RUN input
// and is NEVER aggregated; only the delta over it is comparable across runs. So identical energy
// yields a SMALLER delta against a louder run's own floor, and zero delta against its own floor.
const energy = { low: 10, mid: 10, high: 10 };
const quietRun = { low: 1, mid: 1, high: 1 };      // quiet baseline (smooth road / quiet car)
const loudRun = { low: 10, mid: 10, high: 10 };     // inherently louder run (coarse road / loud car)
assert.ok(roughnessDb(energy, quietRun, w) > roughnessDb(energy, loudRun, w),
  "same energy is rougher relative to a quieter run's own baseline");
assert.ok(close(roughnessDb(energy, loudRun, w), 0),
  "energy equal to a run's own floor is smooth FOR THAT RUN (delta 0) — baseline cancels, only delta remains");

console.log("score-roughness-db tests passed");
