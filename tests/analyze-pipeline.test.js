// tests/analyze-pipeline.test.js — Node stand-in for the worker's module composition.
// analyze-worker.js composes score-frontend + speech-detect + research-scorer + squelch-derive
// exactly as below (its importScripts order mirrors the require order here, with the browser
// module-loading plumbing — recorder/constants.js, recorder/audio-scoring.js, metrics.js, etc. —
// guarded to attach to self.SensoryNavCore/self.SensoryNavScore instead of require()). This test
// runs that SAME module chain in Node, on the real jc4 fixture, and asserts the pipeline's
// `scored` and `tags` reproduce the committed reference in out/score-jc4/ (regenerate first with
// `node scripts/score-research.js data/johnson-creek-pass-4-181806.json out/score-jc4` and
// `node scripts/squelch-extract.js data/johnson-creek-pass-4-181806.json out/score-jc4` to ensure
// it's current) — proving the worker's exact module chain reproduces the pipeline output.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildFrontEnd } = require("../harness/score/score-frontend.js");
const { detectSpeech } = require("../harness/score/speech-detect.js");
const { scoreResearch } = require("../harness/score/research-scorer.js");
const { deriveSquelch } = require("../harness/score/squelch-derive.js");
const { loadRegistry } = require("../harness/tags/schema.js");

const sc = "data/johnson-creek-pass-4-181806.json";
const sidecar = JSON.parse(fs.readFileSync(sc, "utf8"));
const wavBytes = fs.readFileSync(path.join(path.dirname(sc), sidecar.audio.wav_filename));

const front = buildFrontEnd({ wavBytes, audioFirstFrameMs: sidecar.audio_first_frame_ms, gpsSamples: sidecar.gps_samples });
const speech = detectSpeech(front.frames, front.sr);
const { scored } = scoreResearch(Object.assign({}, front, { speech }), {});

const registry = loadRegistry(path.join("harness", "tags", "registry"));
const { tags } = deriveSquelch(front, front.samples, front.sr, { registry });

const refScored = fs.readFileSync(path.join("out", "score-jc4", "scored-clean.json"), "utf8");
assert.strictEqual(JSON.stringify(scored, null, 2), refScored, "worker chain reproduces scored-clean");

const refTags = fs.readFileSync(path.join("out", "score-jc4", "tags-clean.json"), "utf8");
assert.strictEqual(JSON.stringify(tags), refTags, "worker chain reproduces tags-clean");

console.log("analyze-pipeline.test.js OK");
