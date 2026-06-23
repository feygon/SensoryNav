# SensoryNav Auditory Scoring Core Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, browser-free scoring core for the SensoryNav auditory prototype — band-energy analysis, baseline calibration, roughness scoring, the CVD-safe color scale, audio↔GPS pairing, session export/validation, and fixtures — all unit-tested under Node.

**Architecture:** Vanilla JavaScript, no build step, no dependencies. Each module is a dual-export file: `module.exports` for Node tests plus a `window.*` global for later browser use (the pattern `backend/waitlist-store.js` and `theme.js` already establish). This plan deliberately contains **zero browser APIs** — every function is a pure data transform, so the entire spec "unit/data test" surface is covered here. Plan B wires these into live mic/GPS/canvas.

**Tech Stack:** Node.js (tests via `node:assert`, run as plain scripts), browser-targeted vanilla JS modules. No npm dependencies are added.

**Spec:** `docs/specs/prd-sensorynav-auditory-prototype.md` (v0.6, READY 45/45).

## Global Constraints

Copied verbatim from the spec; every task implicitly includes these.

- **No dependencies.** Vanilla JS only. Adding any package requires the secure-installer gate (CLAUDE.md) — this plan needs none.
- **Timestamps are epoch milliseconds** (integer `_ms` fields) on a single clock base. ISO strings are derived display copies only, never used for pairing.
- **Band edges** are lower-inclusive, upper-exclusive: low `[80, 250)`, mid `[250, 1000)`, high `[1000, 4000)` Hz. A bin is assigned to the band containing its center frequency; an edge bin belongs to the higher band.
- **Constants** (single source of truth): `FFT_SIZE = 2048`, `SMOOTHING_TIME_CONSTANT = 0`, `ASSUMED_SAMPLE_RATE_HZ = 48000`, `WINDOW_DURATION_MS = 1000`, `ENERGY_FLOOR_MIN = 1e-6`, weights `0.45 / 0.40 / 0.15`, score scaling `* 50` then `clamp(round(...), 0, 100)`, `PAIR_MAX_SKEW_SECONDS = 5`.
- **Score → color** uses a perceptually-uniform, CVD-safe (cividis-style) scale, not green/yellow/red. Continuous across 0–100; smooth = dark/low end, rough = bright/high end.
- **Privacy:** raw audio is never persisted or placed in the export. Only derived band energies and scores.
- **Function size:** target ~100 lines per function, hard limit 300. Decompose rather than write monoliths.
- **Module export pattern (use in every module):**

```javascript
if (typeof module !== "undefined" && module.exports) {
  module.exports = { /* names */ };
}
if (typeof window !== "undefined") {
  window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, { /* names */ });
}
```

---

## File Structure

- Create: `recorder/constants.js` — the Tunable Constants block as a frozen object (single source of truth).
- Create: `recorder/cvd-scale.js` — score (0–100) → cividis-style hex color.
- Create: `recorder/audio-scoring.js` — band energies from a spectrum, per-window averaging, roughness score.
- Create: `recorder/calibration.js` — baseline medians + energy floor.
- Create: `recorder/sample-pairing.js` — pair audio windows with GPS samples into located samples.
- Create: `recorder/session-export.js` — assemble and validate the session JSON.
- Create: `recorder/fixtures.js` — build a fixture session for browser/UI testing.
- Test: `tests/constants.test.js`, `tests/cvd-scale.test.js`, `tests/audio-scoring.test.js`, `tests/calibration.test.js`, `tests/sample-pairing.test.js`, `tests/session-export.test.js`, `tests/fixtures.test.js`.
- Modify: `package.json` — append each test to the `test` script.

---

## Orchestration (static delegation calculus — Planner Pass 2)

The expensive pass runs once, here; execution-time degrades to cheap checks. All eight tasks share one profile — they are pure-logic, ~2 small files each, fully specified with code, no security/accuracy sensitivity, no large reads or throwaway output:

| Field | Value (all tasks) |
|---|---|
| Delegation | `subagent` |
| Model | `sonnet` (floor — user rule: never `haiku` for code) |
| Bloat | `low` |
| Must-inline | `no` |
| Tier-2 risk | `no` |

The calculus's mechanical-task default would be `haiku`; a standing user instruction overrides it — Sonnet is the minimum model for any code-writing task, so these are `sonnet`.

**Dispatch decision:** subagent-driven-development, one `sonnet` subagent per task, **sequential** in dependency order, review between tasks. No inline tasks. No Tier-2 compact watch (bloat stays low end-to-end).

**Cross-task levers:**
- *Forward-propagate:* n/a — no early `bloat:high` + `must-inline:yes` task poisons the context.
- *Reorder:* n/a — dependency order is already optimal (1, 2 → 3, 4 → 5, 6 → 7 → 8).
- *Parallelism is constrained by shared writes:* every task appends to `package.json`, and Task 5 edits the file Task 3 creates. Sequential execution avoids that merge contention; parallelizing eight tiny tasks isn't worth it.

**Checkpoint:** after Task 8, run the full `npm test` as the review gate.

---

### Task 1: Constants module

**Files:**
- Create: `recorder/constants.js`
- Test: `tests/constants.test.js`
- Modify: `package.json` (test script)

**Interfaces:**
- Produces: `CONSTANTS` — a frozen object with all spec constants used by every later module.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/constants.test.js
const assert = require("assert");
const { CONSTANTS } = require("../recorder/constants");

assert.strictEqual(CONSTANTS.FFT_SIZE, 2048);
assert.strictEqual(CONSTANTS.SMOOTHING_TIME_CONSTANT, 0);
assert.strictEqual(CONSTANTS.ASSUMED_SAMPLE_RATE_HZ, 48000);
assert.strictEqual(CONSTANTS.WINDOW_DURATION_MS, 1000);
assert.strictEqual(CONSTANTS.ENERGY_FLOOR_MIN, 1e-6);
assert.strictEqual(CONSTANTS.PAIR_MAX_SKEW_SECONDS, 5);
assert.deepStrictEqual(CONSTANTS.WEIGHTS, { low: 0.45, mid: 0.4, high: 0.15 });
assert.deepStrictEqual(CONSTANTS.BANDS, {
  low: [80, 250],
  mid: [250, 1000],
  high: [1000, 4000]
});
assert.throws(() => { CONSTANTS.FFT_SIZE = 1; }, TypeError);

console.log("constants tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/constants.test.js`
Expected: FAIL with "Cannot find module '../recorder/constants'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// recorder/constants.js
const CONSTANTS = Object.freeze({
  FFT_SIZE: 2048,
  SMOOTHING_TIME_CONSTANT: 0,
  ASSUMED_SAMPLE_RATE_HZ: 48000,
  WINDOW_DURATION_MS: 1000,
  ENERGY_FLOOR_MIN: 1e-6,
  PAIR_MAX_SKEW_SECONDS: 5,
  WEIGHTS: Object.freeze({ low: 0.45, mid: 0.4, high: 0.15 }),
  SCORE_SCALE: 50,
  BANDS: Object.freeze({
    low: Object.freeze([80, 250]),
    mid: Object.freeze([250, 1000]),
    high: Object.freeze([1000, 4000])
  })
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CONSTANTS };
}
if (typeof window !== "undefined") {
  window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, { CONSTANTS });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/constants.test.js`
Expected: PASS, prints "constants tests passed".

- [ ] **Step 5: Wire the test into package.json**

In `package.json`, change the `test` script to append:

```
node tests/constants.test.js
```

so it reads `... && node tests/theme.test.js && node tests/constants.test.js`.

- [ ] **Step 6: Commit**

```bash
git add recorder/constants.js tests/constants.test.js package.json
git commit -m "feat(recorder): add tunable constants module"
```

---

### Task 2: CVD-safe color scale

**Files:**
- Create: `recorder/cvd-scale.js`
- Test: `tests/cvd-scale.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `colorForScore(score)` → hex string `#rrggbb`. Maps 0 → dark/low end (smooth), 100 → bright/high end (rough), continuous in between via a cividis-style control-point table. Out-of-range scores clamp to [0, 100].

- [ ] **Step 1: Write the failing test**

```javascript
// tests/cvd-scale.test.js
const assert = require("assert");
const { colorForScore, CONTROL_STOPS } = require("../recorder/cvd-scale");

const hex = /^#[0-9a-f]{6}$/;

// Endpoints map to the first/last cividis stops.
assert.strictEqual(colorForScore(0), CONTROL_STOPS[0]);
assert.strictEqual(colorForScore(100), CONTROL_STOPS[CONTROL_STOPS.length - 1]);

// Always a valid hex, including a mid value and out-of-range clamps.
assert.ok(hex.test(colorForScore(50)));
assert.strictEqual(colorForScore(-20), colorForScore(0));
assert.strictEqual(colorForScore(160), colorForScore(100));

// Perceptual lightness increases smooth -> rough (cividis dark blue -> yellow).
function luminance(hexColor) {
  const n = parseInt(hexColor.slice(1), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
}
assert.ok(luminance(colorForScore(90)) > luminance(colorForScore(10)));

console.log("cvd-scale tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/cvd-scale.test.js`
Expected: FAIL with "Cannot find module '../recorder/cvd-scale'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// recorder/cvd-scale.js
// Cividis-style control points (perceptually uniform, colorblind-safe),
// dark blue (smooth/low) -> muted yellow (rough/high).
const CONTROL_STOPS = [
  "#00224e",
  "#35456c",
  "#666970",
  "#948e6a",
  "#cabb56",
  "#ffea46"
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return "#" + rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, "0")).join("");
}

function colorForScore(score) {
  const clamped = clamp(Number(score) || 0, 0, 100);
  const segments = CONTROL_STOPS.length - 1;
  const position = (clamped / 100) * segments;
  const lowerIndex = Math.min(Math.floor(position), segments - 1);
  const fraction = position - lowerIndex;
  const lower = hexToRgb(CONTROL_STOPS[lowerIndex]);
  const upper = hexToRgb(CONTROL_STOPS[lowerIndex + 1]);
  return rgbToHex(lower.map((c, i) => c + (upper[i] - c) * fraction));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { colorForScore, CONTROL_STOPS };
}
if (typeof window !== "undefined") {
  window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, { colorForScore, CONTROL_STOPS });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/cvd-scale.test.js`
Expected: PASS, prints "cvd-scale tests passed".

- [ ] **Step 5: Wire into package.json**

Append `node tests/cvd-scale.test.js` to the `test` script.

- [ ] **Step 6: Commit**

```bash
git add recorder/cvd-scale.js tests/cvd-scale.test.js package.json
git commit -m "feat(recorder): add CVD-safe score color scale"
```

---

### Task 3: Band energy from spectrum + window averaging

**Files:**
- Create: `recorder/audio-scoring.js`
- Test: `tests/audio-scoring.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `CONSTANTS` from Task 1.
- Produces:
  - `bandEnergiesFromSpectrum(freqDataDb, sampleRate, fftSize)` → `{ low, mid, high }` linear power. `freqDataDb` is a dB-per-bin array (as `AnalyserNode.getFloatFrequencyData` returns).
  - `averageWindowEnergies(frameEnergies)` → `{ low, mid, high }` mean across an array of per-frame `{low,mid,high}`.
  - (`roughnessScore` is added in Task 5 to this same file.)

- [ ] **Step 1: Write the failing test**

```javascript
// tests/audio-scoring.test.js
const assert = require("assert");
const { bandEnergiesFromSpectrum, averageWindowEnergies } = require("../recorder/audio-scoring");

const sampleRate = 48000;
const fftSize = 2048;
const binCount = fftSize / 2;
const hzPerBin = sampleRate / fftSize; // ~23.4 Hz

// Build a spectrum that is quiet (-120 dB) everywhere except loud (-10 dB)
// in the mid band [250, 1000).
const spectrum = new Float32Array(binCount).fill(-120);
for (let i = 0; i < binCount; i++) {
  const freq = i * hzPerBin;
  if (freq >= 250 && freq < 1000) {
    spectrum[i] = -10;
  }
}

const energies = bandEnergiesFromSpectrum(spectrum, sampleRate, fftSize);
assert.ok(energies.mid > energies.low, "mid should exceed low");
assert.ok(energies.mid > energies.high, "mid should exceed high");

// A bin centered exactly on 250 Hz belongs to the higher (mid) band.
const edgeBin = Math.round(250 / hzPerBin);
assert.ok(Math.abs(edgeBin * hzPerBin - 250) < hzPerBin, "sanity: edge bin near 250");

// Averaging two frames returns the per-band mean.
const avg = averageWindowEnergies([
  { low: 2, mid: 4, high: 6 },
  { low: 4, mid: 8, high: 10 }
]);
assert.deepStrictEqual(avg, { low: 3, mid: 6, high: 8 });

// Empty frame list does not divide by zero.
assert.deepStrictEqual(averageWindowEnergies([]), { low: 0, mid: 0, high: 0 });

console.log("audio-scoring band tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/audio-scoring.test.js`
Expected: FAIL with "Cannot find module '../recorder/audio-scoring'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// recorder/audio-scoring.js
const { CONSTANTS } = require("./constants");

function bandForFrequency(freq) {
  const { low, mid, high } = CONSTANTS.BANDS;
  if (freq >= low[0] && freq < low[1]) return "low";
  if (freq >= mid[0] && freq < mid[1]) return "mid";
  if (freq >= high[0] && freq < high[1]) return "high";
  return null;
}

function bandEnergiesFromSpectrum(freqDataDb, sampleRate, fftSize) {
  const binCount = Math.floor(fftSize / 2);
  const hzPerBin = sampleRate / fftSize;
  const bands = { low: 0, mid: 0, high: 0 };
  const limit = Math.min(binCount, freqDataDb.length);
  for (let i = 0; i < limit; i++) {
    const band = bandForFrequency(i * hzPerBin);
    if (band) {
      bands[band] += Math.pow(10, freqDataDb[i] / 10); // dB -> linear power
    }
  }
  return bands;
}

function averageWindowEnergies(frameEnergies) {
  if (!frameEnergies.length) {
    return { low: 0, mid: 0, high: 0 };
  }
  const total = frameEnergies.reduce(
    (acc, frame) => ({
      low: acc.low + frame.low,
      mid: acc.mid + frame.mid,
      high: acc.high + frame.high
    }),
    { low: 0, mid: 0, high: 0 }
  );
  const n = frameEnergies.length;
  return { low: total.low / n, mid: total.mid / n, high: total.high / n };
}

const exported = { bandEnergiesFromSpectrum, averageWindowEnergies, bandForFrequency };

if (typeof module !== "undefined" && module.exports) {
  module.exports = exported;
}
if (typeof window !== "undefined") {
  window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported);
}
```

Note for browser use: `require("./constants")` resolves under Node. In the browser, `recorder/constants.js` is loaded first via `<script>` and exposes `window.SensoryNavCore.CONSTANTS`; Plan B's page wiring loads scripts in dependency order. For Node tests, `require` is correct.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/audio-scoring.test.js`
Expected: PASS, prints "audio-scoring band tests passed".

- [ ] **Step 5: Wire into package.json**

Append `node tests/audio-scoring.test.js` to the `test` script.

- [ ] **Step 6: Commit**

```bash
git add recorder/audio-scoring.js tests/audio-scoring.test.js package.json
git commit -m "feat(recorder): add band energy analysis"
```

---

### Task 4: Baseline calibration

**Files:**
- Create: `recorder/calibration.js`
- Test: `tests/calibration.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `CONSTANTS` from Task 1.
- Produces: `computeBaseline(windowEnergies, energyFloorMin)` → `{ low_median, mid_median, high_median, energy_floor_min, effective_floor: { low, mid, high } }`. `windowEnergies` is an array of `{low,mid,high}`. `energyFloorMin` defaults to `CONSTANTS.ENERGY_FLOOR_MIN`. `effective_floor.<band> = max(median, energy_floor_min)`. Also exports `median(values)`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/calibration.test.js
const assert = require("assert");
const { computeBaseline, median } = require("../recorder/calibration");

assert.strictEqual(median([3, 1, 2]), 2);            // odd
assert.strictEqual(median([1, 2, 3, 4]), 2.5);       // even -> mean of middle two
assert.strictEqual(median([]), 0);                   // empty guard

const baseline = computeBaseline([
  { low: 10, mid: 20, high: 30 },
  { low: 30, mid: 40, high: 50 }
]);
assert.strictEqual(baseline.low_median, 20);
assert.strictEqual(baseline.mid_median, 30);
assert.strictEqual(baseline.high_median, 40);
assert.strictEqual(baseline.effective_floor.low, 20); // median > floor

// A silent baseline floors to ENERGY_FLOOR_MIN so it can never be a zero denominator.
const silent = computeBaseline([
  { low: 0, mid: 0, high: 0 },
  { low: 0, mid: 0, high: 0 }
]);
assert.strictEqual(silent.low_median, 0);
assert.strictEqual(silent.effective_floor.low, 1e-6);
assert.strictEqual(silent.effective_floor.mid, 1e-6);
assert.strictEqual(silent.effective_floor.high, 1e-6);

console.log("calibration tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/calibration.test.js`
Expected: FAIL with "Cannot find module '../recorder/calibration'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// recorder/calibration.js
const { CONSTANTS } = require("./constants");

function median(values) {
  if (!values.length) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function computeBaseline(windowEnergies, energyFloorMin) {
  const floor = energyFloorMin === undefined ? CONSTANTS.ENERGY_FLOOR_MIN : energyFloorMin;
  const lowMedian = median(windowEnergies.map((w) => w.low));
  const midMedian = median(windowEnergies.map((w) => w.mid));
  const highMedian = median(windowEnergies.map((w) => w.high));
  return {
    low_median: lowMedian,
    mid_median: midMedian,
    high_median: highMedian,
    energy_floor_min: floor,
    effective_floor: {
      low: Math.max(lowMedian, floor),
      mid: Math.max(midMedian, floor),
      high: Math.max(highMedian, floor)
    }
  };
}

const exported = { computeBaseline, median };

if (typeof module !== "undefined" && module.exports) {
  module.exports = exported;
}
if (typeof window !== "undefined") {
  window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/calibration.test.js`
Expected: PASS, prints "calibration tests passed".

- [ ] **Step 5: Wire into package.json**

Append `node tests/calibration.test.js` to the `test` script.

- [ ] **Step 6: Commit**

```bash
git add recorder/calibration.js tests/calibration.test.js package.json
git commit -m "feat(recorder): add baseline calibration with energy floor"
```

---

### Task 5: Roughness score

**Files:**
- Modify: `recorder/audio-scoring.js` (append `roughnessScore`)
- Test: `tests/audio-scoring.test.js` (append cases)
- (no package.json change — test already wired in Task 3)

**Interfaces:**
- Consumes: `CONSTANTS` (Task 1), baseline shape from Task 4 (`effective_floor`).
- Produces: `roughnessScore(windowEnergies, baseline)` → integer 0–100. Uses `delta_band = max(0, energy_band / effective_floor_band - 1)`, `raw = 0.45*low + 0.40*mid + 0.15*high`, `clamp(round(raw * 50), 0, 100)`.

- [ ] **Step 1: Write the failing test (append to tests/audio-scoring.test.js, above the final console.log)**

```javascript
const { roughnessScore } = require("../recorder/audio-scoring");

const baseline = {
  effective_floor: { low: 10, mid: 10, high: 10 }
};

// Energy at baseline -> all deltas 0 -> score 0.
assert.strictEqual(roughnessScore({ low: 10, mid: 10, high: 10 }, baseline), 0);

// Energy below baseline still clamps deltas at 0 -> score 0.
assert.strictEqual(roughnessScore({ low: 1, mid: 1, high: 1 }, baseline), 0);

// Loud low band drives a high score; result stays within [0,100].
const loud = roughnessScore({ low: 1000, mid: 1000, high: 1000 }, baseline);
assert.ok(loud > 0 && loud <= 100, "loud score in range");
assert.strictEqual(loud, 100);

// A silent-baseline floor (1e-6) does not blow the score past 100.
const flooredBaseline = { effective_floor: { low: 1e-6, mid: 1e-6, high: 1e-6 } };
assert.strictEqual(roughnessScore({ low: 5, mid: 5, high: 5 }, flooredBaseline), 100);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/audio-scoring.test.js`
Expected: FAIL with "roughnessScore is not a function".

- [ ] **Step 3: Write minimal implementation (add to recorder/audio-scoring.js before the export block, and add the names to `exported`)**

```javascript
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roughnessScore(windowEnergies, baseline) {
  const floor = baseline.effective_floor;
  const delta = (energy, base) => Math.max(0, energy / base - 1);
  const lowDelta = delta(windowEnergies.low, floor.low);
  const midDelta = delta(windowEnergies.mid, floor.mid);
  const highDelta = delta(windowEnergies.high, floor.high);
  const { low, mid, high } = CONSTANTS.WEIGHTS;
  const raw = low * lowDelta + mid * midDelta + high * highDelta;
  return clamp(Math.round(raw * CONSTANTS.SCORE_SCALE), 0, 100);
}
```

Update the `exported` object to include `roughnessScore`:

```javascript
const exported = { bandEnergiesFromSpectrum, averageWindowEnergies, bandForFrequency, roughnessScore };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/audio-scoring.test.js`
Expected: PASS, prints "audio-scoring band tests passed".

- [ ] **Step 5: Commit**

```bash
git add recorder/audio-scoring.js tests/audio-scoring.test.js
git commit -m "feat(recorder): add roughness score"
```

---

### Task 6: Sample pairing

**Files:**
- Create: `recorder/sample-pairing.js`
- Test: `tests/sample-pairing.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `CONSTANTS` (Task 1), `colorForScore` (Task 2).
- Produces: `pairWindowsWithGps(windows, gpsSamples, maxSkewSeconds)` → array of located samples. Each `window` has `{ window_id, started_at_ms, auditory_roughness_score }`; each gps sample has `{ sample_id, captured_at_ms, latitude, longitude }`. A located sample is `{ window_id, gps_sample_id, gps_captured_at_ms, location_status, latitude, longitude, auditory_roughness_score, color }`. Nearest GPS within `±maxSkewSeconds`; ties broken by earlier `captured_at_ms`; one GPS sample may serve multiple windows; no match → `location_status: "missing"` with null location fields and color.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/sample-pairing.test.js
const assert = require("assert");
const { pairWindowsWithGps } = require("../recorder/sample-pairing");

const gps = [
  { sample_id: "g1", captured_at_ms: 1000, latitude: 1, longitude: 1 },
  { sample_id: "g2", captured_at_ms: 5000, latitude: 2, longitude: 2 },
  { sample_id: "g3", captured_at_ms: 5000, latitude: 3, longitude: 3 } // tie with g2
];

const windows = [
  { window_id: "w1", started_at_ms: 1200, auditory_roughness_score: 10 }, // -> g1
  { window_id: "w2", started_at_ms: 5000, auditory_roughness_score: 80 }, // tie -> earlier g2
  { window_id: "w3", started_at_ms: 20000, auditory_roughness_score: 50 } // no GPS within 5s
];

const located = pairWindowsWithGps(windows, gps, 5);

assert.strictEqual(located[0].gps_sample_id, "g1");
assert.strictEqual(located[0].location_status, "paired");
assert.strictEqual(located[0].gps_captured_at_ms, 1000);
assert.ok(/^#[0-9a-f]{6}$/.test(located[0].color));

assert.strictEqual(located[1].gps_sample_id, "g2"); // earlier of the tie
assert.strictEqual(located[1].latitude, 2);

assert.strictEqual(located[2].location_status, "missing");
assert.strictEqual(located[2].gps_sample_id, null);
assert.strictEqual(located[2].latitude, null);

// One GPS sample can pair with multiple windows.
const reuse = pairWindowsWithGps(
  [
    { window_id: "a", started_at_ms: 1000, auditory_roughness_score: 0 },
    { window_id: "b", started_at_ms: 1100, auditory_roughness_score: 0 }
  ],
  [{ sample_id: "only", captured_at_ms: 1050, latitude: 9, longitude: 9 }],
  5
);
assert.strictEqual(reuse[0].gps_sample_id, "only");
assert.strictEqual(reuse[1].gps_sample_id, "only");

console.log("sample-pairing tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/sample-pairing.test.js`
Expected: FAIL with "Cannot find module '../recorder/sample-pairing'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// recorder/sample-pairing.js
const { CONSTANTS } = require("./constants");
const { colorForScore } = require("./cvd-scale");

function nearestGps(window, gpsSamples, maxSkewMs) {
  let best = null;
  let bestDist = Infinity;
  for (const gps of gpsSamples) {
    const dist = Math.abs(gps.captured_at_ms - window.started_at_ms);
    if (dist > maxSkewMs) {
      continue;
    }
    if (dist < bestDist || (dist === bestDist && gps.captured_at_ms < best.captured_at_ms)) {
      best = gps;
      bestDist = dist;
    }
  }
  return best;
}

function pairWindowsWithGps(windows, gpsSamples, maxSkewSeconds) {
  const seconds = maxSkewSeconds === undefined ? CONSTANTS.PAIR_MAX_SKEW_SECONDS : maxSkewSeconds;
  const maxSkewMs = seconds * 1000;
  return windows.map((window) => {
    const match = nearestGps(window, gpsSamples, maxSkewMs);
    if (!match) {
      return {
        window_id: window.window_id,
        gps_sample_id: null,
        gps_captured_at_ms: null,
        location_status: "missing",
        latitude: null,
        longitude: null,
        auditory_roughness_score: window.auditory_roughness_score,
        color: null
      };
    }
    return {
      window_id: window.window_id,
      gps_sample_id: match.sample_id,
      gps_captured_at_ms: match.captured_at_ms,
      location_status: "paired",
      latitude: match.latitude,
      longitude: match.longitude,
      auditory_roughness_score: window.auditory_roughness_score,
      color: colorForScore(window.auditory_roughness_score)
    };
  });
}

const exported = { pairWindowsWithGps, nearestGps };

if (typeof module !== "undefined" && module.exports) {
  module.exports = exported;
}
if (typeof window !== "undefined") {
  window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/sample-pairing.test.js`
Expected: PASS, prints "sample-pairing tests passed".

- [ ] **Step 5: Wire into package.json**

Append `node tests/sample-pairing.test.js` to the `test` script.

- [ ] **Step 6: Commit**

```bash
git add recorder/sample-pairing.js tests/sample-pairing.test.js package.json
git commit -m "feat(recorder): add audio-to-GPS sample pairing"
```

---

### Task 7: Session export + validation

**Files:**
- Create: `recorder/session-export.js`
- Test: `tests/session-export.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `buildSession(input)` where `input = { session_id, created_at_ms, calibration_status, baseline, audio_windows, gps_samples, located_samples, user_agent }` → a session object matching the spec Data Model, with `score_formula_version: "auditory-roughness-v0"`, a derived `created_at` ISO string, and **no raw audio**.
  - `validateSession(session)` → `{ valid: boolean, errors: string[] }`. Checks required keys, types, the formula version, and asserts no `raw_audio` key appears anywhere.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/session-export.test.js
const assert = require("assert");
const { buildSession, validateSession } = require("../recorder/session-export");

const session = buildSession({
  session_id: "s1",
  created_at_ms: 1000,
  calibration_status: "complete",
  baseline: {
    moving_duration_seconds: 30,
    low_median: 1, mid_median: 1, high_median: 1,
    energy_floor_min: 1e-6,
    effective_floor: { low: 1, mid: 1, high: 1 }
  },
  audio_windows: [
    { window_id: "w1", started_at_ms: 1000, duration_ms: 1000, low_energy: 1, mid_energy: 1, high_energy: 1, low_delta: 0, mid_delta: 0, high_delta: 0, auditory_roughness_score: 0 }
  ],
  gps_samples: [
    { sample_id: "g1", captured_at_ms: 1000, latitude: 1, longitude: 1, accuracy_meters: 5, speed_mps: 10 }
  ],
  located_samples: [
    { window_id: "w1", gps_sample_id: "g1", gps_captured_at_ms: 1000, location_status: "paired", latitude: 1, longitude: 1, auditory_roughness_score: 0, color: "#00224e" }
  ],
  user_agent: "test-agent"
});

assert.strictEqual(session.score_formula_version, "auditory-roughness-v0");
assert.strictEqual(session.created_at, new Date(1000).toISOString());
assert.ok(!JSON.stringify(session).includes("raw_audio"));

const ok = validateSession(session);
assert.strictEqual(ok.valid, true, JSON.stringify(ok.errors));

// Missing required field is rejected.
const broken = JSON.parse(JSON.stringify(session));
delete broken.session_id;
const bad = validateSession(broken);
assert.strictEqual(bad.valid, false);
assert.ok(bad.errors.some((e) => e.includes("session_id")));

// A stray raw_audio key is rejected.
const leaked = JSON.parse(JSON.stringify(session));
leaked.audio_windows[0].raw_audio = [0.1, 0.2];
const leak = validateSession(leaked);
assert.strictEqual(leak.valid, false);
assert.ok(leak.errors.some((e) => e.includes("raw_audio")));

console.log("session-export tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/session-export.test.js`
Expected: FAIL with "Cannot find module '../recorder/session-export'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// recorder/session-export.js
const SCORE_FORMULA_VERSION = "auditory-roughness-v0";
const REQUIRED_KEYS = [
  "session_id",
  "created_at_ms",
  "calibration_status",
  "score_formula_version",
  "baseline",
  "audio_windows",
  "gps_samples",
  "located_samples"
];

function buildSession(input) {
  return {
    session_id: input.session_id,
    created_at_ms: input.created_at_ms,
    created_at: new Date(input.created_at_ms).toISOString(),
    calibration_status: input.calibration_status,
    score_formula_version: SCORE_FORMULA_VERSION,
    user_agent: input.user_agent || null,
    baseline: input.baseline,
    audio_windows: input.audio_windows || [],
    gps_samples: input.gps_samples || [],
    located_samples: input.located_samples || []
  };
}

function validateSession(session) {
  const errors = [];
  for (const key of REQUIRED_KEYS) {
    if (session[key] === undefined || session[key] === null) {
      errors.push(`missing required field: ${key}`);
    }
  }
  if (session.score_formula_version && session.score_formula_version !== SCORE_FORMULA_VERSION) {
    errors.push(`unexpected score_formula_version: ${session.score_formula_version}`);
  }
  for (const arrayKey of ["audio_windows", "gps_samples", "located_samples"]) {
    if (session[arrayKey] !== undefined && !Array.isArray(session[arrayKey])) {
      errors.push(`${arrayKey} must be an array`);
    }
  }
  if (JSON.stringify(session).includes("raw_audio")) {
    errors.push("raw_audio must never be present in an export");
  }
  if (!["complete", "incomplete"].includes(session.calibration_status)) {
    errors.push(`invalid calibration_status: ${session.calibration_status}`);
  }
  return { valid: errors.length === 0, errors };
}

const exported = { buildSession, validateSession, SCORE_FORMULA_VERSION };

if (typeof module !== "undefined" && module.exports) {
  module.exports = exported;
}
if (typeof window !== "undefined") {
  window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/session-export.test.js`
Expected: PASS, prints "session-export tests passed".

- [ ] **Step 5: Wire into package.json**

Append `node tests/session-export.test.js` to the `test` script.

- [ ] **Step 6: Commit**

```bash
git add recorder/session-export.js tests/session-export.test.js package.json
git commit -m "feat(recorder): add session export and schema validation"
```

---

### Task 8: Fixture session

**Files:**
- Create: `recorder/fixtures.js`
- Test: `tests/fixtures.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `colorForScore` (Task 2), `pairWindowsWithGps` (Task 6), `buildSession` + `validateSession` (Task 7).
- Produces: `buildFixtureSession()` → a complete, valid session with **at least 30 located audio windows** spanning the smooth/moderate/rough score tiers, usable by Plan B's fixture mode with no mic or GPS.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/fixtures.test.js
const assert = require("assert");
const { buildFixtureSession } = require("../recorder/fixtures");
const { validateSession } = require("../recorder/session-export");

const session = buildFixtureSession();

assert.ok(session.located_samples.length >= 30, "at least 30 located windows");

const scores = session.located_samples.map((s) => s.auditory_roughness_score);
assert.ok(scores.some((s) => s <= 33), "has a smooth-tier score");
assert.ok(scores.some((s) => s > 33 && s <= 66), "has a moderate-tier score");
assert.ok(scores.some((s) => s > 66), "has a rough-tier score");

assert.ok(session.located_samples.every((s) => /^#[0-9a-f]{6}$/.test(s.color)));

const result = validateSession(session);
assert.strictEqual(result.valid, true, JSON.stringify(result.errors));

console.log("fixtures tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/fixtures.test.js`
Expected: FAIL with "Cannot find module '../recorder/fixtures'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// recorder/fixtures.js
const { pairWindowsWithGps } = require("./sample-pairing");
const { buildSession } = require("./session-export");

function buildFixtureSession() {
  const startMs = Date.UTC(2026, 0, 1, 12, 0, 0);
  const windowCount = 36;
  const audioWindows = [];
  const gpsSamples = [];

  for (let i = 0; i < windowCount; i++) {
    const startedAtMs = startMs + i * 1000;
    // Sweep scores 0..99 across the trip so all three tiers appear.
    const score = Math.round((i / (windowCount - 1)) * 99);
    audioWindows.push({
      window_id: `w${i}`,
      started_at_ms: startedAtMs,
      duration_ms: 1000,
      low_energy: 1 + i,
      mid_energy: 1 + i,
      high_energy: 1 + i,
      low_delta: i / windowCount,
      mid_delta: i / windowCount,
      high_delta: i / windowCount,
      auditory_roughness_score: score
    });
    gpsSamples.push({
      sample_id: `g${i}`,
      captured_at_ms: startedAtMs,
      latitude: 37.7749 + i * 0.0005,
      longitude: -122.4194 + i * 0.0005,
      accuracy_meters: 5,
      speed_mps: 12
    });
  }

  const locatedSamples = pairWindowsWithGps(audioWindows, gpsSamples, 5);

  return buildSession({
    session_id: "fixture-session",
    created_at_ms: startMs,
    calibration_status: "complete",
    baseline: {
      moving_duration_seconds: 30,
      low_median: 5, mid_median: 5, high_median: 5,
      energy_floor_min: 1e-6,
      effective_floor: { low: 5, mid: 5, high: 5 }
    },
    audio_windows: audioWindows,
    gps_samples: gpsSamples,
    located_samples: locatedSamples,
    user_agent: "fixture"
  });
}

const exported = { buildFixtureSession };

if (typeof module !== "undefined" && module.exports) {
  module.exports = exported;
}
if (typeof window !== "undefined") {
  window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/fixtures.test.js`
Expected: PASS, prints "fixtures tests passed".

- [ ] **Step 5: Wire into package.json and run the full suite**

Append `node tests/fixtures.test.js` to the `test` script, then run the whole suite:

Run: `npm test`
Expected: every prior line prints its "... passed" message with no error.

- [ ] **Step 6: Commit**

```bash
git add recorder/fixtures.js tests/fixtures.test.js package.json
git commit -m "feat(recorder): add fixture session generator"
```

---

## Self-Review

**1. Spec coverage (Plan A scope — the "unit/data test" clauses):**
- US-003 band energy + roughness score → Tasks 3, 5. ✓
- US-004 pairing (nearest within skew, missing, tie-break, reuse) → Task 6. ✓
- US-006 export (required fields, no raw audio, schema validation) → Task 7. ✓
- US-007 baseline median + energy floor → Task 4. ✓
- US-008 fixture data (≥30 located windows, all tiers) → Task 8. ✓
- CVD-safe color scale → Task 2. ✓
- Tunable Constants single source of truth → Task 1. ✓
- **Deferred to Plan B** (browser/manual clauses): US-001/US-002/US-002b (permissions, start/stop, motion pause), US-005 (canvas trace + legend + detail view), FR-001 state machine, FR-002 AGC-off capture, FR-004 geolocation, Platform Constraints (Wake Lock, Page Visibility), the export *download*, and clear-local-data. These consume Plan A's functions.

**2. Placeholder scan:** No TBD/TODO; every code step contains complete, runnable code. ✓

**3. Type consistency:** `effective_floor` shape is produced in Task 4 and consumed in Task 5; located-sample shape produced in Task 6 and consumed in Tasks 7–8; `colorForScore` signature consistent across Tasks 2, 6, 8; `CONSTANTS` shape consistent across Tasks 1, 3, 4, 5, 6. ✓

---

## Plan B preview (next plan, not built here)

Plan B — `2026-06-23-sensorynav-auditory-browser-app.md` — wires this core into a live browser foreground app. Anticipated tasks: (1) `record.html` page + dependency-ordered script loading; (2) `audio-capture.js` (`getUserMedia` with `autoGainControl/noiseSuppression/echoCancellation: false`, `AnalyserNode` at `FFT_SIZE`/smoothing 0, per-second windowing); (3) `location-capture.js` (`watchPosition`, epoch-ms stamping); (4) `session-controller.js` (FR-001 state machine, Wake Lock, Page Visibility pause/resume, motion-gated pause via `speed_mps`); (5) `trace-rendering.js` (canvas trace + legend + selectable detail view, neutral trace on incomplete calibration); (6) export-download + clear-local-data UI; (7) fixture-mode load. Each consumes Plan A exports via `window.SensoryNavCore`.
