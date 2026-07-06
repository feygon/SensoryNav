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
// PEAK_K = 3: a band-bin counts as "peak" energy once it exceeds 3x the
// band's median power. Tuned against the pure-tone/flat-spectrum fixtures
// in tests/score-spectral-chaos.test.js (tone > 0.8, flat < 0.2).
const PEAK_K = 3;
function median(arr) { const s = Array.prototype.slice.call(arr).sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; }
function tonality(power, loBin, hiBin, k) {
  k = k || PEAK_K;
  const band = [];
  for (let b = loBin; b <= hiBin; b++) band.push(power[b] || 0);
  const total = band.reduce((s, x) => s + x, 0);
  if (total <= 0) return 0;
  const floor = median(band) * k;
  let peak = 0;
  for (const p of band) if (p > floor) peak += p;
  const t = peak / total;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
const BAND_SNR_MIN = 6, EPS = 1e-12;
function bandLoHi(band, fs, N) { return [Math.max(1, Math.floor(band.lo * N / fs)), Math.min((N >> 1) - 1, Math.ceil(band.hi * N / fs))]; }
function peakFreqs(power, loBin, hiBin, k, fs, N) {
  const floor = median(Array.prototype.slice.call(power, loBin, hiBin + 1)) * k, peaks = [];
  for (let b = loBin; b <= hiBin; b++) if (power[b] > floor) peaks.push([power[b], b * fs / N]);
  return peaks.sort((a, b) => b[0] - a[0]).slice(0, 5).map((p) => +p[1].toFixed(1));
}
function bandSeries(samples, fs, band, hopN) {
  const N = band.N, half = N >> 1, [loBin, hiBin] = bandLoHi(band, fs, N), pts = [];
  for (let c = 0; ; c++) {
    const center = c * hopN, start = center - half;
    if (start < 0) continue;
    if (start + N > samples.length) break;
    const power = powerSpectrum(samples, start, N);
    let energy = 0; for (let b = loBin; b <= hiBin; b++) energy += power[b];
    energy /= (hiBin - loBin + 1);
    const level_db = 10 * Math.log10(energy / (N * N) + EPS);
    const t = tonality(power, loBin, hiBin);
    pts.push({ t: +(center / fs).toFixed(3), energy, level_db: +level_db.toFixed(2), tonality: +t.toFixed(3), chaos: +(1 - t).toFixed(3), peak_freqs: peakFreqs(power, loBin, hiBin, PEAK_K, fs, N), low_conf: false });
  }
  // per-run noise floor = p05 of level_db; mark near-silence
  const levels = pts.map((p) => p.level_db).sort((a, b) => a - b);
  const floor = levels.length ? levels[Math.floor(0.05 * (levels.length - 1))] : -Infinity;
  for (const p of pts) if (p.level_db - floor < BAND_SNR_MIN) p.low_conf = true;
  return pts;
}
function computeSpectralChaos(samples, fs, opts) {
  const hopSec = (opts && opts.hopSec) || 0.25, hopN = Math.round(hopSec * fs);
  const out = { params: { hopSec, bands: SBANDS.map((b) => ({ key: b.key, lo: b.lo, hi: b.hi, N: b.N })) } };
  for (const b of SBANDS) out[b.key] = bandSeries(samples, fs, b, hopN);
  return out;
}
module.exports = { fft, hann, powerSpectrum, SBANDS, tonality, PEAK_K, median, computeSpectralChaos, BAND_SNR_MIN };
