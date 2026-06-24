"use strict";

const assert = require("assert");
const { colorForScore, CONTROL_STOPS, NEUTRAL_COLOR } = require("../recorder/cvd-scale");

const hex = /^#[0-9a-f]{6}$/;

// Endpoints map to the first/last cividis stops.
assert.strictEqual(colorForScore(0), CONTROL_STOPS[0]);
assert.strictEqual(colorForScore(100), CONTROL_STOPS[CONTROL_STOPS.length - 1]);

// Always a valid hex, including a mid value and out-of-range clamps.
assert.ok(hex.test(colorForScore(50)));
assert.strictEqual(colorForScore(-20), colorForScore(0));
assert.strictEqual(colorForScore(160), colorForScore(100));

// Perceptual lightness increases smooth -> rough (cividis dark blue -> yellow).
function luminance(hexColor) {
  const n = parseInt(hexColor.slice(1), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
}
assert.ok(luminance(colorForScore(90)) > luminance(colorForScore(10)));

// Invalid/unknown scores must never silently render as the "smoothest" color.
assert.strictEqual(colorForScore(NaN), NEUTRAL_COLOR);
assert.strictEqual(colorForScore(null), NEUTRAL_COLOR);
assert.strictEqual(colorForScore(undefined), NEUTRAL_COLOR);

// A legitimate zero score is unaffected and still maps to the first control stop.
assert.strictEqual(colorForScore(0), CONTROL_STOPS[0]);

console.log("cvd-scale tests passed");
