"use strict";
const assert = require("assert");
const { chaosThreshold, seedWindow, segmentEvents, detectEvents } = require("../harness/tags/events");

// seedWindow: pure predicate, must preserve `row.chaos > thr && !row.low_conf` EXACTLY.
assert.strictEqual(seedWindow({ chaos: 0.9, low_conf: false }, 0.5), true, "above thr, not low_conf -> true");
assert.strictEqual(seedWindow({ chaos: 0.9, low_conf: true }, 0.5), false, "above thr but low_conf -> false");
assert.strictEqual(seedWindow({ chaos: 0.4, low_conf: false }, 0.5), false, "below thr -> false");

// segmentEvents composed with chaosThreshold+seedWindow must reproduce detectEvents exactly,
// on a synthetic series with a mix of idle, a burst, a merge-gap pair, an over-maxLen run, and
// a low_conf point that must not seed.
const series = [];
for (let i = 0; i < 400; i++) {
  const t = i * 0.25;
  let chaos = 0.1;
  if (i >= 10 && i <= 14) chaos = 0.9; // simple burst
  if (i === 30 || i === 32) chaos = 0.9; // close pair, merges at default mergeGapS
  if (i >= 60 && i <= 71) chaos = 0.9; // 12-hop run, exceeds default maxLenS (8 hops) -> splits
  if (i === 90) { chaos = 0.9; }
  series.push({ t, chaos, low_conf: i === 90 });
}
const opts = { pctile: 0.90, mergeGapS: 0.5, maxLenS: 2.0, minLenS: 0.1, hopS: 0.25 };

const viaCompose = segmentEvents(series, (r) => seedWindow(r, chaosThreshold(series, opts)), opts);
const viaDetect = detectEvents(series, opts);
assert.deepStrictEqual(viaCompose, viaDetect, "segmentEvents(seedWindow(chaosThreshold)) must reproduce detectEvents exactly");
assert.ok(viaDetect.length > 0, "sanity: fixture actually produces events");

console.log("event-carve tests passed");
