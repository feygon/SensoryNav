// tests/join-windows.test.js
// Unit test for the pure joinWindows() core carved out of squelch-derive's chaos<->scored-window
// alignment (Task C4). joinWindows(chaosSeries, scoredWindows, floors) nearest-time-joins the
// fine-grained (0.25s hop) chaos series against the coarser (1s hop) scored-window series and a
// pre-computed per-window floor array, producing one row per chaosSeries point with all 8 fields.
"use strict";
const assert = require("assert");
const { joinWindows } = require("../harness/score/squelch-derive.js");

const chaosSeries = Object.freeze([
  Object.freeze({ t: 0, chaos: 0.1, tonality: 0.9, level_db: -10, low_conf: false }),
  Object.freeze({ t: 0.5, chaos: 0.3, tonality: 0.7, level_db: -8, low_conf: true }),
  Object.freeze({ t: 1.0, chaos: 0.6, tonality: 0.4, level_db: -5, low_conf: false }),
  Object.freeze({ t: 2.0, chaos: 0.9, tonality: 0.2, level_db: -2, low_conf: false })
]);
const scoredWindows = Object.freeze([
  Object.freeze({ t: 0.5, speed: 2, reliability: 0.9 }),
  Object.freeze({ t: 1.5, speed: 5, reliability: 0.5 })
]);
const floors = Object.freeze([-20, -15]); // aligned 1:1 with scoredWindows

const EXPECTED_KEYS = ["t", "chaos", "tonality", "level_db", "floor_db", "speed", "reliability", "low_conf"];

// 1. One row per chaosSeries point, no more, no less.
{
  const rows = joinWindows(chaosSeries, scoredWindows, floors);
  assert.strictEqual(rows.length, chaosSeries.length, "one row per chaosSeries point");
}

// 2. Every row carries exactly the 8 documented fields.
{
  const rows = joinWindows(chaosSeries, scoredWindows, floors);
  for (const row of rows) {
    assert.deepStrictEqual(Object.keys(row).sort(), EXPECTED_KEYS.slice().sort(), "row has exactly the 8 documented fields");
  }
}

// 3. Chaos/tonality/level_db/low_conf come straight from the chaosSeries point; speed/reliability/
//    floor_db come from the nearest-in-time scoredWindows entry (+ its aligned floors[i]).
{
  const rows = joinWindows(chaosSeries, scoredWindows, floors);
  // t=0 and t=0.5 are both nearest to scoredWindows[0] (t=0.5) -> floor/speed/reliability from window 0.
  assert.strictEqual(rows[0].t, 0);
  assert.strictEqual(rows[0].chaos, 0.1);
  assert.strictEqual(rows[0].tonality, 0.9);
  assert.strictEqual(rows[0].level_db, -10);
  assert.strictEqual(rows[0].low_conf, false);
  assert.strictEqual(rows[0].speed, 2);
  assert.strictEqual(rows[0].reliability, 0.9);
  assert.strictEqual(rows[0].floor_db, -20);

  assert.strictEqual(rows[1].low_conf, true);
  assert.strictEqual(rows[1].speed, 2);
  assert.strictEqual(rows[1].floor_db, -20);

  // t=1.0 is equidistant (0.5 each way) between window0 (t=0.5) and window1 (t=1.5) -> nearestIndex
  // ties toward the lower index (see squelch-derive.js's nearestIndex tie rule).
  assert.strictEqual(rows[2].speed, 2);
  assert.strictEqual(rows[2].floor_db, -20);

  // t=2.0 is past the last window (t=1.5) -> clamps to the last window.
  assert.strictEqual(rows[3].speed, 5);
  assert.strictEqual(rows[3].reliability, 0.5);
  assert.strictEqual(rows[3].floor_db, -15);
  assert.strictEqual(rows[3].chaos, 0.9);
}

// 4. Pure: does not mutate its inputs (frozen arrays/objects above would throw on write in
//    strict mode if joinWindows tried), and is deterministic across repeated calls.
{
  const a = JSON.stringify(joinWindows(chaosSeries, scoredWindows, floors));
  const b = JSON.stringify(joinWindows(chaosSeries, scoredWindows, floors));
  assert.strictEqual(a, b, "deterministic");
}

console.log("join-windows tests passed");
