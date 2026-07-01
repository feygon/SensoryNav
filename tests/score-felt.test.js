// tests/score-felt.test.js
"use strict";
const assert = require("assert");
const { loadFelt, mapFeltToWindows } = require("../harness/score/felt");

// loadFelt validation
assert.throws(() => loadFelt({ schema: "wrong" }), /felt:/);
assert.throws(() => loadFelt({ schema: "sensorynav-felt-v1", spans: "x", events: [] }), /felt:/);
assert.throws(() => loadFelt({ schema: "sensorynav-felt-v1", spans: [{ start_ms: 5, end_ms: 5, magnitude: 1 }], events: [] }), /felt:/);
assert.throws(() => loadFelt({ schema: "sensorynav-felt-v1", spans: [], events: [{ at_ms: 1, magnitude: NaN }] }), /felt:/);
const felt = loadFelt({
  schema: "sensorynav-felt-v1",
  spans: [{ start_ms: 1000, end_ms: 3000, magnitude: 3, category: "washboard" }],
  events: [{ at_ms: 5500, magnitude: 4 }]
});
assert.strictEqual(felt.spans.length, 1);

// mapFeltToWindows: 1s windows at t0=0..6.
const windows = [];
for (let i = 0; i < 7; i++) windows.push({ window_id: "w" + i, started_at_ms: i * 1000, duration_ms: 1000 });
const mapped = mapFeltToWindows(felt, windows);
assert.strictEqual(mapped.length, 7);
assert.strictEqual(mapped[0].felt_present, false);            // [0,1000) no overlap (span starts at 1000)
assert.strictEqual(mapped[1].felt_present, true);             // [1000,2000) overlaps span
assert.strictEqual(mapped[1].felt_magnitude, 3);
assert.strictEqual(mapped[2].felt_present, true);             // [2000,3000) overlaps span
assert.strictEqual(mapped[3].felt_present, false);            // [3000,4000) span end exclusive
assert.strictEqual(mapped[5].felt_present, true);             // event 5500 in [5000,6000)
assert.strictEqual(mapped[5].felt_magnitude, 4);

// max magnitude wins when both overlap.
const felt2 = loadFelt({ schema: "sensorynav-felt-v1", spans: [{ start_ms: 5000, end_ms: 6000, magnitude: 2 }], events: [{ at_ms: 5500, magnitude: 4 }] });
assert.strictEqual(mapFeltToWindows(felt2, windows)[5].felt_magnitude, 4);

console.log("score-felt tests passed");
