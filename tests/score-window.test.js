// tests/score-window.test.js
// Unit test for the pure scoreWindow() core carved out of scoreResearch's per-window loop
// (Task C3). scoreWindow(w, rec, talking, floors, globalFloors, weights, scoreScale, detectTau)
// must be pure: no closed-over mutable state, no mutation of its inputs, deterministic output.
"use strict";
const assert = require("assert");
const { scoreWindow } = require("../harness/score/research-scorer.js");

const RW = Object.freeze({ low: 0.6, mid: 0.3, high: 0.1 });
const SCORE_SCALE = 50;
const DETECT_TAU = 12;

function makeWindow(overrides) {
  return Object.freeze(Object.assign({
    window_id: 7,
    started_at_ms: 7000,
    low_energy: 4,
    mid_energy: 1,
    high_energy: 1,
    clip_fraction: 0,
    frame_count: 45,
    near_floor: false
  }, overrides));
}

function makeRec(overrides) {
  return Object.freeze(Object.assign({
    speed_mps: 5,
    lat: 45.1,
    lon: -122.6,
    heading_deg: 90,
    speed_source: "gps",
    flags: [],
    speed_confidence: 1
  }, overrides));
}

const floors = Object.freeze({ low: 1, mid: 1, high: 1 });
const globalFloors = Object.freeze({ low: 1, mid: 1, high: 1 });

const EXPECTED_KEYS = [
  "window_id", "started_at_ms", "lat", "lon",
  "speed_mps", "heading_deg",
  "roughness_raw", "roughness", "detected",
  "magnitude", "roughness_null", "roughness_db",
  "reliability", "reliability_flags", "speed_source", "sp2_flags",
  "felt_present", "felt_magnitude"
];

// 1. Documented shape: exactly the 18 keys, in the row scoreResearch has always produced.
{
  const w = makeWindow();
  const rec = makeRec();
  const row = scoreWindow(w, rec, false, floors, globalFloors, RW, SCORE_SCALE, DETECT_TAU);
  const keys = Object.keys(row).sort();
  assert.deepStrictEqual(keys, EXPECTED_KEYS.slice().sort(), "row has exactly the documented 18 keys");
  assert.strictEqual(row.window_id, 7);
  assert.strictEqual(row.lat, 45.1);
  assert.strictEqual(row.speed_mps, 5);
}

// 2. roughness_raw rises with band energy (energy further above the floor -> more roughness).
{
  const rec = makeRec();
  const quiet = scoreWindow(makeWindow({ low_energy: 1 }), rec, false, floors, globalFloors, RW, SCORE_SCALE, DETECT_TAU);
  const loud = scoreWindow(makeWindow({ low_energy: 20 }), rec, false, floors, globalFloors, RW, SCORE_SCALE, DETECT_TAU);
  assert.ok(loud.roughness_raw > quiet.roughness_raw, "more low-band energy above the floor -> higher roughness_raw");
}

// 3. Determinism: same input -> byte-identical output object, called twice.
{
  const w = makeWindow();
  const rec = makeRec();
  const row1 = scoreWindow(w, rec, false, floors, globalFloors, RW, SCORE_SCALE, DETECT_TAU);
  const row2 = scoreWindow(w, rec, false, floors, globalFloors, RW, SCORE_SCALE, DETECT_TAU);
  assert.strictEqual(JSON.stringify(row1), JSON.stringify(row2), "same input -> identical row on repeat calls");
}

// 4. No mutation: window and rec are frozen above, so any attempted write throws in strict mode.
//    Calling scoreWindow must not throw — proving it only reads w/rec, never writes them.
{
  const w = makeWindow();
  const rec = makeRec();
  assert.doesNotThrow(() => scoreWindow(w, rec, false, floors, globalFloors, RW, SCORE_SCALE, DETECT_TAU),
    "scoreWindow must not mutate its frozen window/rec inputs");
}

// 5. talking=true forces reliability to 0 and adds the "talking" flag, without mutating the
//    window/rec inputs (still frozen above).
{
  const w = makeWindow();
  const rec = makeRec();
  const row = scoreWindow(w, rec, true, floors, globalFloors, RW, SCORE_SCALE, DETECT_TAU);
  assert.strictEqual(row.reliability, 0, "talking window forces reliability to 0");
  assert.ok(row.reliability_flags.includes("talking"), "talking window is flagged");
}

console.log("score-window tests passed");
