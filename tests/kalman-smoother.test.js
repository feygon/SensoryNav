// tests/kalman-smoother.test.js
"use strict";
const assert = require("assert");
const { smooth, evaluateAt } = require("../harness/motion/kalman-smoother");

const SIGMA_A = 2.0;
// CV track: v=(12,0) m/s, 1 Hz, exact positions, acc=5.
function cvPoints(n) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push({ t: i * 1000, x: 12 * i, y: 0, acc: 5, speedNative: 12 });
  return pts;
}

const sm = smooth(cvPoints(20), SIGMA_A);
for (let i = 5; i < 15; i++) {
  assert.ok(Math.abs(sm[i].s[2] - 12) < 0.05, `vx@${i}=${sm[i].s[2]}`);
  assert.ok(Math.abs(sm[i].s[3] - 0) < 0.05, `vy@${i}=${sm[i].s[3]}`);
}

// Accuracy weighting: one fix displaced 20 m sideways with acc=200 is pulled back toward the line.
const pts = cvPoints(20);
pts[10] = { t: 10000, x: 120, y: 20, acc: 200, speedNative: 12 };
const sm2 = smooth(pts, SIGMA_A);
assert.ok(Math.abs(sm2[10].s[1]) < 2, `smoothed y=${sm2[10].s[1]} should be < 2 m`);

// evaluateAt 0.5 s after fix 5 → position advanced ~6 m at same velocity.
const ev = evaluateAt(sm, 5500, SIGMA_A);
assert.ok(Math.abs(ev.s[0] - (12 * 5 + 6)) < 0.5, `x=${ev.s[0]}`);
assert.ok(Math.abs(ev.s[2] - 12) < 0.05);

// evaluateAt before the first fix (negative dt) → finite, with larger velocity variance than at fix 0.
const evBefore = evaluateAt(sm, -2000, SIGMA_A);
assert.ok(Number.isFinite(evBefore.s[0]));
assert.ok(evBefore.P[2][2] > sm[0].P[2][2]);

assert.throws(() => smooth([{ t: 0, x: 0, y: 0, acc: 5, speedNative: null }], SIGMA_A), />= 2|need/);

console.log("kalman-smoother tests passed");
