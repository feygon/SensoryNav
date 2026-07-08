"use strict";
const assert = require("assert");
const { detectSpeech } = require("../harness/score/speech-detect.js");
const sr = 48000;
// two frames in window 0 with high+mid above thresholds → talking; window 1 silent → not.
const loud = { centerSample: 0, energies: { low: 1, mid: 1, high: 1 } };
const frames = [loud, { centerSample: 10, energies: { low: 1, mid: 1, high: 1 } }, { centerSample: 20, energies: { low: 1, mid: 1, high: 1 } },
  { centerSample: sr * 1.5, energies: { low: 1e-12, mid: 1e-12, high: 1e-12 } }];
const d = detectSpeech(frames, sr);
assert.strictEqual(d.isTalking(0), true, "window 0 talking (>=3 co-elevated frames)");
assert.strictEqual(d.isTalking(1), false, "window 1 not talking");

// speechCount and speechRanges reflect the same signal.
assert.strictEqual(d.speechCount[0], 3, "3 co-elevated frames counted in window 0");
assert.deepStrictEqual(d.speechRanges, [[0, 1]], "merged speech range covers only window 0");

console.log("speech-detect.test.js OK");
