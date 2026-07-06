"use strict";
const SBANDS = [
  { key: "subbass", lo: 20, hi: 80, N: 16384 },
  { key: "low", lo: 80, hi: 250, N: 2048 },
  { key: "mid", lo: 250, hi: 1000, N: 1024 },
  { key: "high", lo: 1000, hi: 4000, N: 512 }
];
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = cwr * re[b] - cwi * im[b], ti = cwr * im[b] + cwi * re[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = ncwr;
      }
    }
  }
}
const HANN = {};
function hann(N) { if (HANN[N]) return HANN[N]; const w = new Float64Array(N); for (let n = 0; n < N; n++) w[n] = 0.5 * (1 - Math.cos(2 * Math.PI * n / (N - 1))); return (HANN[N] = w); }
function powerSpectrum(samples, start, N) {
  const w = hann(N), re = new Float64Array(N), im = new Float64Array(N);
  for (let n = 0; n < N; n++) re[n] = (samples[start + n] || 0) * w[n];
  fft(re, im);
  const half = N >> 1, out = new Float64Array(half);
  for (let k = 0; k < half; k++) out[k] = re[k] * re[k] + im[k] * im[k];
  return out;
}
module.exports = { fft, hann, powerSpectrum, SBANDS };
