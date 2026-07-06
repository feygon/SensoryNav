// scripts/lib/squelch.js
// Shared aperiodic-chaos "squelch" DSP so the timeline ribbon and the cross-pass aggregation
// measure the SAME thing. Band-limit the raw audio, take each band's amplitude envelope at a
// band-specific squelch timescale tau, and over a sliding window split the PERIODIC rhythm
// (engine/tonal — habituated) from the APERIODIC chaos (road — novel) via envelope
// autocorrelation. Amplitude chaos only; carrier-frequency wobble is a separate metric.
"use strict";

const EPS = 1e-12;
const DEFAULTS = { WIN_SEC: 1.0, HOP_SEC: 0.25 };
// tau floors at each band's carrier period — you can't have amplitude structure faster than
// the sound carrying it (low 80 Hz -> 12.5 ms, mid 250 -> 4 ms, high 1000 -> 1 ms).
const BANDS = [
  { key: "low", lo: 80, hi: 250, tau: 1 / 80 },
  { key: "mid", lo: 250, hi: 1000, tau: 1 / 250 },
  { key: "high", lo: 1000, hi: 4000, tau: 1 / 1000 }
];

// RBJ biquad (Direct Form I) cascaded into a ~24 dB/oct bandpass.
function biquad(type, f0, fs, Q) {
  const w0 = 2 * Math.PI * f0 / fs, c = Math.cos(w0), s = Math.sin(w0), alpha = s / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha; }
  else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha; }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}
function step(st, x) {
  const y = st.b0 * x + st.b1 * st.x1 + st.b2 * st.x2 - st.a1 * st.y1 - st.a2 * st.y2;
  st.x2 = st.x1; st.x1 = x; st.y2 = st.y1; st.y1 = y; return y;
}
function bandpass(samples, fs, fLo, fHi) {
  const Q = 0.7071;
  const chain = [biquad("hp", fLo, fs, Q), biquad("hp", fLo, fs, Q), biquad("lp", fHi, fs, Q), biquad("lp", fHi, fs, Q)];
  const out = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) { let v = samples[i]; for (let s = 0; s < chain.length; s++) v = step(chain[s], v); out[i] = v; }
  return out;
}

// Per sliding window: band level (center, dB), envelope spread (dB), periodicity (max envelope
// autocorrelation = rhythm strength), and chaos = the aperiodic part of the spread.
function analyzeBand(xb, fs, tau, winSec, hopSec) {
  const blk = Math.max(1, Math.round(tau * fs));
  const winN = Math.round(winSec * fs), hopN = Math.round(hopSec * fs);
  const lagMax = Math.max(2, Math.round(0.2 / tau)); // rhythms with period up to 200 ms
  const pts = [];
  for (let w0 = 0; w0 + winN <= xb.length; w0 += hopN) {
    const e = [];
    for (let b = w0; b + blk <= w0 + winN; b += blk) {
      let ss = 0; for (let i = b; i < b + blk; i++) ss += xb[i] * xb[i];
      e.push(10 * Math.log10(ss / blk + EPS));
    }
    const n = e.length; if (n < 8) continue;
    let mean = 0; for (let i = 0; i < n; i++) mean += e[i]; mean /= n;
    const d = new Array(n); let r0 = 0;
    for (let i = 0; i < n; i++) { d[i] = e[i] - mean; r0 += d[i] * d[i]; }
    const spread = Math.sqrt(r0 / n);
    let P = 0;
    for (let L = 1; L <= lagMax && L < n; L++) { let s = 0; for (let i = 0; i + L < n; i++) s += d[i] * d[i + L]; const rr = s / (r0 || 1); if (rr > P) P = rr; }
    P = P < 0 ? 0 : P > 1 ? 1 : P;
    let ps = 0; for (let i = w0; i < w0 + winN; i++) ps += xb[i] * xb[i];
    pts.push({ t: +(w0 / fs + winSec / 2).toFixed(3), c: +(10 * Math.log10(ps / winN + EPS)).toFixed(2), spread: +spread.toFixed(2), per: +P.toFixed(3), chaos: +(spread * (1 - P)).toFixed(2) });
  }
  return pts;
}

function computeSquelch(samples, fs, opts) {
  const p = Object.assign({}, DEFAULTS, opts || {});
  const out = { params: { winSec: p.WIN_SEC, hopSec: p.HOP_SEC, bands: BANDS.map((b) => ({ key: b.key, lo: b.lo, hi: b.hi, tau: b.tau })) } };
  for (const b of BANDS) out[b.key] = analyzeBand(bandpass(samples, fs, b.lo, b.hi), fs, b.tau, p.WIN_SEC, p.HOP_SEC);
  return out;
}

// ---- v2: spectral-tonality chaos (frequency stability, NOT amplitude swing) ----
// Chaos = spectral flatness within the band: a tonal/harmonic spectrum (engine, flywheel-
// steadied) reads flat≈0 → periodic → low chaos; a broadband/shifting spectrum (cracks, seams,
// gravel) reads flat→1 → high chaos. Window length is frequency-adaptive so the harmonic comb
// is resolvable at each band's low edge (~3 periods): low 8192, mid 2048, high 1024 samples.
const SBANDS = [
  { key: "subbass", lo: 20, hi: 80, N: 8192 }, // engine firing fundamental + low harmonics live here
  { key: "low", lo: 80, hi: 250, N: 8192 },
  { key: "mid", lo: 250, hi: 1000, N: 2048 },
  { key: "high", lo: 1000, hi: 4000, N: 1024 }
];
const FLAT_TO_DB = 6; // maps spectral flatness (0..1) to a dB-ish ribbon width for display

// In-place iterative radix-2 FFT (arbitrary power-of-two length).
function fftInPlace(re, im) {
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

function spectralBand(samples, fs, lo, hi, N, hopN) {
  const w = hann(N), half = N >> 1;
  const loBin = Math.max(1, Math.floor(lo * N / fs)), hiBin = Math.min(half - 1, Math.ceil(hi * N / fs));
  const pts = [];
  for (let k = 0; ; k++) {
    const center = k * hopN, start = center - half;
    if (start < 0) continue;
    if (start + N > samples.length) break;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let n = 0; n < N; n++) re[n] = samples[start + n] * w[n];
    fftInPlace(re, im);
    let sumP = 0, sumLog = 0, cnt = 0;
    for (let b = loBin; b <= hiBin; b++) { const p = re[b] * re[b] + im[b] * im[b] + 1e-20; sumP += p; sumLog += Math.log(p); cnt++; }
    const arith = sumP / cnt, flat = Math.exp(sumLog / cnt) / arith; // 0 tonal .. 1 white-noise flat
    pts.push({ t: +(center / fs).toFixed(3), c: +(10 * Math.log10(arith / (N * N) + 1e-12)).toFixed(2), per: +(1 - flat).toFixed(3), chaos: +(flat * FLAT_TO_DB).toFixed(2) });
  }
  return pts;
}
function computeSpectralChaos(samples, fs, opts) {
  const hopSec = (opts && opts.hopSec) || 0.25, hopN = Math.round(hopSec * fs);
  const out = { params: { hopSec, method: "spectral-flatness", bands: SBANDS.map((b) => ({ key: b.key, lo: b.lo, hi: b.hi, N: b.N })) } };
  for (const b of SBANDS) out[b.key] = spectralBand(samples, fs, b.lo, b.hi, b.N, hopN);
  return out;
}

module.exports = { computeSquelch, computeSpectralChaos, bandpass, analyzeBand, BANDS, SBANDS };
