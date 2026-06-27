# SensoryNav Harness SP1 — Audio Front-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the offline audio front-end (SP1) that decodes a captured `.wav` into a deterministic per-second window series of band energies + RMS + audio-quality flags, ready for the deferred SP2/SP3 stages.

**Architecture:** Four pure, node-tested modules under `harness/audio/` — a canonical-WAV decoder, a Hann-windowed radix-2 FFT producing a dB spectrum, a windowing orchestrator, and a thin disk loader — composed over the existing `recorder/` scoring core (`constants.js`, `audio-scoring.js`). No browser code; node-only (`module.exports`).

**Tech Stack:** Vanilla JS, no dependencies, Node `assert` test scripts. Reuses `recorder/constants.js`, `recorder/audio-scoring.js`, and (in tests) `recorder/wav-encoder.js`.

**Spec:** `docs/superpowers/specs/2026-06-27-sensorynav-harness-sp1-audio-frontend-design.md` (READY, 44/45).

## Global Constraints

Copied from the spec; every task implicitly includes these.

- **No dependencies.** Vanilla JS only; Node `fs` is the only built-in used (in the loader).
- **Node-only modules.** These never load in a browser, so use plain `module.exports = { ... }` — NOT the `window.SensoryNavCore` dual-export pattern. (The browser-scope collision risk that affects `recorder/` does not apply here.)
- **dB convention:** `realFftDb` returns `20·log10(max(|X_k|/FFT_SIZE, EPS))` for bins `0 … FFT_SIZE/2 − 1` (DC included, Nyquist excluded). `EPS = 1e-9` guards `log10(0)` and is independent of `ENERGY_FLOOR_MIN`. This feeds `bandEnergiesFromSpectrum`, whose `10^(dB/10)` recovers linear power (`mag²`).
- **Framing:** frame size `FFT_SIZE` (2048), Hann window, hop `FFT_SIZE/2` (1024, 50 % overlap). Any trailing slice shorter than `FFT_SIZE` is dropped.
- **Window math uses `samplesPerWindow = round(sampleRate · WINDOW_DURATION_MS / 1000)`** — never bare "whole seconds". `windowIndex = floor(frameCenterSample / samplesPerWindow)`. Correct for any `WINDOW_DURATION_MS`.
- **`started_at_ms = audio_first_frame_ms + windowIndex · WINDOW_DURATION_MS`.**
- **Output array is contiguous** (indices `0…last`, no gaps); zero-frame windows are still emitted (`frame_count = 0`, zero energies); only a trailing partial window with `< 0.5 s` (`PARTIAL_MIN_COVERAGE_S`) coverage is dropped.
- **`duration_ms`** = `WINDOW_DURATION_MS` for full windows, `round(windowSampleCount / sampleRate · 1000)` for a kept partial trailing window.
- **`clip_fraction`** denominator is **that window's own sample count**, not `samplesPerWindow`. `CLIP_THRESHOLD = 0.999`.
- **`near_floor`** = `max(low,mid,high) < NEAR_FLOOR_K · ENERGY_FLOOR_MIN`, `NEAR_FLOOR_K = 10` (a flagged default to calibrate later).
- **int16 → float** (decoder) is the inverse of the encoder's asymmetric rule: `sample = int16 < 0 ? int16/0x8000 : int16/0x7fff`.
- **Function size:** ~100 lines/function target, 300 hard limit. `framesToWindows` decomposes into `windowIndexFor`, `stft`, `assignFramesToWindows`, `windowRmsAndClip`.

---

## File Structure

- Create: `harness/audio/wav-decoder.js` — `decodeWav(bytes)` → `{ sampleRate, channels, bitDepth, sampleCount, samples }`.
- Create: `harness/audio/fft.js` — `realFftDb(frame)` → `Float32Array(1024)` dB spectrum.
- Create: `harness/audio/audio-windows.js` — `framesToWindows(samples, sampleRate, audioFirstFrameMs)` + helpers.
- Create: `harness/audio/load-pass.js` — `loadPass(wavPath, sidecarPath)` → `{ windows, sampleRate, warnings }`.
- Test: `tests/wav-decoder.test.js`, `tests/fft.test.js`, `tests/audio-windows.test.js`, `tests/load-pass.test.js`.
- Modify: `package.json` — append each test to the `test` script.

## Orchestration (static delegation calculus — Planner)

| Tasks | Delegation | Model | Bloat | Must-inline | Tier-2 |
|---|---|---|---|---|---|
| 1–4 | `subagent` | `sonnet` (user rule: never haiku for code) | low | no | no |

Sequential (each appends to `package.json`). All four gate on green node tests. Checkpoint: after Task 4 run the full `npm test`.

---

### Task 1: WAV decoder

**Files:**
- Create: `harness/audio/wav-decoder.js`
- Test: `tests/wav-decoder.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `decodeWav(bytes)` where `bytes` is a `Uint8Array`/`Buffer`; returns `{ sampleRate, channels, bitDepth, sampleCount, samples }` with `samples` a `Float32Array`. Throws an `Error` with a specific message on any header deviation.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/wav-decoder.test.js
"use strict";
const assert = require("assert");
const { encodeWav } = require("../recorder/wav-encoder");
const { decodeWav } = require("../harness/audio/wav-decoder");

// Round-trip: encode known samples, decode, recover within int16 quantization.
function check(sampleRate) {
  const input = [0, 0.5, -0.5, 1.0, -1.0];
  const wav = encodeWav([Float32Array.from(input)], input.length, sampleRate);
  const decoded = decodeWav(wav);
  assert.strictEqual(decoded.sampleRate, sampleRate);
  assert.strictEqual(decoded.channels, 1);
  assert.strictEqual(decoded.bitDepth, 16);
  assert.strictEqual(decoded.sampleCount, input.length);
  for (let i = 0; i < input.length; i++) {
    assert.ok(Math.abs(decoded.samples[i] - input[i]) < 1e-4,
      `sample ${i}: ${decoded.samples[i]} vs ${input[i]}`);
  }
}
check(48000);
check(44100);

// Malformed headers throw specific messages.
const good = encodeWav([Float32Array.from([0, 0])], 2, 48000);
function corrupt(mutate) {
  const b = good.slice();
  mutate(new DataView(b.buffer), b);
  return b;
}
assert.throws(() => decodeWav(corrupt((v, b) => { b[0] = 0x58; })), /RIFF/);
assert.throws(() => decodeWav(corrupt((v) => v.setUint16(20, 3, true))), /PCM/);
assert.throws(() => decodeWav(corrupt((v) => v.setUint16(22, 2, true))), /mono/);
assert.throws(() => decodeWav(corrupt((v) => v.setUint16(34, 24, true))), /16-bit/);
assert.throws(() => decodeWav(corrupt((v) => v.setUint32(40, 0xffffff, true))), /exceeds|truncated/);
assert.throws(() => decodeWav(new Uint8Array(10)), /header/);

console.log("wav-decoder tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/wav-decoder.test.js`
Expected: FAIL with "Cannot find module '../harness/audio/wav-decoder'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// harness/audio/wav-decoder.js
"use strict";

function readAscii(view, offset, length) {
  let s = "";
  for (let i = 0; i < length; i++) {
    s += String.fromCharCode(view.getUint8(offset + i));
  }
  return s;
}

function decodeWav(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.byteLength < 44) {
    throw new Error("unsupported WAV: file shorter than 44-byte header");
  }
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (readAscii(view, 0, 4) !== "RIFF") throw new Error("unsupported WAV: missing RIFF");
  if (readAscii(view, 8, 4) !== "WAVE") throw new Error("unsupported WAV: missing WAVE");
  if (readAscii(view, 12, 4) !== "fmt ") throw new Error("unsupported WAV: missing fmt ");
  if (view.getUint16(20, true) !== 1) throw new Error("unsupported WAV: expected PCM");
  const channels = view.getUint16(22, true);
  if (channels !== 1) throw new Error("unsupported WAV: expected mono");
  const sampleRate = view.getUint32(24, true);
  const bitDepth = view.getUint16(34, true);
  if (bitDepth !== 16) throw new Error("unsupported WAV: expected 16-bit");
  if (readAscii(view, 36, 4) !== "data") throw new Error("unsupported WAV: missing data chunk at offset 36");
  const dataSize = view.getUint32(40, true);
  if (44 + dataSize > u8.byteLength) {
    throw new Error("unsupported WAV: data size exceeds file length (truncated)");
  }
  const sampleCount = Math.floor(dataSize / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const int16 = view.getInt16(44 + i * 2, true);
    samples[i] = int16 < 0 ? int16 / 0x8000 : int16 / 0x7fff;
  }
  return { sampleRate, channels, bitDepth, sampleCount, samples };
}

module.exports = { decodeWav };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/wav-decoder.test.js`
Expected: PASS, prints "wav-decoder tests passed".

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/wav-decoder.test.js` to the `test` script.

- [ ] **Step 6: Commit**

```bash
git add harness/audio/wav-decoder.js tests/wav-decoder.test.js package.json
git commit -m "feat(harness): add canonical WAV decoder (SP1)"
```

---

### Task 2: Hann-windowed FFT → dB spectrum

**Files:**
- Create: `harness/audio/fft.js`
- Test: `tests/fft.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `recorder/constants.js` (`CONSTANTS.FFT_SIZE`), `recorder/audio-scoring.js` (`bandEnergiesFromSpectrum`) — the latter only in the test.
- Produces: `realFftDb(frame)` — `frame` is a `Float32Array` of length `FFT_SIZE`; returns a `Float32Array` of length `FFT_SIZE/2` (1024) of dB magnitudes. Throws if `frame.length !== FFT_SIZE`.

- [ ] **Step 1: Write the failing test**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/fft.test.js`
Expected: FAIL with "Cannot find module '../harness/audio/fft'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// harness/audio/fft.js
"use strict";
const { CONSTANTS } = require("../../recorder/constants");

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

module.exports = { realFftDb };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/fft.test.js`
Expected: PASS, prints "fft tests passed".

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/fft.test.js` to the `test` script.

- [ ] **Step 6: Commit**

```bash
git add harness/audio/fft.js tests/fft.test.js package.json
git commit -m "feat(harness): add Hann-windowed FFT dB spectrum (SP1)"
```

---

### Task 3: Windowing orchestrator

**Files:**
- Create: `harness/audio/audio-windows.js`
- Test: `tests/audio-windows.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `realFftDb` (Task 2); `recorder/audio-scoring.js` (`bandEnergiesFromSpectrum`, `averageWindowEnergies`); `recorder/constants.js`.
- Produces:
  - `windowIndexFor(frameCenterSample, samplesPerWindow)` → integer window index.
  - `framesToWindows(samples, sampleRate, audioFirstFrameMs)` → `Array<{ window_id, started_at_ms, duration_ms, frame_count, low_energy, mid_energy, high_energy, rms, clip_fraction, near_floor }>`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/audio-windows.test.js
"use strict";
const assert = require("assert");
const { framesToWindows, windowIndexFor } = require("../harness/audio/audio-windows");

const SR = 48000;
function tone(freq, durationS) {
  const n = Math.round(durationS * SR);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.sin((2 * Math.PI * freq * i) / SR);
  return s;
}

// windowIndexFor is parameterized by samplesPerWindow (not hardcoded to seconds).
assert.strictEqual(windowIndexFor(0, 100), 0);
assert.strictEqual(windowIndexFor(99, 100), 0);
assert.strictEqual(windowIndexFor(100, 100), 1);
assert.strictEqual(windowIndexFor(250, 100), 2);

// 2 s mid-tone -> exactly 2 windows, mid dominates, timestamps anchored, frames present.
const w = framesToWindows(tone(500, 2), SR, 1000);
assert.strictEqual(w.length, 2);
assert.strictEqual(w[0].window_id, "w0");
assert.strictEqual(w[1].window_id, "w1");
assert.strictEqual(w[0].started_at_ms, 1000);
assert.strictEqual(w[1].started_at_ms, 2000);
assert.strictEqual(w[0].duration_ms, 1000);
assert.ok(w[0].frame_count > 0 && w[1].frame_count > 0);
assert.ok(w[0].mid_energy > w[0].low_energy * 10 && w[0].mid_energy > w[0].high_energy * 10);

// Silence -> near_floor, rms 0.
const sil = framesToWindows(new Float32Array(2 * SR), SR, 0);
assert.strictEqual(sil.length, 2);
assert.strictEqual(sil[0].near_floor, true);
assert.strictEqual(sil[0].rms, 0);

// Full-scale constant -> clip_fraction 1, rms 1.
const clip = framesToWindows(new Float32Array(2 * SR).fill(1), SR, 0);
assert.strictEqual(clip[0].clip_fraction, 1);
assert.ok(Math.abs(clip[0].rms - 1) < 1e-9);

// 2.4 s -> trailing 0.4 s dropped (< 0.5 s) -> 2 windows.
assert.strictEqual(framesToWindows(tone(500, 2.4), SR, 0).length, 2);

// 2.6 s -> 2 full + 1 kept partial, duration_ms exactly 600.
const part = framesToWindows(tone(500, 2.6), SR, 0);
assert.strictEqual(part.length, 3);
assert.strictEqual(part[2].duration_ms, 600);
assert.ok(part[2].frame_count > 0);

// Sub-frame audio -> empty array.
assert.strictEqual(framesToWindows(new Float32Array(1000), SR, 0).length, 0);

// Contiguity: window_id sequence is w0,w1,... with no gaps.
for (let i = 0; i < part.length; i++) assert.strictEqual(part[i].window_id, "w" + i);

console.log("audio-windows tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/audio-windows.test.js`
Expected: FAIL with "Cannot find module '../harness/audio/audio-windows'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// harness/audio/audio-windows.js
"use strict";
const { CONSTANTS } = require("../../recorder/constants");
const { bandEnergiesFromSpectrum, averageWindowEnergies } = require("../../recorder/audio-scoring");
const { realFftDb } = require("./fft");

const FFT_SIZE = CONSTANTS.FFT_SIZE;                 // 2048
const HOP = FFT_SIZE / 2;                            // 1024
const WINDOW_DURATION_MS = CONSTANTS.WINDOW_DURATION_MS; // 1000
const ENERGY_FLOOR_MIN = CONSTANTS.ENERGY_FLOOR_MIN;     // 1e-6
const CLIP_THRESHOLD = 0.999;
const NEAR_FLOOR_K = 10;
const PARTIAL_MIN_COVERAGE_S = 0.5;

function windowIndexFor(frameCenterSample, samplesPerWindow) {
  return Math.floor(frameCenterSample / samplesPerWindow);
}

// STFT: per full frame, the band energies and the frame's center sample.
function stft(samples, sampleRate) {
  const frames = [];
  for (let start = 0; start + FFT_SIZE <= samples.length; start += HOP) {
    const frame = samples.subarray(start, start + FFT_SIZE);
    const energies = bandEnergiesFromSpectrum(realFftDb(frame), sampleRate, FFT_SIZE);
    frames.push({ centerSample: start + FFT_SIZE / 2, energies });
  }
  return frames;
}

// Group per-frame band energies by their window index.
function assignFramesToWindows(frames, samplesPerWindow) {
  const byWindow = new Map();
  for (const f of frames) {
    const wi = windowIndexFor(f.centerSample, samplesPerWindow);
    if (!byWindow.has(wi)) byWindow.set(wi, []);
    byWindow.get(wi).push(f.energies);
  }
  return byWindow;
}

// Single time-domain pass over a window's raw samples.
function windowRmsAndClip(samples, startSample, endSample) {
  let sumSq = 0;
  let clipped = 0;
  for (let i = startSample; i < endSample; i++) {
    const s = samples[i];
    sumSq += s * s;
    if (Math.abs(s) >= CLIP_THRESHOLD) clipped++;
  }
  const n = endSample - startSample;
  return {
    rms: n > 0 ? Math.sqrt(sumSq / n) : 0,
    clip_fraction: n > 0 ? clipped / n : 0,
    sampleCount: n
  };
}

function framesToWindows(samples, sampleRate, audioFirstFrameMs) {
  if (samples.length < FFT_SIZE) return [];
  const samplesPerWindow = Math.round((sampleRate * WINDOW_DURATION_MS) / 1000);
  const byWindow = assignFramesToWindows(stft(samples, sampleRate), samplesPerWindow);

  const fullWindows = Math.floor(samples.length / samplesPerWindow);
  const remainder = samples.length - fullWindows * samplesPerWindow;
  const keepPartial = remainder >= PARTIAL_MIN_COVERAGE_S * sampleRate;
  const lastWindowIndex = keepPartial ? fullWindows : fullWindows - 1;

  const windows = [];
  for (let i = 0; i <= lastWindowIndex; i++) {
    const startSample = i * samplesPerWindow;
    const endSample = Math.min((i + 1) * samplesPerWindow, samples.length);
    const energiesList = byWindow.get(i) || [];
    const avg = averageWindowEnergies(energiesList);
    const stats = windowRmsAndClip(samples, startSample, endSample);
    const isPartial = stats.sampleCount < samplesPerWindow;
    windows.push({
      window_id: "w" + i,
      started_at_ms: audioFirstFrameMs + i * WINDOW_DURATION_MS,
      duration_ms: isPartial ? Math.round((stats.sampleCount / sampleRate) * 1000) : WINDOW_DURATION_MS,
      frame_count: energiesList.length,
      low_energy: avg.low,
      mid_energy: avg.mid,
      high_energy: avg.high,
      rms: stats.rms,
      clip_fraction: stats.clip_fraction,
      near_floor: Math.max(avg.low, avg.mid, avg.high) < NEAR_FLOOR_K * ENERGY_FLOOR_MIN
    });
  }
  return windows;
}

module.exports = { framesToWindows, windowIndexFor };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/audio-windows.test.js`
Expected: PASS, prints "audio-windows tests passed".

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/audio-windows.test.js` to the `test` script.

- [ ] **Step 6: Commit**

```bash
git add harness/audio/audio-windows.js tests/audio-windows.test.js package.json
git commit -m "feat(harness): add windowing orchestrator (SP1)"
```

---

### Task 4: Disk loader + real-file smoke test

**Files:**
- Create: `harness/audio/load-pass.js`
- Test: `tests/load-pass.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `decodeWav` (Task 1), `framesToWindows` (Task 3); Node `fs`; in the test, `recorder/wav-encoder.js` and `os`/`path`.
- Produces: `loadPass(wavPath, sidecarPath)` → `{ windows, sampleRate, warnings }`. `warnings` is a string array; a WAV-vs-sidecar `sample_rate` mismatch pushes a non-fatal warning (never throws on mismatch).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/load-pass.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { encodeWav } = require("../recorder/wav-encoder");
const { loadPass } = require("../harness/audio/load-pass");

// Mismatch warning: sidecar sample_rate disagrees with the WAV header.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp1-"));
try {
  const wavBytes = encodeWav([new Float32Array(4096)], 4096, 48000);
  const wp = path.join(dir, "p.wav");
  const sp = path.join(dir, "p.json");
  fs.writeFileSync(wp, Buffer.from(wavBytes));
  fs.writeFileSync(sp, JSON.stringify({ sample_rate: 44100, audio_first_frame_ms: 5000 }));
  const res = loadPass(wp, sp);
  assert.ok(res.warnings.length > 0, "expected a sample_rate mismatch warning");
  assert.ok(res.warnings[0].includes("mismatch"));
  assert.strictEqual(res.sampleRate, 48000); // trusts the WAV
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Mechanics smoke test on the real captured pass: exactly 25 windows, no warnings.
const realWav = path.join(__dirname, "..", "data", "johnson-creek-pass-1-163508.wav");
const realJson = path.join(__dirname, "..", "data", "johnson-creek-pass-1-163508.json");
const real = loadPass(realWav, realJson);
assert.strictEqual(real.windows.length, 25);
assert.strictEqual(real.warnings.length, 0);
for (let i = 0; i < real.windows.length; i++) {
  assert.strictEqual(real.windows[i].window_id, "w" + i);
  assert.ok(Number.isFinite(real.windows[i].rms));
  assert.ok(Number.isFinite(real.windows[i].low_energy));
  if (i > 0) {
    assert.ok(real.windows[i].started_at_ms > real.windows[i - 1].started_at_ms);
  }
}

console.log("load-pass tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/load-pass.test.js`
Expected: FAIL with "Cannot find module '../harness/audio/load-pass'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// harness/audio/load-pass.js
"use strict";
const fs = require("fs");
const { decodeWav } = require("./wav-decoder");
const { framesToWindows } = require("./audio-windows");

function loadPass(wavPath, sidecarPath) {
  const bytes = fs.readFileSync(wavPath);
  const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
  const decoded = decodeWav(bytes);
  const warnings = [];
  if (sidecar.sample_rate !== undefined && sidecar.sample_rate !== decoded.sampleRate) {
    warnings.push(
      `sample_rate mismatch: WAV ${decoded.sampleRate} vs sidecar ${sidecar.sample_rate}`
    );
  }
  const windows = framesToWindows(decoded.samples, decoded.sampleRate, sidecar.audio_first_frame_ms);
  return { windows, sampleRate: decoded.sampleRate, warnings };
}

module.exports = { loadPass };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/load-pass.test.js`
Expected: PASS, prints "load-pass tests passed".

- [ ] **Step 5: Wire into package.json and run the full suite**

Append ` && node tests/load-pass.test.js` to the `test` script, then run `npm test`. Expected: every prior "… passed" line prints, no error.

- [ ] **Step 6: Commit**

```bash
git add harness/audio/load-pass.js tests/load-pass.test.js package.json
git commit -m "feat(harness): add disk loader + real-file smoke test (SP1)"
```

---

## Self-Review

**1. Spec coverage:**
- WAV decode + canonical-header throws (FR-1, FR-2) → Task 1. ✓
- FFT dB spectrum, Hann, length-throw, DC/Nyquist (FR-3) → Task 2. ✓
- STFT framing + trailing-frame drop (FR-4) → Task 3 (`stft`). ✓
- Window grouping, contiguity, zero-frame emission, partial drop (FR-5) → Task 3. ✓
- Band energies via core (FR-6) → Tasks 2/3. ✓
- RMS / clip_fraction (own denominator) / near_floor (FR-7) → Task 3. ✓
- started_at_ms + duration_ms formulas (FR-8) → Task 3. ✓
- Loader + sample_rate cross-check warning (FR-9) → Task 4. ✓
- NFR-1 function decomposition → Task 3 helpers. ✓
- NFR-2 window-duration invariant → `windowIndexFor` + `samplesPerWindow`, tested with `samplesPerWindow=100`. ✓
- NFR-3 no deps, full suite → Task 4 Step 5. ✓
- SC-1…SC-5 → covered across Tasks 1–4 (smoke test pins exactly 25 windows). ✓

**2. Placeholder scan:** No TBD/TODO; every code step is complete and runnable.

**3. Type consistency:** `decodeWav` return shape, `realFftDb` signature, `framesToWindows`/`windowIndexFor` signatures, and the window object keys are identical across the producing task, the consuming task, and the tests. `samplesPerWindow`, `HOP`, and the constant names match the spec.

---

## Execution

Use **superpowers:subagent-driven-development**, Sonnet per task (user rule), sequential. All four tasks gate on green node tests; the Task 4 checkpoint runs the full `npm test`.
