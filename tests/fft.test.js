// tests/fft.test.js
"use strict";
const assert = require("assert");
const { CONSTANTS } = require("../recorder/constants");
const { bandEnergiesFromSpectrum } = require("../recorder/audio-scoring");
const { realFftDb } = require("../harness/audio/fft");

const N = CONSTANTS.FFT_SIZE; // 2048
const SR = 48000;

function toneFrame(freq) {
  const f = new Float32Array(N);
  for (let n = 0; n < N; n++) f[n] = Math.sin((2 * Math.PI * freq * n) / SR);
  return f;
}
function argmax(arr) {
  let m = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[m]) m = i;
  return m;
}

// Wrong-length frame throws.
assert.throws(() => realFftDb(new Float32Array(100)), /length/);

// Output is exactly 1024 bins.
const dc = new Float32Array(N).fill(1);
const dcDb = realFftDb(dc);
assert.strictEqual(dcDb.length, N / 2);
// DC (constant) input: peak bin is 0.
assert.strictEqual(argmax(dcDb), 0);

// Absolute-scale lock: unit DC -> bin0 magnitude = mean(Hann); recovered linear
// power 10^(dB/10) must equal mean(Hann)^2 (pins /N normalization + dB convention).
let hannSum = 0;
for (let n = 0; n < N; n++) hannSum += 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
const meanHann = hannSum / N;
const recoveredPower0 = Math.pow(10, dcDb[0] / 10);
assert.ok(Math.abs(recoveredPower0 - meanHann * meanHann) < 1e-3,
  `bin0 power ${recoveredPower0} vs meanHann^2 ${meanHann * meanHann}`);

// A sine at exactly bin 64 peaks within +/-1 bin of 64.
const binFreq = (64 * SR) / N;
assert.ok(Math.abs(argmax(realFftDb(toneFrame(binFreq))) - 64) <= 1);

// Band assignment: a tone lands overwhelmingly in its own band.
function bandsOf(freq) {
  return bandEnergiesFromSpectrum(realFftDb(toneFrame(freq)), SR, N);
}
const lo = bandsOf(150);
assert.ok(lo.low > lo.mid * 10 && lo.low > lo.high * 10);
const mid = bandsOf(500);
assert.ok(mid.mid > mid.low * 10 && mid.mid > mid.high * 10);
const hi = bandsOf(2000);
assert.ok(hi.high > hi.low * 10 && hi.high > hi.mid * 10);

console.log("fft tests passed");
