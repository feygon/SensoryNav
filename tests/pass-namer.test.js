// tests/pass-namer.test.js
"use strict";
const assert = require("assert");
const { passName, parsePassNumber, nextUnused } = require("../recorder/pass-namer");

// passName: canonical "Pass-<n>"
assert.strictEqual(passName(1), "Pass-1");
assert.strictEqual(passName(42), "Pass-42");

// parsePassNumber: only the canonical form, case-sensitive, no leading zero
assert.strictEqual(parsePassNumber("Pass-1"), 1);
assert.strictEqual(parsePassNumber("Pass-42"), 42);
assert.strictEqual(parsePassNumber("johnson-creek-pass-1"), null); // a custom name — not consumed
assert.strictEqual(parsePassNumber("pass-1"), null);               // case-sensitive
assert.strictEqual(parsePassNumber("Pass-"), null);
assert.strictEqual(parsePassNumber("Pass-1a"), null);
assert.strictEqual(parsePassNumber("Pass-01"), null);              // no leading zero
assert.strictEqual(parsePassNumber("Pass-0"), null);              // 0 is not a valid pass number
assert.strictEqual(parsePassNumber(""), null);
assert.strictEqual(parsePassNumber("Pass-1 "), null);             // trailing space

// nextUnused: lowest positive integer not present (handles gaps + order-independence)
assert.strictEqual(nextUnused([]), 1);
assert.strictEqual(nextUnused([1]), 2);
assert.strictEqual(nextUnused([1, 2, 3]), 4);
assert.strictEqual(nextUnused([2, 3]), 1);        // lowest unused is the gap at 1
assert.strictEqual(nextUnused([1, 3]), 2);        // interior gap
assert.strictEqual(nextUnused([3, 1, 2]), 4);     // order-independent
assert.strictEqual(nextUnused([5]), 1);           // a manual jump to 5 frees 1..4
assert.strictEqual(nextUnused([0, 1]), 2);        // ignores non-positive noise

// nextUnused must not mutate its input
const used = [1, 2];
nextUnused(used);
assert.deepStrictEqual(used, [1, 2], "nextUnused does not mutate its argument");

// round-trip: the number a Pass-N download consumes is then skipped
const set = [];
const n = parsePassNumber("Pass-" + nextUnused(set)); // 1
set.push(n);
assert.strictEqual(nextUnused(set), 2);

console.log("pass-namer tests passed");
