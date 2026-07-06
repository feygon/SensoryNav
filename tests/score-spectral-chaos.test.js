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
console.log("score-spectral-chaos tests passed");
