// tests/score-frontend-core.test.js
// Task C2: buildWindows(wavBytes, audioFirstFrameMs) is the CAUSAL core of buildFrontEnd
// (decode -> framesToWindows -> stft), carved out of the acausal SP2 motion smoothing.
// Uses the small committed fixture (data/fixtures/test-pass-1.*) — no have()/skip guard needed.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildFrontEnd, buildWindows } = require("../harness/score/score-frontend.js");

const sc = path.join("data", "fixtures", "test-pass-1.json");
const sidecar = JSON.parse(fs.readFileSync(sc, "utf8"));
const wavBytes = fs.readFileSync(path.join(path.dirname(sc), sidecar.audio.wav_filename));

const w = buildWindows(wavBytes, sidecar.audio_first_frame_ms);
assert.ok(w.sp1.length > 0, "buildWindows: sp1 windows built");
assert.ok(w.frames.length > w.sp1.length, "buildWindows: stft frames finer than 1s windows");

const f = buildFrontEnd({ wavBytes, audioFirstFrameMs: sidecar.audio_first_frame_ms, gpsSamples: sidecar.gps_samples });
assert.deepStrictEqual(f.sp1, w.sp1, "buildFrontEnd.sp1 deep-equals buildWindows.sp1");
assert.deepStrictEqual(f.frames, w.frames, "buildFrontEnd.frames deep-equals buildWindows.frames");

console.log("score-frontend-core.test.js OK");
