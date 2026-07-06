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
console.log("tags-events tests passed");
