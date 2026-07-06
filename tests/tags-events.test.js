"use strict";
const assert = require("assert");
const { detectEvents } = require("../harness/tags/events");
const flat = Array.from({ length: 80 }, (_, i) => ({ t: i * 0.25, chaos: 0.1 }));
assert.strictEqual(detectEvents(flat).length, 0, "idle/flat must yield 0 events");
const burst = flat.map((p, i) => ({ t: p.t, chaos: i >= 10 && i <= 14 ? 0.9 : 0.1 }));
assert.strictEqual(detectEvents(burst).length, 1, "one burst -> one event");
// two bursts 0.75 s apart (3 hops) stay separate; 0.5 s (2 hops) merge
const two = flat.map((p, i) => ({ t: p.t, chaos: (i === 10 || i === 13) ? 0.9 : 0.1 }));
assert.strictEqual(detectEvents(two, { mergeGapS: 0.5 }).length, 2, "0.75s gap stays two");
// contiguous run of 12 hops (3.0s, 6% of series) exceeds maxLenS (2.0s = 8 hops) -> splits into an 8-hop chunk + 4-hop remainder
const longSeries = Array.from({ length: 200 }, (_, i) => ({ t: i * 0.25, chaos: 0.1 }));
const longBurst = longSeries.map((p, i) => ({ t: p.t, chaos: i >= 50 && i <= 61 ? 0.9 : 0.1 }));
const splitEv = detectEvents(longBurst);
assert.strictEqual(splitEv.length, 2, "12-hop run over maxLenS splits into two events");
assert.ok(splitEv[0].i_end === 57 && splitEv[1].i_start === 58, "split boundary is at the 8-hop maxN cap");
console.log("tags-events tests passed");
