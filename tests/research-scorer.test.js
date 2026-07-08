// tests/research-scorer.test.js
// Byte-identity gate for the Task 8 extraction: scoreResearch(front, opts) must reproduce
// the exact scored-clean.json / highres-clean.json that scripts/score-research.js produced
// BEFORE the extraction (snapshotted under .superpowers/sdd/task8-ref/ — not the live
// out/score-jc4/ files, which the wrapper overwrites on every run).
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildFrontEnd } = require("../harness/score/score-frontend.js");
const { detectSpeech } = require("../harness/score/speech-detect.js");
const { scoreResearch } = require("../harness/score/research-scorer.js");

const sc = "data/johnson-creek-pass-4-181806.json";
const sidecar = JSON.parse(fs.readFileSync(sc, "utf8"));
const wavBytes = fs.readFileSync(path.join(path.dirname(sc), sidecar.audio.wav_filename));
const front = buildFrontEnd({ wavBytes, audioFirstFrameMs: sidecar.audio_first_frame_ms, gpsSamples: sidecar.gps_samples });
const speech = detectSpeech(front.frames, front.sr);
const { scored, hires } = scoreResearch(Object.assign({}, front, { speech }), {});

const refScored = JSON.parse(fs.readFileSync(path.join(".superpowers", "sdd", "task8-ref", "scored-clean.json"), "utf8"));
const refHires = JSON.parse(fs.readFileSync(path.join(".superpowers", "sdd", "task8-ref", "highres-clean.json"), "utf8"));

assert.strictEqual(JSON.stringify(scored, null, 2), JSON.stringify(refScored, null, 2), "scored-clean identical");
assert.strictEqual(JSON.stringify(hires), JSON.stringify(refHires), "highres-clean identical");
console.log("research-scorer.test.js OK");
