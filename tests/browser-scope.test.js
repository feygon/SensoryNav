// tests/browser-scope.test.js
"use strict";

// Regression test for a cross-<script> global collision. In a browser, classic
// <script> tags all share ONE global scope, so two modules that each declare a
// top-level `const exported` collide ("Identifier 'exported' has already been
// declared") — the offending scripts never run and never attach to
// window.SensoryNavCore. Node's require() gives every file its own module
// scope, so the per-module unit tests can NEVER surface this. Here we simulate
// the browser by concatenating the module sources and evaluating them in one
// shared scope with a fake window, then assert every export is present.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// The exact set the capture page loads together, in load order.
const files = ["wav-encoder.js", "gps-track.js", "capture-state.js", "capture-manifest.js"];
const source = files
  .map((f) => fs.readFileSync(path.join(__dirname, "..", "recorder", f), "utf8"))
  .join("\n");

// `module` is intentionally left undefined so the modules take their
// `window.SensoryNavCore` branch, exactly as in the browser.
const sandbox = { window: {} };
vm.createContext(sandbox);
// Throws SyntaxError here if any top-level identifier collides across modules.
vm.runInContext(source, sandbox);

const core = sandbox.window.SensoryNavCore || {};
const expected = ["encodeWav", "floatTo16BitPCM", "normalizeFix", "observedFixHz", "nextState", "buildManifest", "SCHEMA"];
for (const name of expected) {
  assert.ok(name in core, `export missing after shared-scope load: ${name}`);
}
assert.strictEqual(typeof core.nextState, "function");
assert.strictEqual(typeof core.encodeWav, "function");

console.log("browser-scope tests passed");
