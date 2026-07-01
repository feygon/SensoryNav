// tests/score-pass.test.js
"use strict";
const assert = require("assert");
const { scorePass } = require("../harness/score/score-pass");

const baseline = {
  low:  { points: [], global: 1, meta: {} },
  mid:  { points: [], global: 1, meta: {} },
  high: { points: [], global: 1, meta: {} }
};
function sp1(i, low, clip, frame, nf) { return { window_id: "w" + i, started_at_ms: i * 1000, duration_ms: 1000, low_energy: low, mid_energy: 1, high_energy: 1, clip_fraction: clip || 0, frame_count: frame == null ? 45 : frame, near_floor: !!nf }; }
function sp2(i, conf) { return { window_id: "w" + i, started_at_ms: i * 1000, lat: 45 + i * 1e-5, lon: -122, speed_mps: 10, heading_deg: 90, speed_confidence: conf == null ? 1 : conf, speed_source: "derived", flags: [] }; }

const win = [sp1(0, 5), sp1(1, 1), sp1(2, 5, 0, 45, true)];
const trk = [sp2(0), sp2(1), sp2(2)];

// null felt → all felt_present false; record shape + length.
const scored = scorePass(win, trk, baseline, null, {});
assert.strictEqual(scored.length, 3);
assert.strictEqual(scored[0].window_id, "w0");
assert.strictEqual(scored[0].felt_present, false);
assert.ok(scored[0].roughness_raw > 0);                 // low 5 vs global 1
assert.ok("roughness_null" in scored[0]);
assert.strictEqual(scored[0].lat, trk[0].lat);

// near_floor window retained with reliability 0 (NOT dropped).
assert.strictEqual(scored[2].reliability, 0);
assert.ok(scored[2].reliability_flags.includes("near_floor"));

// felt join.
const felt = { spans: [{ start_ms: 0, end_ms: 1500, magnitude: 3 }], events: [] };
const scored2 = scorePass(win, trk, baseline, felt, {});
assert.strictEqual(scored2[0].felt_present, true);
assert.strictEqual(scored2[0].felt_magnitude, 3);

// missing SP2 window → throw.
assert.throws(() => scorePass(win, [sp2(0), sp2(1)], baseline, null, {}), /missing in SP2 track/);

console.log("score-pass tests passed");
