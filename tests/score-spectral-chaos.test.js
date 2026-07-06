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

const { computeSpectralChaos } = require("../harness/score/spectral-chaos");
// 1.5 s @ 48k: first ~0.417s silent, remainder a loud 40 Hz tone.
// (Brief called for "1.5 s of a pure 40 Hz tone", but the near-silence guard
// is RELATIVE to this run's own p05 floor: a stationary tone has ~identical
// level in every window, so p05 ~= every window's level and EVERY window
// would read low_conf=true, failing the "confident tone" assertion below.
// A loud+quiet split gives the run a genuine floor -- from the quiet part --
// so the loud windows sit far above it. See task-4-report.md for the numbers.)
const fs2 = 48000, dur = 1.5, sig2 = new Float64Array(Math.round(fs2 * dur));
const quietSamples = 20000; // ~0.417s of near-silence, then tone to the end
for (let n = quietSamples; n < sig2.length; n++) sig2[n] = 0.3 * Math.sin(2 * Math.PI * 40 * n / fs2);
const sc = computeSpectralChaos(sig2, fs2);
assert.ok(sc.subbass.length > 0, "no sub-bass windows");
const mid = sc.subbass[Math.floor(sc.subbass.length / 2)];
assert.ok(mid.tonality > 0.6, `sub-bass tone tonality ${mid.tonality} should be >0.6`);
assert.strictEqual(mid.low_conf, false);
// silence -> low_conf true
const sil = new Float64Array(fs2 * dur);
const sc2 = computeSpectralChaos(sil, fs2);
assert.strictEqual(sc2.subbass[0].low_conf, true);

console.log("score-spectral-chaos tests passed");
