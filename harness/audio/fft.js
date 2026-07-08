// harness/audio/fft.js
"use strict";
var { CONSTANTS } = (typeof require !== "undefined") ? require("../../recorder/constants") : self.SensoryNavCore;

const FFT_SIZE = CONSTANTS.FFT_SIZE; // 2048
const EPS = 1e-9;

// Precomputed Hann window.
const hann = new Float64Array(FFT_SIZE);
for (let n = 0; n < FFT_SIZE; n++) {
  hann[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (FFT_SIZE - 1)));
}

// In-place iterative radix-2 Cooley-Tukey FFT (forward). re/im are equal-length
// Float64Arrays whose length is a power of two.
function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1;
      let cwi = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = cwr * re[b] - cwi * im[b];
        const ti = cwr * im[b] + cwi * re[b];
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = ncwr;
      }
    }
  }
}

function realFftDb(frame) {
  if (frame.length !== FFT_SIZE) {
    throw new Error(`realFftDb: frame length ${frame.length} != FFT_SIZE ${FFT_SIZE}`);
  }
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  for (let n = 0; n < FFT_SIZE; n++) {
    re[n] = frame[n] * hann[n];
  }
  fftInPlace(re, im);
  const bins = FFT_SIZE / 2;
  const out = new Float32Array(bins);
  for (let k = 0; k < bins; k++) {
    const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / FFT_SIZE;
    out[k] = 20 * Math.log10(Math.max(mag, EPS));
  }
  return out;
}

// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { realFftDb };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
