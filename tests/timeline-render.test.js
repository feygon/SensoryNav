// tests/timeline-render.test.js
"use strict";
const assert = require("assert");
const T = require("../timeline-render.js");
assert.strictEqual(typeof T.buildData, "function", "buildData exported");
assert.strictEqual(typeof T.chartClient, "function", "chartClient exported");
assert.strictEqual(typeof T.drawTimeline, "function", "drawTimeline exported");
// buildData is DOM-light enough to run headless on a minimal fixture:
global.document = { getElementById: () => null };
const scored = [
  { started_at_ms: 0, speed_mps: 0, roughness_raw: 0, roughness_db: 0 },
  { started_at_ms: 1000, speed_mps: 10, roughness_raw: 50, roughness_db: 8 }
];
const D = T.buildData({ scored }, { label: "t", audioUrl: null, bandsOn: false, envelopeOn: false });
assert.strictEqual(D.pts.length, 2, "two points");
assert.strictEqual(D.maxT, 1, "maxT seconds");
assert.strictEqual(D.label, "t");
delete global.document;
console.log("timeline-render.test.js OK");
