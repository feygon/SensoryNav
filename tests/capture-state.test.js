// tests/capture-state.test.js
const assert = require("assert");
const { nextState } = require("../recorder/capture-state");

assert.strictEqual(nextState("idle", "start"), "requesting_permissions");
assert.strictEqual(nextState("requesting_permissions", "granted"), "recording");
assert.strictEqual(nextState("requesting_permissions", "denied"), "error");
assert.strictEqual(nextState("recording", "stop"), "stopped");
assert.strictEqual(nextState("recording", "stream_lost"), "error");
assert.strictEqual(nextState("recording", "foreground_lost"), "recording");
assert.strictEqual(nextState("stopped", "reset"), "idle");
assert.strictEqual(nextState("error", "reset"), "idle");

// Illegal transitions return null.
assert.strictEqual(nextState("idle", "stop"), null);
assert.strictEqual(nextState("recording", "start"), null);
assert.strictEqual(nextState("stopped", "stream_lost"), null);

// Inherited Object.prototype keys are NOT valid events.
assert.strictEqual(nextState("idle", "toString"), null);
assert.strictEqual(nextState("idle", "constructor"), null);
assert.strictEqual(nextState("idle", "hasOwnProperty"), null);
// Unknown current state returns null.
assert.strictEqual(nextState("bogus", "start"), null);

console.log("capture-state tests passed");
