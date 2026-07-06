"use strict";
const assert = require("assert");
const { confidence } = require("../harness/tags/extract");
// accel caps
assert.strictEqual(confidence(0.5, 1, "none"), 0);                 // sharpness at midpoint = 0 -> maximally uncertain
assert.ok(Math.abs(confidence(1.0, 1, "none") - 1.0) < 1e-9);      // decisive value, no cap
assert.ok(Math.abs(confidence(1.0, 1, "required") - 0.4) < 1e-9);  // required caps at 0.4
assert.strictEqual(confidence(1.0, 0, "none"), 0);                  // zero reliability -> 0
console.log("tags-extract confidence tests passed");
