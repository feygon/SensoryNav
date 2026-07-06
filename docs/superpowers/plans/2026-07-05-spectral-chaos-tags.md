# Spectral-Chaos Metric + Tag-Extraction Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the failed amplitude-envelope "chaos" metric with a frequency-domain spectral-tonality metric in a first-class sub-bass band, and reshape its output into a governed tag set — so an idling stop reads quiet and road texture reads chaotic.

**Architecture:** A pure DSP module (`harness/score/spectral-chaos.js`) computes, per band, per 0.25 s hop, a frequency-adaptive FFT → band level, peak-prominence tonality ∈ [0,1], and chaos = 1 − tonality. A tag layer (`harness/tags/`) detects events and emits scientifically-grounded tags (value + confidence). The offline extractor and the interactive timeline consume these; `aggregate-squelch.js` re-measures positional reproducibility.

**Tech Stack:** Node.js (zero deps), CommonJS `require`/`module.exports`. Tests are plain `node` scripts using the built-in `assert` module, ending with `console.log("<name> tests passed")`, run via `npm test` (matches `tests/score-baseline.test.js`). TDD on all `harness/` modules; `scripts/` tooling is test-light by intent.

**Spec:** `docs/superpowers/specs/2026-07-05-spectral-chaos-tags-design.md` (READY 40/45).
**Tag schema:** `docs/tags/tag-architecture.md`. **Prior code checkpoint:** commit `90b33a2`.

## Global Constraints

- **Bands + adaptive windows (48 kHz):** `subbass 20–80 Hz N=16384` · `low 80–250 Hz N=2048` · `mid 250–1000 Hz N=1024` · `high 1000–4000 Hz N=512`. Hop = 0.25 s. (5 periods for sub-bass, 3 for the rest.)
- **Tonality ∈ [0,1]** = peak-prominence HNR: `sum(band-bin power where power > localMedian × PEAK_K) ÷ sum(band-bin power)`, clamp [0,1]. **Chaos = 1 − tonality** ∈ [0,1]. `PEAK_K = 3` (single named knob, tune in Task 3).
- **Display:** `CHAOS_DISPLAY_DB = 8` (chaos × 8 → line thickness dB-ish). Hue ramp **blue→yellow (CVD-safe, never red→green)**; thickness is the redundant colour-independent channel.
- **Near-silence guard:** `BAND_SNR_MIN = 6 dB`. When a window's band level is within 6 dB of the per-run band noise floor (= p05 of that band's level over the run), OR the tonality denominator is ~0, emit `tonality` with **confidence 0**; the window cannot seed an event.
- **Event detection:** threshold = **p90** of that pass's own per-band chaos; **merge gap ≤ 0.5 s**; **max length 2.0 s** (split longer runs at the cap); **min length 0.1 s** (drop shorter unless onset-sharpness high).
- **Confidence = `reliability_factor × measure_sharpness × accel_cap`**, each ∈ [0,1]. `measure_sharpness = clamp(2·|value − 0.5|, 0, 1)` default. `accel_cap`: `none`=1.0, `disambiguates`=0.6, `required`=0.4. `reliability_factor` = pipeline window reliability: **0** if clipping ≥ 2% of samples, **0** if `near_floor`, **0** if speech-contaminated *for mid/high tags only* (sub-bass/low ignore the speech flag), else the SP2 reliability.
- **REQ-1 acceptance (make-or-break):** median sub-bass tonality(idle, speed < 0.5 m/s) − median tonality(moving-rough, speed ≥ 8 m/s) **≥ 0.15** with **non-overlapping IQRs**, AND **zero** high-chaos events during a verified idle stop.
- **Code:** each function ≤ ~100 lines; > 300 lines is a blocking defect. No new dependencies (supply-chain rule). Dark-mode, no pure-white surfaces on any rendered artifact.
- **Data contracts:** `squelch-clean.json` = `{ params:{hopSec, bands:[{key,lo,hi,N}]}, subbass:[…], low:[…], mid:[…], high:[…] }`, point = `{t, energy, level_db, tonality, chaos, peak_freqs, low_conf}`. `tags-clean.json` = `{ events:[{ t_start, t_end, lat, lon, speed_mps, tags:{ name:{value,confidence} }, accel_gaps:[…] }] }`; coords rounded to 6 dp; **no raw audio written**.

## Task index

1. Add sub-bass band to the baseline
2. FFT + adaptive-window scaffolding in spectral-chaos
3. Peak-prominence tonality
4. Per-band per-window loop + near-silence guard
5. Tag registry schema + starter records
6. Event detection
7. Tag extraction + confidence
8. Wire the extractor pipeline
9. Folded sub-bass panel + tag tooltips in the timeline
10. Reproducibility rerun
11. Make-or-break acceptance (REQ-1)

---

### Task 1: Add sub-bass band to the baseline

**Files:**
- Modify: `harness/score/baseline.js` (the `BANDS` constant, ~line 10)
- Test: `tests/score-baseline.test.js` (append a case)

**Interfaces:**
- Consumes: existing `fitBaseline(samples, params)` where each sample is `{speed, subbass, low, mid, high, reliability}`.
- Produces: `fitBaseline` fits a 4th floor; `floorAt(baseline, "subbass", speed)` and `baselineMeta(baseline).subbass` work.

- [ ] **Step 1: Write the failing test** — append to `tests/score-baseline.test.js`:

```js
// sub-bass band participates in floor fitting
const sb = [];
for (let i = 0; i < 25; i++) sb.push({ speed: 5, subbass: 2 + i * 0.04, low: 1, mid: 1, high: 1, reliability: 1 });
const bsb = fitBaseline(sb, { MIN_BIN_SAMPLES: 20 });
assert.ok(floorAt(bsb, "subbass", 5) > 1.5 && floorAt(bsb, "subbass", 5) < 2.6, `subbass floor@5=${floorAt(bsb, "subbass", 5)}`);
assert.strictEqual(baselineMeta(bsb).subbass.qualified_bins, 1);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/score-baseline.test.js`
Expected: FAIL — `baseline` does not fit `subbass` (undefined floor / missing meta key).

- [ ] **Step 3: Minimal implementation** — in `harness/score/baseline.js`:

```js
const BANDS = ["subbass", "low", "mid", "high"];
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/score-baseline.test.js`
Expected: PASS — prints `score-baseline tests passed`.

- [ ] **Step 5: Commit**

```bash
git add harness/score/baseline.js tests/score-baseline.test.js
git commit -m "feat(baseline): add sub-bass band to floor fitting"
```

---

### Task 2: FFT + adaptive-window scaffolding in spectral-chaos

**Files:**
- Create: `harness/score/spectral-chaos.js`
- Test: `tests/score-spectral-chaos.test.js`

**Interfaces:**
- Produces: `fft(re, im)` (in-place radix-2), `hann(N)` (cached), `SBANDS` = `[{key,lo,hi,N}]`, `powerSpectrum(samples, start, N)` → `Float64Array` of length `N/2` (windowed magnitude²).

- [ ] **Step 1: Write the failing test** — `tests/score-spectral-chaos.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/score-spectral-chaos.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Minimal implementation** — `harness/score/spectral-chaos.js` (FFT ported verbatim from checkpoint `90b33a2`'s `scripts/lib/squelch.js` so behavior is known):

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/score-spectral-chaos.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add harness/score/spectral-chaos.js tests/score-spectral-chaos.test.js
git commit -m "feat(spectral-chaos): FFT + adaptive-window power spectrum scaffolding"
```

---

### Task 3: Peak-prominence tonality

**Files:**
- Modify: `harness/score/spectral-chaos.js`
- Test: `tests/score-spectral-chaos.test.js` (append)

**Interfaces:**
- Produces: `tonality(power, loBin, hiBin, PEAK_K=3)` → number ∈ [0,1] (1 = tonal comb, 0 = broadband); `PEAK_K` exported constant.

- [ ] **Step 1: Write the failing test** — append:

```js
const { tonality } = require("../harness/score/spectral-chaos");
// pure tone: one dominant bin -> high tonality
const tone = new Float64Array(64).fill(0.01); tone[20] = 100;
assert.ok(tonality(tone, 5, 40) > 0.8, `tone tonality ${tonality(tone, 5, 40)} should be >0.8`);
// flat white-ish spectrum -> low tonality
const flat = new Float64Array(64); for (let k = 0; k < 64; k++) flat[k] = 1 + (k % 2) * 0.01;
assert.ok(tonality(flat, 5, 40) < 0.2, `flat tonality ${tonality(flat, 5, 40)} should be <0.2`);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/score-spectral-chaos.test.js`
Expected: FAIL — `tonality` is not a function.

- [ ] **Step 3: Minimal implementation** — add to `spectral-chaos.js` and export:

```js
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
```

Add `tonality, PEAK_K, median` to `module.exports`.

- [ ] **Step 4: Run to verify it passes** — `node tests/score-spectral-chaos.test.js` → PASS. If the tone case is < 0.8, raise the peak or lower `PEAK_K`; document the final `PEAK_K` in the module.

- [ ] **Step 5: Commit**

```bash
git add harness/score/spectral-chaos.js tests/score-spectral-chaos.test.js
git commit -m "feat(spectral-chaos): peak-prominence tonality estimator"
```

---

### Task 4: Per-band per-window loop + near-silence guard

**Files:**
- Modify: `harness/score/spectral-chaos.js`
- Test: `tests/score-spectral-chaos.test.js` (append)

**Interfaces:**
- Produces: `computeSpectralChaos(samples, fs, opts?)` → `{ params:{hopSec, bands:[{key,lo,hi,N}]}, subbass:[pt], low:[pt], mid:[pt], high:[pt] }`, `pt = {t, energy, level_db, tonality, chaos, peak_freqs, low_conf}`. `low_conf=true` when the near-silence guard fires. `peak_freqs` = up to 5 in-band peak Hz, descending by power, `[]` if none above floor.

- [ ] **Step 1: Write the failing test** — append:

```js
const { computeSpectralChaos } = require("../harness/score/spectral-chaos");
// 1.5 s of a pure 40 Hz tone at 48k -> sub-bass reads tonal, not low_conf
const fs2 = 48000, dur = 1.5, sig2 = new Float64Array(Math.round(fs2 * dur));
for (let n = 0; n < sig2.length; n++) sig2[n] = 0.3 * Math.sin(2 * Math.PI * 40 * n / fs2);
const sc = computeSpectralChaos(sig2, fs2);
assert.ok(sc.subbass.length > 0, "no sub-bass windows");
const mid = sc.subbass[Math.floor(sc.subbass.length / 2)];
assert.ok(mid.tonality > 0.6, `sub-bass tone tonality ${mid.tonality} should be >0.6`);
assert.strictEqual(mid.low_conf, false);
// silence -> low_conf true
const sil = new Float64Array(fs2 * dur);
const sc2 = computeSpectralChaos(sil, fs2);
assert.strictEqual(sc2.subbass[0].low_conf, true);
```

- [ ] **Step 2: Run to verify it fails** — `node tests/score-spectral-chaos.test.js` → FAIL (`computeSpectralChaos` undefined).

- [ ] **Step 3: Minimal implementation** — add to `spectral-chaos.js`:

```js
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
```

Add `computeSpectralChaos, BAND_SNR_MIN` to exports. Keep each function ≤ 100 lines (they are).

- [ ] **Step 4: Run to verify it passes** — `node tests/score-spectral-chaos.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add harness/score/spectral-chaos.js tests/score-spectral-chaos.test.js
git commit -m "feat(spectral-chaos): per-band window loop + near-silence guard"
```

---

### Task 5: Tag registry schema + starter records

**Files:**
- Create: `harness/tags/schema.js` (validator), `harness/tags/registry/sub-bass-ratio.json`, `.../tonality.json`, `.../level.json`, `.../onset-sharpness.json`
- Test: `tests/tags-schema.test.js`

**Interfaces:**
- Produces: `validateTag(record)` → `{ ok, errors:[] }`; `loadRegistry(dir)` → `{ name: record }`. Record fields per `docs/tags/tag-architecture.md` (name, display, domain, definition, indicators, detection, value, confidence, accel_dependency, status, discrimination_test, notes).

- [ ] **Step 1: Write the failing test** — `tests/tags-schema.test.js`:

```js
"use strict";
const assert = require("assert");
const { validateTag, loadRegistry } = require("../harness/tags/schema");
const good = { name: "tonality", display: "Tonality", domain: "harmonics", definition: "x", indicators: ["comb"], detection: { method: "peak-prominence", band: "per-band", window_samples: 16384, measure: "HNR", provenance: "spec" }, value: { type: "scalar", unit: "0-1", range: [0, 1] }, confidence: { model: "reliability×sharpness×accel", basis: "peak margin" }, accel_dependency: "none", status: "proposed", discrimination_test: { dataset: "jc4", claim: "idle>road", result: "0.78 vs 0.67" }, notes: "" };
assert.strictEqual(validateTag(good).ok, true);
assert.strictEqual(validateTag({ name: "x" }).ok, false); // missing fields
const reg = loadRegistry(require("path").join(__dirname, "..", "harness", "tags", "registry"));
assert.ok(reg["tonality"] && reg["level"], "registry missing starter tags");
console.log("tags-schema tests passed");
```

- [ ] **Step 2: Run to verify it fails** — `node tests/tags-schema.test.js` → FAIL (module + records missing).

- [ ] **Step 3: Minimal implementation** — `harness/tags/schema.js`:

```js
"use strict";
const fs = require("fs"), path = require("path");
const DOMAINS = ["acoustics", "harmonics", "automotive-physics", "psychoacoustics", "mapping"];
const ACCEL = ["none", "disambiguates", "required"];
const REQUIRED = ["name", "display", "domain", "definition", "indicators", "detection", "value", "confidence", "accel_dependency", "status", "discrimination_test"];
function validateTag(r) {
  const errors = [];
  for (const f of REQUIRED) if (r[f] == null) errors.push("missing " + f);
  if (r.domain && DOMAINS.indexOf(r.domain) < 0) errors.push("bad domain " + r.domain);
  if (r.accel_dependency && ACCEL.indexOf(r.accel_dependency) < 0) errors.push("bad accel_dependency");
  if (r.indicators && !Array.isArray(r.indicators)) errors.push("indicators must be array");
  return { ok: errors.length === 0, errors };
}
function loadRegistry(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".json")) { const rec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); out[rec.name] = rec; }
  return out;
}
module.exports = { validateTag, loadRegistry, DOMAINS, ACCEL };
```

Create the four registry JSON files with all required fields (copy the starter-tag rows from `docs/tags/tag-architecture.md`; set `status: "proposed"`, real `detection`/`indicators`, and `discrimination_test` = the stop-vs-drive numbers for `tonality`/`level`, placeholder `{dataset:"pending-82nd-ave", claim, result:"TBD"}` for `sub-bass-ratio`/`onset-sharpness`).

- [ ] **Step 4: Run to verify it passes** — `node tests/tags-schema.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add harness/tags/schema.js harness/tags/registry/*.json tests/tags-schema.test.js
git commit -m "feat(tags): registry schema + validator + starter records"
```

---

### Task 6: Event detection

**Files:**
- Create: `harness/tags/events.js`
- Test: `tests/tags-events.test.js`

**Interfaces:**
- Produces: `detectEvents(series, opts?)` where `series = [{t, chaos, ...}]`; opts default `{ pctile:0.90, mergeGapS:0.5, maxLenS:2.0, minLenS:0.1, hopS:0.25 }`. Returns `[{ i_start, i_end, t_start, t_end }]`.

- [ ] **Step 1: Write the failing test** — `tests/tags-events.test.js`:

```js
"use strict";
const assert = require("assert");
const { detectEvents } = require("../harness/tags/events");
const flat = Array.from({ length: 40 }, (_, i) => ({ t: i * 0.25, chaos: 0.1 }));
assert.strictEqual(detectEvents(flat).length, 0, "idle/flat must yield 0 events");
const burst = flat.map((p, i) => ({ t: p.t, chaos: i >= 10 && i <= 14 ? 0.9 : 0.1 }));
assert.strictEqual(detectEvents(burst).length, 1, "one burst -> one event");
// two bursts 0.75 s apart (3 hops) stay separate; 0.5 s (2 hops) merge
const two = flat.map((p, i) => ({ t: p.t, chaos: (i === 10 || i === 13) ? 0.9 : 0.1 }));
assert.strictEqual(detectEvents(two, { mergeGapS: 0.5 }).length, 2, "0.75s gap stays two");
console.log("tags-events tests passed");
```

- [ ] **Step 2: Run to verify it fails** — `node tests/tags-events.test.js` → FAIL.

- [ ] **Step 3: Minimal implementation** — `harness/tags/events.js`:

```js
"use strict";
function pct(arr, p) { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(p * (s.length - 1))] : 0; }
function detectEvents(series, opts) {
  const o = Object.assign({ pctile: 0.90, mergeGapS: 0.5, maxLenS: 2.0, minLenS: 0.1, hopS: 0.25 }, opts || {});
  const thr = pct(series.map((p) => p.chaos), o.pctile);
  const gap = Math.round(o.mergeGapS / o.hopS), maxN = Math.round(o.maxLenS / o.hopS);
  const raw = [];
  let s = -1;
  for (let i = 0; i <= series.length; i++) {
    const on = i < series.length && series[i].chaos > thr;
    if (on && s < 0) s = i;
    else if (!on && s >= 0) { raw.push([s, i - 1]); s = -1; }
  }
  const merged = [];
  for (const r of raw) {
    if (merged.length && r[0] - merged[merged.length - 1][1] <= gap) merged[merged.length - 1][1] = r[1];
    else merged.push(r.slice());
  }
  const out = [];
  for (const [a, b] of merged) {
    for (let x = a; x <= b; x += maxN) {
      const y = Math.min(b, x + maxN - 1);
      if ((y - x + 1) * o.hopS >= o.minLenS) out.push({ i_start: x, i_end: y, t_start: series[x].t, t_end: series[y].t });
    }
  }
  return out;
}
module.exports = { detectEvents };
```

- [ ] **Step 4: Run to verify it passes** — `node tests/tags-events.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add harness/tags/events.js tests/tags-events.test.js
git commit -m "feat(tags): event detection with merge/split/threshold"
```

---

### Task 7: Tag extraction + confidence

**Files:**
- Create: `harness/tags/extract.js`
- Test: `tests/tags-extract.test.js`

**Interfaces:**
- Consumes: `detectEvents` (Task 6), `loadRegistry` (Task 5), per-band series from `computeSpectralChaos` (Task 4), a per-window reliability lookup, and delta-dB level (`floorAt` from baseline).
- Produces: `confidence(value, reliability_factor, accelDep)` → number; `extractTags(event, ctx)` → `{ tags:{name:{value,confidence}}, accel_gaps:[] }`, where `ctx` bundles the band series slices + reliability + registry.

- [ ] **Step 1: Write the failing test** — `tests/tags-extract.test.js`:

```js
"use strict";
const assert = require("assert");
const { confidence } = require("../harness/tags/extract");
// accel caps
assert.ok(Math.abs(confidence(0.5, 1, "none") - 1.0) < 1e-9);      // sharpness at midpoint = 0? -> see formula
assert.ok(Math.abs(confidence(1.0, 1, "none") - 1.0) < 1e-9);      // decisive value, no cap
assert.ok(Math.abs(confidence(1.0, 1, "required") - 0.4) < 1e-9);  // required caps at 0.4
assert.strictEqual(confidence(1.0, 0, "none"), 0);                  // zero reliability -> 0
console.log("tags-extract confidence tests passed");
```

*(Note: `measure_sharpness = clamp(2·|value−0.5|,0,1)`, so `confidence(0.5,1,"none")` = 0. Fix the first assertion to expect `0` before running — it documents that a midpoint value is maximally uncertain.)*

- [ ] **Step 2: Correct the test** — change the first assertion to `assert.strictEqual(confidence(0.5, 1, "none"), 0);` then run: `node tests/tags-extract.test.js` → FAIL (module undefined).

- [ ] **Step 3: Minimal implementation** — `harness/tags/extract.js`:

```js
"use strict";
const ACCEL_CAP = { none: 1.0, disambiguates: 0.6, required: 0.4 };
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function confidence(value, reliabilityFactor, accelDep) {
  const sharp = clamp01(2 * Math.abs(value - 0.5));
  return clamp01(reliabilityFactor) * sharp * (ACCEL_CAP[accelDep] != null ? ACCEL_CAP[accelDep] : 1.0);
}
// extractTags: for each registry tag, read its detection band/measure from ctx and emit {value,confidence}.
// value sources per starter tag: tonality -> ctx.subbass median tonality over the event; chaos not a tag;
// sub-bass-ratio -> subbass energy / (subbass+low+mid+high energy); level -> delta-dB (event median
// level_db - floorAt(subbass,speed)) normalised by a LEVEL_NORM_DB (e.g. 20) into [0,1]; onset-sharpness
// -> normalised attack slope of the event's chaos rise; speech-contaminated -> 1 if speech flag set.
function extractTags(event, ctx) {
  const tags = {}, accel_gaps = [];
  for (const name in ctx.registry) {
    const rec = ctx.registry[name];
    const v = ctx.valueFor(name, event); // ctx supplies the per-tag value calc (keeps this fn small)
    if (v == null) continue;
    const relTag = ctx.reliabilityFor(name, event);
    tags[name] = { value: +v.toFixed(3), confidence: +confidence(v, relTag, rec.accel_dependency).toFixed(3) };
    if (rec.accel_dependency !== "none") accel_gaps.push(name);
  }
  return { tags, accel_gaps };
}
module.exports = { confidence, extractTags, ACCEL_CAP };
```

`ctx.valueFor(name, event)` and `ctx.reliabilityFor(name, event)` are provided by the extractor (Task 8) so per-tag math lives beside the data and `extractTags` stays generic and ≤ 100 lines. Reliability for mid/high tags multiplies in the speech flag; sub-bass/low ignore it.

- [ ] **Step 4: Run to verify it passes** — `node tests/tags-extract.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add harness/tags/extract.js tests/tags-extract.test.js
git commit -m "feat(tags): confidence model + generic tag extraction"
```

---

### Task 8: Wire the extractor pipeline

**Files:**
- Modify: `scripts/squelch-extract.js` (rewrite to use `computeSpectralChaos` + tags)
- No unit test (scripts are test-light); verified by Task 11's acceptance run.

**Interfaces:**
- Consumes: `computeSpectralChaos`, `fitBaseline`/`floorAt`, `detectEvents`, `extractTags`, `loadRegistry`, existing `windowReliability`, the speech detector from checkpoint `90b33a2`.
- Produces: `out/score-<pass>/squelch-clean.json` + `out/score-<pass>/tags-clean.json` per the data contracts.

- [ ] **Step 1: Rewrite `scripts/squelch-extract.js`** to: decode WAV → `computeSpectralChaos` → build baseline samples `{speed, subbass:energy, low, mid, high, reliability}` (subbass energy from `computeSpectralChaos`, low/mid/high from the existing STFT windows) → `fitBaseline` → per-event `extractTags` via a `ctx` whose `valueFor` implements the starter-tag math (Task 7 comment) → write both JSON files. Map event `t` → nearest scored window for `lat/lon/speed_mps` (round coords to 6 dp).

- [ ] **Step 2: Run on jc4**

Run: `MSYS_NO_PATHCONV=1 node scripts/squelch-extract.js data/johnson-creek-pass-4-181806.json out/score-jc4`
Expected: prints subbass/low/mid/high point counts + event count; writes both JSONs.

- [ ] **Step 3: Sanity-check output**

Run: `node -e "const t=require('./out/score-jc4/tags-clean.json'); console.log('events', t.events.length, 'sample tags', JSON.stringify(t.events[0]&&t.events[0].tags))"`
Expected: a plausible event list with `tonality`/`level`/`sub-bass-ratio` tags carrying `{value,confidence}`.

- [ ] **Step 4: Commit**

```bash
git add scripts/squelch-extract.js
git commit -m "feat(extract): spectral chaos + tags pipeline -> squelch/tags JSON"
```

---

### Task 9: Folded sub-bass panel + tag tooltips in the timeline

**Files:**
- Modify: `scripts/plot-timeline.js`
- No unit test; verified visually + Task 11.

**Interfaces:**
- Consumes: `squelch-clean.json` (via a `squelch=` flag) + `tags-clean.json` (via a `tags=` flag).
- Produces: a folded sub-bass panel above the low panel; event marks with tag tooltips.

- [ ] **Step 1:** Load `tags-clean.json` (guard absent → no event marks, no error). Replace the amplitude-chaos ribbon `chaosRibbon` with the **folded line**: per sub-bass point draw the level line over the dashed baseline with delta shading, colour the line segment by tonality on a **blue→yellow** ramp and set stroke-width from `chaos × CHAOS_DISPLAY_DB`. Place the sub-bass panel **above** the low panel; low/mid/high keep the delta-dB level view (no chaos line).

- [ ] **Step 2:** Render event marks on the sub-bass + main panels; on hover show a tooltip listing the event's tags as `name value·conf` with an accelerometer-gap note where `accel_gaps` includes the tag. Reuse the existing `#tt` tooltip div + hover machinery. Dark-mode, no pure-white; keep `<tspan>` (never `<b>`/`<i>`) inside SVG `<text>` (the foreign-content bug from `90b33a2`).

- [ ] **Step 3: Regenerate jc4 and verify**

Run: `MSYS_NO_PATHCONV=1 node scripts/plot-timeline.js out/score-jc4/scored-clean.json out/score/timeline-jc4.html "JC4" /data/johnson-creek-pass-4-181806.wav out/score-jc4/highres-clean.json bands "squelch=out/score-jc4/squelch-clean.json" "tags=out/score-jc4/tags-clean.json"`
Then: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8137/out/score/timeline-jc4.html` → `200`; confirm the folded sub-bass panel renders and speed/roughness lines are present (no SVG truncation).

- [ ] **Step 4: Commit**

```bash
git add scripts/plot-timeline.js
git commit -m "feat(timeline): folded sub-bass chaos panel + tag tooltips"
```

---

### Task 10: Reproducibility rerun

**Files:**
- Modify: `scripts/aggregate-squelch.js` (read `tonality`/`chaos` from the new `squelch-clean.json` shape)
- No unit test.

- [ ] **Step 1:** Re-extract all 5 JC passes + hwy26 (`for each: node scripts/squelch-extract.js <sidecar> <outDir>`).
- [ ] **Step 2:** Update `aggregate-squelch.js` to read the new per-point `chaos` (and add a sub-bass option) and run ICC. Run `node scripts/aggregate-squelch.js 25 subbass`.
- [ ] **Step 3:** Record the ICC next to the delta-dB 0.63 baseline (REQ-2 — documenting, not gating).
- [ ] **Step 4: Commit**

```bash
git add scripts/aggregate-squelch.js
git commit -m "feat(aggregate): reproducibility rerun on spectral chaos"
```

---

### Task 11: Make-or-break acceptance (REQ-1)

**Files:**
- Create: `scripts/verify-stop-quiet.js` (acceptance harness)
- Test: this IS the acceptance test.

**Interfaces:**
- Consumes: `out/score-jc4/squelch-clean.json` + `out/score-jc4/scored-clean.json` (speed) + `out/score-jc4/tags-clean.json`.

- [ ] **Step 1: Write `scripts/verify-stop-quiet.js`** that joins sub-bass tonality to speed, computes median tonality for idle (speed < 0.5) and moving-rough (speed ≥ 8), asserts `idle − rough ≥ 0.15` AND non-overlapping IQRs AND that the event detector yields 0 events during a verified idle stop window. Print PASS/FAIL with the numbers.

- [ ] **Step 2: Run it**

Run: `node scripts/verify-stop-quiet.js out/score-jc4`
Expected: `REQ-1 PASS` with the tonality gap ≥ 0.15 and idle events = 0. If FAIL, tune `PEAK_K` / the sub-bass window (3 vs 5 periods, 8192 vs 16384) per the spec Open Questions and re-run; do not proceed until it passes or the failure is escalated.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-stop-quiet.js
git commit -m "test(accept): REQ-1 make-or-break stop-goes-quiet harness"
```

---

## Self-Review

**Spec coverage:** REQ-1 → Task 11; REQ-2 → Task 10; REQ-3 (tags) → Tasks 5–8; REQ-4 (folded display) → Task 9; REQ-5 (event detection) → Task 6. Sub-bass baseline → Task 1; adaptive-window metric → Tasks 2–4; near-silence guard → Task 4; confidence model → Task 7; tag registry + methodology → Task 5 (+ `docs/tags/tag-architecture.md`). Build order matches the spec's dependency chain. Deferred (classifier/aggregator/dashboard/accelerometer/privacy pipeline) correctly absent.

**Placeholder scan:** the two spots that read like placeholders are deliberate and named: `ctx.valueFor`/`ctx.reliabilityFor` are a real seam (per-tag math lives in Task 8 beside the data, keeping `extractTags` generic) and Task 8 Step 1 enumerates the exact per-tag value formulas; the `LEVEL_NORM_DB`/`sub-bass-ratio` maths are stated. `PEAK_K` and the 3-vs-5-period window are named tunables resolved empirically in Tasks 3/11 (per spec Open Questions), not vague TODOs.

**Type consistency:** `computeSpectralChaos` point shape `{t,energy,level_db,tonality,chaos,peak_freqs,low_conf}` is used identically in Tasks 4, 8, 9, 11. `detectEvents` returns `{i_start,i_end,t_start,t_end}` consumed in Tasks 7/8. `confidence(value, reliabilityFactor, accelDep)` signature matches between Tasks 7 and 8. `SBANDS` keys (`subbass/low/mid/high`) match `baseline.js` BANDS (Task 1) and the data contracts.
