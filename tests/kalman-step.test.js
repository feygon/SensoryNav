// tests/kalman-step.test.js
"use strict";
const assert = require("assert");
const { kalmanStep, forwardFilter } = require("../harness/motion/kalman-smoother.js");

const SIGMA_A = 2.0;
const pts = [
  { t: 0, x: 0, y: 0, acc: 5 },
  { t: 1000, x: 12, y: 0, acc: 5 },
  { t: 2000, x: 24, y: 0, acc: 5 }
];

// Folding kalmanStep over a sequence reproduces forwardFilter's per-step estimate
// (real shape: filtered[{sFilt,PFilt,sPred,PPred}], sFilt/sPred are 4x1 column
// vectors, PFilt/PPred are 4x4 matrices — per docs/scorer-registry.md).
const ff = forwardFilter(pts, SIGMA_A);
let state = null;
const out = [];
for (const p of pts) {
  const r = kalmanStep(state, p, SIGMA_A);
  state = r.state;
  out.push(r.out);
}
assert.strictEqual(out.length, ff.length);
for (let i = 0; i < ff.length; i++) {
  for (let row = 0; row < 4; row++) {
    assert.ok(
      Math.abs(out[i].sFilt[row][0] - ff[i].sFilt[row][0]) < 1e-9,
      `sFilt[${i}][${row}] fold matches forwardFilter`
    );
    assert.ok(
      Math.abs(out[i].sPred[row][0] - ff[i].sPred[row][0]) < 1e-9,
      `sPred[${i}][${row}] fold matches forwardFilter`
    );
    for (let col = 0; col < 4; col++) {
      assert.ok(
        Math.abs(out[i].PFilt[row][col] - ff[i].PFilt[row][col]) < 1e-9,
        `PFilt[${i}][${row}][${col}] fold matches forwardFilter`
      );
      assert.ok(
        Math.abs(out[i].PPred[row][col] - ff[i].PPred[row][col]) < 1e-9,
        `PPred[${i}][${row}][${col}] fold matches forwardFilter`
      );
    }
  }
}

// Determinism: same (state, fix) input yields an identical result on repeated calls.
const r1 = kalmanStep(state, pts[2], SIGMA_A);
const r2 = kalmanStep(state, pts[2], SIGMA_A);
assert.deepStrictEqual(r1.out, r2.out, "kalmanStep is deterministic (out)");
assert.deepStrictEqual(r1.state, r2.state, "kalmanStep is deterministic (state)");

// Purity: kalmanStep must not mutate its input fix or its carried state in place.
const fixBefore = JSON.stringify(pts[1]);
const stateBefore = JSON.stringify(state);
kalmanStep(state, pts[1], SIGMA_A);
assert.strictEqual(JSON.stringify(pts[1]), fixBefore, "does not mutate its input fix");
assert.strictEqual(JSON.stringify(state), stateBefore, "does not mutate its carried state");

// First-step init: state==null seeds from INIT_VEL_VAR and the fix's own position/acc.
const first = kalmanStep(null, pts[0], SIGMA_A);
assert.strictEqual(first.out.sFilt[0][0], pts[0].x);
assert.strictEqual(first.out.sFilt[1][0], pts[0].y);
assert.strictEqual(first.out.sFilt[2][0], 0);
assert.strictEqual(first.out.sFilt[3][0], 0);

console.log("kalman-step tests passed");
