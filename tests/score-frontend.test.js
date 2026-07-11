// tests/score-frontend.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildFrontEnd } = require("../harness/score/score-frontend.js");
const { have, skipped } = require("./lib/fixtures");
const sc = "data/johnson-creek-pass-4-181806.json";
if (!have(sc, "data/johnson-creek-pass-4-181806.wav")) { skipped("score-frontend.test.js", sc); process.exit(0); }
const sidecar = JSON.parse(fs.readFileSync(sc, "utf8"));
const wavBytes = fs.readFileSync(path.join(path.dirname(sc), sidecar.audio.wav_filename));
const f = buildFrontEnd({ wavBytes, audioFirstFrameMs: sidecar.audio_first_frame_ms, gpsSamples: sidecar.gps_samples });
assert.ok(f.sp1.length > 100, "sp1 windows built");
assert.ok(f.frames.length > f.sp1.length, "stft frames built (finer than 1s windows)");
assert.strictEqual(f.sp2.length, f.sp1.length, "sp2 track aligns to sp1 windows");
assert.ok(f.sp2By.get(f.sp1[0].window_id), "sp2By indexed by window_id");
console.log("score-frontend.test.js OK");
