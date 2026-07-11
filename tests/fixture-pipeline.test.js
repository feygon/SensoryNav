// tests/fixture-pipeline.test.js — CI-enforced byte-identity gate on the COMMITTED fixture (no skip).
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildFrontEnd } = require("../harness/score/score-frontend.js");
const { detectSpeech } = require("../harness/score/speech-detect.js");
const { scoreResearch } = require("../harness/score/research-scorer.js");
const { deriveSquelch } = require("../harness/score/squelch-derive.js");
const { loadRegistry } = require("../harness/tags/schema.js");

const sc = path.join(__dirname, "..", "data", "fixtures", "test-pass-1.json");
const sidecar = JSON.parse(fs.readFileSync(sc, "utf8"));
const wavBytes = fs.readFileSync(path.join(path.dirname(sc), sidecar.audio.wav_filename));
const front = buildFrontEnd({ wavBytes, audioFirstFrameMs: sidecar.audio_first_frame_ms, gpsSamples: sidecar.gps_samples });
const speech = detectSpeech(front.frames, front.sr);
const { scored } = scoreResearch(Object.assign({}, front, { speech }), {});
const registry = loadRegistry(path.join(__dirname, "..", "harness", "tags", "registry"));
const { tags } = deriveSquelch(front, front.samples, front.sr, { registry });

const G = path.join(__dirname, "..", "out", "score-fixture");
assert.strictEqual(JSON.stringify(scored, null, 2), fs.readFileSync(path.join(G, "scored-clean.json"), "utf8"), "scored byte-identical");
assert.strictEqual(JSON.stringify(tags), fs.readFileSync(path.join(G, "tags-clean.json"), "utf8"), "tags byte-identical");
console.log("fixture-pipeline tests passed");
