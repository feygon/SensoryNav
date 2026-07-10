// tests/tag-value.test.js
// Unit tests for the de-closured pure fusion cores carved out of squelch-derive (Task C4):
// valueFor(name, event, ctx) and reliabilityFor(name, event, ctx). Pre-carve these were closures
// (makeValueFor(sq,baseline,eventCtx), makeReliabilityFor(sq,eventCtx)); the carve threads the
// closed-over state onto an explicit ctx = { bands, bandN, floorAt, window } instead.
"use strict";
const assert = require("assert");
const { valueFor, reliabilityFor } = require("../harness/score/squelch-derive.js");

function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const subbass = Object.freeze([
  Object.freeze({ t: 0, tonality: 0.2, energy: 10, chaos: 0.8, low_conf: false }),
  Object.freeze({ t: 0.25, tonality: 0.5, energy: 12, chaos: 0.5, low_conf: false }),
  Object.freeze({ t: 0.5, tonality: 0.8, energy: 20, chaos: 0.2, low_conf: false })
]);
const event = Object.freeze({ i_start: 0, i_end: 2, t_start: 0, t_end: 0.5 });
const bandN = Object.freeze({ subbass: 16384, low: 2048, mid: 1024, high: 512 });
const window = Object.freeze({ speed: 3, reliability: 0.7 });

function makeCtx(overrides) {
  return Object.freeze(Object.assign({
    bands: Object.freeze({ subbass, low: Object.freeze([]), mid: Object.freeze([]), high: Object.freeze([]) }),
    bandN,
    floorAt: (band, speed) => 5, // arbitrary finite floor for the "level" branch
    window
  }, overrides));
}

// 1. valueFor("tonality", event, ctx) = median tonality over the event's subbass points.
{
  const ctx = makeCtx();
  const v = valueFor("tonality", event, ctx);
  assert.strictEqual(v, median([0.2, 0.5, 0.8]));
  assert.strictEqual(v, 0.5);
}

// 2. reliabilityFor: no low_conf point in the event -> ctx.window.reliability.
{
  const ctx = makeCtx();
  assert.strictEqual(reliabilityFor("tonality", event, ctx), 0.7);
}

// 3. reliabilityFor: any low_conf point in the event's span -> 0, regardless of window.reliability.
{
  const lowConfSubbass = Object.freeze([
    subbass[0],
    Object.freeze(Object.assign({}, subbass[1], { low_conf: true })),
    subbass[2]
  ]);
  const ctx = makeCtx({ bands: Object.freeze({ subbass: lowConfSubbass, low: Object.freeze([]), mid: Object.freeze([]), high: Object.freeze([]) }) });
  assert.strictEqual(reliabilityFor("tonality", event, ctx), 0);
}

// 4. Pure: frozen ctx/event never throws (no mutation attempted), deterministic across calls.
{
  const ctx = makeCtx();
  assert.doesNotThrow(() => valueFor("tonality", event, ctx));
  assert.doesNotThrow(() => reliabilityFor("tonality", event, ctx));
  const a = valueFor("tonality", event, ctx), b = valueFor("tonality", event, ctx);
  assert.strictEqual(a, b, "deterministic");
}

console.log("tag-value tests passed");
