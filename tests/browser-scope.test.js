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

// SP1 audio front-end: dual-export modules that attach to self.SensoryNavScore
// for importScripts() use in a Worker, in addition to module.exports for Node.
global.self = global.self || {};
require("../harness/audio/fft.js");
require("../harness/audio/audio-windows.js");
assert.strictEqual(typeof self.SensoryNavScore.stft, "function", "stft on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.framesToWindows, "function", "framesToWindows on self.SensoryNavScore");

// SP2 motion track: dual-export modules that attach to self.SensoryNavScore
// for importScripts() use in a Worker, in addition to module.exports for Node.
require("../harness/motion/linalg.js");
require("../harness/motion/geo-project.js");
require("../harness/motion/kalman-smoother.js");
require("../harness/motion/motion-track.js");
assert.strictEqual(typeof self.SensoryNavScore.matMul, "function", "matMul on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.transpose, "function", "transpose on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.identity, "function", "identity on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.matAdd, "function", "matAdd on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.matSub, "function", "matSub on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.scale, "function", "scale on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.solve, "function", "solve on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.projectFixes, "function", "projectFixes on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.bearingDeg, "function", "bearingDeg on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.R_EARTH, "number", "R_EARTH on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.smooth, "function", "smooth on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.evaluateAt, "function", "evaluateAt on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.forwardFilter, "function", "forwardFilter on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.rtsBackward, "function", "rtsBackward on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.INIT_VEL_VAR, "number", "INIT_VEL_VAR on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.buildMotionTrack, "function", "buildMotionTrack on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.classifyWindow, "function", "classifyWindow on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.confidenceFromCov, "function", "confidenceFromCov on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.sortDedupFixes, "function", "sortDedupFixes on self.SensoryNavScore");

// SP3 score modules: dual-export modules that attach to self.SensoryNavScore
// for importScripts() use in a Worker, in addition to module.exports for Node.
require("../harness/score/roughness-db.js");
require("../harness/score/reliability.js");
require("../harness/score/validate.js");
require("../harness/score/speech-detect.js");
assert.strictEqual(typeof self.SensoryNavScore.roughnessDb, "function", "roughnessDb on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.toDb, "function", "toDb on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.bandDeltaDb, "function", "bandDeltaDb on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.EPS_ENERGY, "number", "EPS_ENERGY on self.SensoryNavScore");
assert.ok(Array.isArray(self.SensoryNavScore.BANDS), "BANDS on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.windowReliability, "function", "windowReliability on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.validatePass, "function", "validatePass on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.validateBatch, "function", "validateBatch on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.detectSpeech, "function", "detectSpeech on self.SensoryNavScore");

// SP3 tags: dual-export modules that attach to self.SensoryNavScore
// for importScripts() use in a Worker, in addition to module.exports for Node.
require("../harness/tags/events.js");
require("../harness/tags/extract.js");
require("../harness/tags/schema.js");
assert.strictEqual(typeof self.SensoryNavScore.detectEvents, "function", "detectEvents on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.confidence, "function", "confidence on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.extractTags, "function", "extractTags on self.SensoryNavScore");
assert.ok(self.SensoryNavScore.ACCEL_CAP && typeof self.SensoryNavScore.ACCEL_CAP === "object", "ACCEL_CAP on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.validateTag, "function", "validateTag on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.loadRegistry, "function", "loadRegistry on self.SensoryNavScore");
assert.ok(Array.isArray(self.SensoryNavScore.DOMAINS), "DOMAINS on self.SensoryNavScore");
assert.ok(Array.isArray(self.SensoryNavScore.ACCEL), "ACCEL on self.SensoryNavScore");

// On-device analyze worker surface: every module in analyze-worker.js's MODULES list must
// publish its API onto self, or the worker throws at runtime in a browser (Node's per-require
// scope hides this). We assert the whole chain here — especially the four ENTRY points the
// worker calls as S.buildFrontEnd/detectSpeech/scoreResearch/deriveSquelch — so a module that
// silently fails to attach is caught before deploy, not as a blank analyze page.
require("../harness/audio/wav-decoder.js");
require("../harness/score/metrics.js");
require("../harness/score/baseline.js");
require("../harness/score/spectral-chaos.js");
require("../harness/score/score-frontend.js");
require("../harness/score/research-scorer.js");
require("../harness/score/squelch-derive.js");
require("../recorder/constants.js");
require("../recorder/audio-scoring.js");
assert.strictEqual(typeof self.SensoryNavScore.realFftDb, "function", "realFftDb on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.decodeWav, "function", "decodeWav on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.quantile, "function", "quantile on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.fitBaseline, "function", "fitBaseline on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.computeSpectralChaos, "function", "computeSpectralChaos on self.SensoryNavScore");
// The four entry points analyze-worker.js invokes directly.
assert.strictEqual(typeof self.SensoryNavScore.buildFrontEnd, "function", "buildFrontEnd on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.scoreResearch, "function", "scoreResearch on self.SensoryNavScore");
assert.strictEqual(typeof self.SensoryNavScore.deriveSquelch, "function", "deriveSquelch on self.SensoryNavScore");
// Recorder-core modules the worker also loads; these attach to self.SensoryNavCore (not window).
assert.ok(self.SensoryNavCore && typeof self.SensoryNavCore.CONSTANTS === "object", "CONSTANTS on self.SensoryNavCore");
assert.strictEqual(typeof self.SensoryNavCore.roughnessScore, "function", "roughnessScore on self.SensoryNavCore");

console.log("browser-scope tests passed");
