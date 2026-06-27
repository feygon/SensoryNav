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
