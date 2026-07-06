"use strict";
const assert = require("assert");
const { powerSpectrum, SBANDS } = require("../harness/score/spectral-chaos");
const fs = 48000, N = 2048;
// a 200 Hz sine should peak in the bin nearest 200 Hz
const sig = new Float64Array(N);
for (let n = 0; n < N; n++) sig[n] = Math.sin(2 * Math.PI * 200 * n / fs);
const ps = powerSpectrum(sig, 0, N);
let argmax = 0; for (let k = 1; k < ps.length; k++) if (ps[k] > ps[argmax]) argmax = k;
const peakHz = argmax * fs / N;
assert.ok(Math.abs(peakHz - 200) < fs / N, `peak ${peakHz} Hz not near 200`);
assert.strictEqual(SBANDS[0].key, "subbass");
assert.strictEqual(SBANDS[0].N, 16384);

const { tonality } = require("../harness/score/spectral-chaos");
// pure tone: one dominant bin -> high tonality
const tone = new Float64Array(64).fill(0.01); tone[20] = 100;
assert.ok(tonality(tone, 5, 40) > 0.8, `tone tonality ${tonality(tone, 5, 40)} should be >0.8`);
// flat white-ish spectrum -> low tonality
const flat = new Float64Array(64); for (let k = 0; k < 64; k++) flat[k] = 1 + (k % 2) * 0.01;
assert.ok(tonality(flat, 5, 40) < 0.2, `flat tonality ${tonality(flat, 5, 40)} should be <0.2`);

console.log("score-spectral-chaos tests passed");
