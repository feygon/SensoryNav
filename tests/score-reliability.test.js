// tests/score-reliability.test.js
"use strict";
const assert = require("assert");
const { windowReliability } = require("../harness/score/reliability");
const close = (a, b, t = 1e-9) => Math.abs(a - b) < t;

const goodSp1 = { clip_fraction: 0, frame_count: 45, near_floor: false };
const goodSp2 = { speed_confidence: 1, flags: [] };

// Perfect window → reliability 1, no flags.
let r = windowReliability(goodSp1, goodSp2, {});
assert.ok(close(r.reliability, 1));
assert.deepStrictEqual(r.flags, []);

// near_floor hard-zeros and flags.
r = windowReliability({ ...goodSp1, near_floor: true }, goodSp2, {});
assert.strictEqual(r.reliability, 0);
assert.ok(r.flags.includes("near_floor"));

// 2% clip → clipFactor 0 (CLIP_TOL 0.02) → reliability 0, "clipped".
r = windowReliability({ ...goodSp1, clip_fraction: 0.02 }, goodSp2, {});
assert.strictEqual(r.reliability, 0);
assert.ok(r.flags.includes("clipped"));

// partial window (frame_count 22 of 45) → frameFactor < 1, flagged.
r = windowReliability({ ...goodSp1, frame_count: 22 }, goodSp2, {});
assert.ok(close(r.reliability, 22 / 45));
assert.ok(r.flags.includes("partial_window"));

// speed_confidence carries through and flags; SP2 flags passed through.
r = windowReliability(goodSp1, { speed_confidence: 0.5, flags: ["interpolated"] }, {});
assert.ok(close(r.reliability, 0.5));
assert.ok(r.flags.includes("low_speed_confidence"));
assert.ok(r.flags.includes("interpolated"));

// interior window with 46 frames clamps frameFactor to 1.
r = windowReliability({ ...goodSp1, frame_count: 46 }, goodSp2, {});
assert.ok(close(r.reliability, 1));

console.log("score-reliability tests passed");
