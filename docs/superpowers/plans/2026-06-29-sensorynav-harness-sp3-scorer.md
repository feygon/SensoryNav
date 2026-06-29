# SensoryNav Harness SP3 — Research Scorer & Felt-Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the offline per-pass research scorer (SP3): turn SP1 audio windows + SP2 speed into per-window roughness (residual above a speed-conditioned floor) with detection, spike magnitude, and reliability, then validate against per-pass felt annotations.

**Architecture:** Nine pure, node-tested modules under `harness/score/` (a stats kit, felt loader, baseline fitter, reliability model, roughness scorer, per-pass orchestrator, validator, report writer, and a thin IO driver) plus two small edits to merged code: SP2 emits per-window `lat`/`lon`, and `recorder/audio-scoring.js` exposes a continuous `roughnessScoreRaw`. Reuses `recorder/constants.js` and the existing residual.

**Tech Stack:** Vanilla JS, no dependencies, Node `assert` test scripts. Node-only (`module.exports`).

**Spec:** `docs/superpowers/specs/2026-06-29-sensorynav-harness-sp3-scorer-design.md` (READY, 43/45).

## Global Constraints

Copied from the spec; every task implicitly includes these.

- **No dependencies.** Vanilla JS only. Node-only modules → plain `module.exports = { ... }`. (Exception: `recorder/audio-scoring.js` keeps its existing dual `module.exports` + `window.SensoryNavCore` pattern.)
- **Tests** are Node `assert` scripts, run `node tests/<name>.test.js`, end with `console.log("<name> tests passed")`, and are appended to `package.json`'s `test` script chained with ` && `.
- **Reuse** `recorder/audio-scoring.js` (residual) and `recorder/constants.js`; do not re-implement the residual or redefine constants. The only recorder change is extracting `roughnessScoreRaw` with `roughnessScore` output **unchanged**.
- **Continuous vs display:** all ranking/threshold metrics (ROC, Spearman, detection) operate on the **continuous** `roughness_raw`; the integer `roughness = Math.round(roughness_raw)` is **display-only**.
- **Reliability** = `speedFactor × clipFactor × frameFactor × floorGate`, each `[0,1]`; `near_floor` is a hard zero.
- **Baseline** = per-band, per-speed-bin reliability-weighted `FLOOR_Q` quantile, pooled **per vehicle** (single-vehicle batch). `floorAt`: ≥2 bins interpolate, 1 bin constant, 0 bins → global floor. Always also compute the speed-independent **global null-model** floor. Floors clamped up to `EPS_FLOOR`.
- **Felt** join is by **time** per pass; window interval `[started_at_ms, started_at_ms + (duration_ms || WINDOW_DURATION_MS))`; `felt_magnitude` = max overlapping magnitude.
- **Validation** excludes `reliability == 0`; presence (ROC-AUC, P/R/F1 at fixed `DETECT_TAU`, bestF1 reference) + magnitude (Spearman over felt-present); null-model A/B with the **same** `DETECT_TAU`; batch aggregate **re-pools** windows (not averaged); edge cases reported as `n/a` + reason.
- **Outputs** embed `lat`/`lon` → written to a **git-ignored** `out/score/`, never committed.
- **Dark-mode** HTML only: bg `#1a1a1a`, text `#dcdcdc`, containers `#555`/`#666`; no pure white.
- **Function size** ~100 lines/function target, 300 hard.
- **Defaults** (params-overridable): `SPEED_BIN_MPS 2.0`, `FLOOR_Q 0.10`, `MIN_BIN_SAMPLES 20`, `CLIP_TOL 0.02`, `FULL_FRAMES 45`, `DETECT_TAU 12`, `MIN_SPEARMAN_N 5`, `EPS_FLOOR 1e-6`.

---

## File Structure

- Modify: `recorder/audio-scoring.js` — extract `roughnessScoreRaw`; `roughnessScore = round(raw)`.
- Modify: `harness/motion/motion-track.js` — emit per-window `lat`/`lon`.
- Create: `harness/score/metrics.js` — `quantile, weightedQuantile, spearman, weightedSpearman, rocAuc, precisionRecall, bestF1Threshold`.
- Create: `harness/score/felt.js` — `loadFelt, mapFeltToWindows`.
- Create: `harness/score/baseline.js` — `fitBaseline, floorAt, globalFloorAt`.
- Create: `harness/score/reliability.js` — `windowReliability`.
- Create: `harness/score/roughness.js` — `scoreWindowRoughness`.
- Create: `harness/score/score-pass.js` — `scorePass`.
- Create: `harness/score/validate.js` — `validatePass, validateBatch`.
- Create: `harness/score/report.js` — `scoredWindowsJson, sessionSummaryJson, scoredWindowsCsv, inspectionHtml`.
- Create: `harness/score/run-scorer.js` — `scorePasses` (pure), `runScorer` (IO).
- Tests: one `tests/<name>.test.js` per module; `.gitignore` gains `out/`.

## Orchestration (static delegation calculus — Planner)

| Tasks | Delegation | Model | Bloat | Must-inline | Tier-2 |
|---|---|---|---|---|---|
| 1–11 | `subagent` | `sonnet` (user rule: never haiku for code) | low | no | no |

Sequential; every task gates on green node tests. **Checkpoint: after Task 11 run the full `npm test`.**

---

### Task 1: Continuous `roughnessScoreRaw` (recorder)

**Files:**
- Modify: `recorder/audio-scoring.js`
- Test: `tests/audio-scoring-raw.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `roughnessScoreRaw(windowEnergies, baseline)` → continuous `clamp(raw·SCORE_SCALE, 0, 100)`. `roughnessScore(windowEnergies, baseline)` → `Math.round(roughnessScoreRaw(...))` (unchanged integer output). Both exported.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/audio-scoring-raw.test.js
"use strict";
const assert = require("assert");
const { roughnessScore, roughnessScoreRaw } = require("../recorder/audio-scoring");

const baseline = { effective_floor: { low: 1, mid: 1, high: 1 } };

// Energies equal to floor → zero residual → 0.
assert.strictEqual(roughnessScoreRaw({ low: 1, mid: 1, high: 1 }, baseline), 0);
assert.strictEqual(roughnessScore({ low: 1, mid: 1, high: 1 }, baseline), 0);

// A mid spike yields a continuous (non-integer) raw value, integer is its round.
const e = { low: 1, mid: 1.37, high: 1 };
const raw = roughnessScoreRaw(e, baseline);
assert.ok(raw > 0 && raw < 100, `raw=${raw}`);
assert.ok(!Number.isInteger(raw), `expected continuous, got ${raw}`);
assert.strictEqual(roughnessScore(e, baseline), Math.round(raw));

// Clamp at 100 for a huge residual.
assert.strictEqual(roughnessScoreRaw({ low: 1e6, mid: 1e6, high: 1e6 }, baseline), 100);
assert.strictEqual(roughnessScore({ low: 1e6, mid: 1e6, high: 1e6 }, baseline), 100);

console.log("audio-scoring-raw tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/audio-scoring-raw.test.js`
Expected: FAIL — `roughnessScoreRaw is not a function`.

- [ ] **Step 3: Refactor the implementation**

In `recorder/audio-scoring.js`, replace the single `roughnessScore` function with the extracted pair (keep everything else — `clamp`, the `delta` logic — identical):

```javascript
function roughnessScoreRaw(windowEnergies, baseline) {
  const floor = baseline.effective_floor;
  const delta = (energy, base) => Math.max(0, energy / base - 1);
  const lowDelta = delta(windowEnergies.low, floor.low);
  const midDelta = delta(windowEnergies.mid, floor.mid);
  const highDelta = delta(windowEnergies.high, floor.high);
  const { low, mid, high } = CONSTANTS.WEIGHTS;
  const raw = low * lowDelta + mid * midDelta + high * highDelta;
  return clamp(raw * CONSTANTS.SCORE_SCALE, 0, 100);
}

function roughnessScore(windowEnergies, baseline) {
  return Math.round(roughnessScoreRaw(windowEnergies, baseline));
}
```

Add `roughnessScoreRaw` to the `exported` object:

```javascript
const exported = { bandEnergiesFromSpectrum, averageWindowEnergies, bandForFrequency, roughnessScore, roughnessScoreRaw };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/audio-scoring-raw.test.js` → PASS, prints "audio-scoring-raw tests passed".
Then run the full suite to confirm `roughnessScore` is byte-for-byte unchanged: `npm test`. Expected: all prior "… passed" lines, exit 0.

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/audio-scoring-raw.test.js` to the `test` script.

- [ ] **Step 6: Commit**

```bash
git add recorder/audio-scoring.js tests/audio-scoring-raw.test.js package.json
git commit -m "feat(recorder): extract continuous roughnessScoreRaw (SP3)"
```

---

### Task 2: SP2 emits per-window lat/lon

**Files:**
- Modify: `harness/motion/motion-track.js`
- Test: `tests/motion-track.test.js` (extend), `tests/motion-track-latlon.test.js` (new)
- Modify: `package.json`

**Interfaces:**
- Consumes: `geo-project.js` exported `R_EARTH`, `projectFixes`.
- Produces: each `buildMotionTrack` record gains `lat`, `lon` (numbers) after `started_at_ms`; the `< 2 fixes` branch emits `lat: null, lon: null`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/motion-track-latlon.test.js
"use strict";
const assert = require("assert");
const { buildMotionTrack } = require("../harness/motion/motion-track");
const { projectFixes, R_EARTH } = require("../harness/motion/geo-project");

const DEG = Math.PI / 180;
const BASE = 1000000;
function windows(n, t0) { const w = []; for (let i = 0; i < n; i++) w.push({ window_id: "w" + i, started_at_ms: t0 + i * 1000 }); return w; }
function fix(t, lat, lon, speed, acc) { return { sample_id: "g", captured_at_ms: t, latitude: lat, longitude: lon, speed_mps: speed, accuracy_meters: acc }; }
const MPD_LON = R_EARTH * Math.cos(45 * DEG) * DEG;
const DLON = 12 / MPD_LON;
function cvFix(i) { return fix(BASE + i * 1000, 45.0, -122.0 + DLON * i, 12, 3); }

// (a) projection inverse identity: project then invert ≈ original lat/lon.
const fixes = [fix(0, 45.0, -122.0, 12, 3), fix(1000, 45.002, -121.997, 12, 3)];
const { points, lat0, lon0 } = projectFixes(fixes);
points.forEach((p, i) => {
  const lat = lat0 + p.y / (R_EARTH * DEG);
  const lon = lon0 + p.x / (R_EARTH * DEG * Math.cos(lat0 * DEG));
  assert.ok(Math.abs(lat - fixes[i].latitude) < 1e-9, `lat ${lat}`);
  assert.ok(Math.abs(lon - fixes[i].longitude) < 1e-9, `lon ${lon}`);
});

// (b) buildMotionTrack emits numeric lat/lon: lat≈45, lon increases eastward.
const cv = []; for (let i = 0; i < 20; i++) cv.push(cvFix(i));
const track = buildMotionTrack(cv, windows(18, BASE));
assert.ok(Number.isFinite(track[5].lat) && Number.isFinite(track[5].lon));
assert.ok(Math.abs(track[5].lat - 45.0) < 1e-4, `lat=${track[5].lat}`);
assert.ok(track[10].lon > track[5].lon, "lon should increase eastward");

// (c) < 2 fixes → lat/lon null.
const few = buildMotionTrack([cvFix(0)], windows(3, BASE));
assert.strictEqual(few[0].lat, null);
assert.strictEqual(few[0].lon, null);

console.log("motion-track-latlon tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/motion-track-latlon.test.js`
Expected: FAIL — `track[5].lat` is `undefined` (not finite).

- [ ] **Step 3: Patch `motion-track.js`**

1. Update the geo-project import to pull `R_EARTH` and add `DEG`:

```javascript
const { projectFixes, bearingDeg, R_EARTH } = require("./geo-project");
const DEG = Math.PI / 180;
```

2. In `windowMotion`, change the signature to receive `lat0, lon0` and compute lat/lon from the smoothed state, emitting them after `started_at_ms`:

```javascript
function windowMotion(w, smoothed, fixes, params, lat0, lon0) {
  const t = w.started_at_ms + WINDOW_DURATION_MS / 2;
  const { s, P } = evaluateAt(smoothed, t, params.SIGMA_A);
  const vEast = s[2], vNorth = s[3];
  const speed = Math.sqrt(vEast * vEast + vNorth * vNorth);
  const velTraceVar = P[2][2] + P[3][3];
  const c = classifyWindow(t, w.started_at_ms, speed, vEast, vNorth, velTraceVar, fixes, params);
  return {
    window_id: w.window_id,
    started_at_ms: w.started_at_ms,
    lat: lat0 + s[1] / (R_EARTH * DEG),
    lon: lon0 + s[0] / (R_EARTH * DEG * Math.cos(lat0 * DEG)),
    speed_mps: speed,
    heading_deg: c.heading,
    speed_confidence: c.confidence,
    speed_source: c.source,
    flags: c.flags
  };
}
```

3. In `buildMotionTrack`, keep `lat0`/`lon0` and thread them in; add `lat/lon: null` to the `< 2 fixes` branch:

```javascript
function buildMotionTrack(gpsSamples, windows, params) {
  const p = Object.assign({}, DEFAULTS, params || {});
  const fixesRaw = sortDedupFixes(gpsSamples);
  if (fixesRaw.length < 2) {
    return windows.map((w) => ({
      window_id: w.window_id,
      started_at_ms: w.started_at_ms,
      lat: null,
      lon: null,
      speed_mps: 0,
      heading_deg: null,
      speed_confidence: 0,
      speed_source: "insufficient_fixes",
      flags: ["gap_unscored"]
    }));
  }
  const { points, lat0, lon0 } = projectFixes(fixesRaw);
  const smoothed = smooth(points, p.SIGMA_A);
  return windows.map((w) => windowMotion(w, smoothed, points, p, lat0, lon0));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/motion-track-latlon.test.js` → PASS.
Run: `node tests/motion-track.test.js` → still PASS (existing assertions check individual fields, not whole-record equality, so the new keys don't break them).

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/motion-track-latlon.test.js` to the `test` script.

- [ ] **Step 6: Commit**

```bash
git add harness/motion/motion-track.js tests/motion-track-latlon.test.js package.json
git commit -m "feat(harness): SP2 emits per-window lat/lon (SP3 prep)"
```

---

### Task 3: Statistics kit (`metrics.js`)

**Files:**
- Create: `harness/score/metrics.js`
- Test: `tests/score-metrics.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `quantile(values, q)` → linear-interpolated percentile; throws `"quantile: empty"` on empty.
  - `weightedQuantile(values, weights, q)` → smallest value whose cumulative weight fraction `≥ q`; throws `"quantile: empty"` if total weight `≤ 0`.
  - `spearman(xs, ys)` / `weightedSpearman(xs, ys, weights)` → rank correlation in `[-1,1]`; `NaN` if `n < 2` or zero variance.
  - `rocAuc(scores, labels, weights)` → weighted AUC; `NaN` if labels all-one or all-zero.
  - `precisionRecall(scores, labels, threshold, weights)` → `{ precision, recall, f1 }` (predicted positive when `score > threshold`).
  - `bestF1Threshold(scores, labels, weights)` → `{ threshold, f1 }` over distinct score values.
  - Missing `weights` ⇒ all-ones.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/score-metrics.test.js
"use strict";
const assert = require("assert");
const { quantile, weightedQuantile, spearman, weightedSpearman, rocAuc, precisionRecall, bestF1Threshold } = require("../harness/score/metrics");
const close = (a, b, t = 1e-9) => Math.abs(a - b) < t;

// quantile: median of 1..5 = 3; 0.25 interpolates.
assert.ok(close(quantile([5, 1, 3, 2, 4], 0.5), 3));
assert.ok(close(quantile([0, 10], 0.1), 1));
assert.throws(() => quantile([], 0.5), /empty/);

// weightedQuantile: all-equal weights behaves like a step quantile; weight shifts it.
assert.strictEqual(weightedQuantile([1, 2, 3, 4], [1, 1, 1, 1], 0.5), 2);
assert.strictEqual(weightedQuantile([1, 2, 3], [10, 1, 1], 0.1), 1); // mass at 1

// spearman: monotone → 1, antitone → -1, ties handled.
assert.ok(close(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1));
assert.ok(close(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1));
assert.ok(Number.isNaN(spearman([1], [1])));
assert.ok(close(weightedSpearman([1, 2, 3, 4], [1, 2, 3, 4], [1, 1, 1, 1]), 1));

// rocAuc: perfect separation = 1; reversed = 0; degenerate = NaN.
assert.ok(close(rocAuc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1]), 1));
assert.ok(close(rocAuc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1]), 0));
assert.ok(Number.isNaN(rocAuc([0.1, 0.2], [1, 1])));

// precisionRecall at threshold 0.5: predicted positive = scores>0.5.
const pr = precisionRecall([0.9, 0.6, 0.4, 0.1], [1, 0, 1, 0], 0.5);
assert.ok(close(pr.precision, 0.5) && close(pr.recall, 0.5));
assert.ok(close(pr.f1, 0.5));

// bestF1Threshold finds the separating threshold (f1 = 1).
const best = bestF1Threshold([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1]);
assert.ok(close(best.f1, 1));

console.log("score-metrics tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/score-metrics.test.js`
Expected: FAIL — `Cannot find module '../harness/score/metrics'`.

- [ ] **Step 3: Write the implementation**

```javascript
// harness/score/metrics.js
"use strict";

function quantile(values, q) {
  if (!values.length) throw new Error("quantile: empty");
  const v = values.slice().sort((a, b) => a - b);
  const pos = q * (v.length - 1);
  const lo = Math.floor(pos), frac = pos - lo;
  if (lo + 1 >= v.length) return v[lo];
  return v[lo] + frac * (v[lo + 1] - v[lo]);
}

function weightedQuantile(values, weights, q) {
  const w = weights || values.map(() => 1);
  const pairs = values.map((v, i) => [v, w[i]]).sort((a, b) => a[0] - b[0]);
  const total = pairs.reduce((s, p) => s + p[1], 0);
  if (total <= 0) throw new Error("quantile: empty");
  const target = q * total;
  let cum = 0;
  for (const [v, wi] of pairs) { cum += wi; if (cum >= target) return v; }
  return pairs[pairs.length - 1][0];
}

function rankAverage(xs) {
  const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1; // 1-based average rank
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = r;
    i = j + 1;
  }
  return ranks;
}

function weightedPearson(xs, ys, weights) {
  const w = weights || xs.map(() => 1);
  const W = w.reduce((s, x) => s + x, 0);
  if (xs.length < 2 || W <= 0) return NaN;
  const mx = xs.reduce((s, x, i) => s + w[i] * x, 0) / W;
  const my = ys.reduce((s, y, i) => s + w[i] * y, 0) / W;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    cov += w[i] * dx * dy; vx += w[i] * dx * dx; vy += w[i] * dy * dy;
  }
  if (vx <= 0 || vy <= 0) return NaN;
  return cov / Math.sqrt(vx * vy);
}

function spearman(xs, ys) { return weightedSpearman(xs, ys, null); }
function weightedSpearman(xs, ys, weights) {
  if (xs.length < 2) return NaN;
  return weightedPearson(rankAverage(xs), rankAverage(ys), weights);
}

function rocAuc(scores, labels, weights) {
  const w = weights || scores.map(() => 1);
  let Wp = 0, Wn = 0;
  for (let i = 0; i < labels.length; i++) (labels[i] ? Wp += w[i] : Wn += w[i]);
  if (Wp === 0 || Wn === 0) return NaN;
  let num = 0;
  for (let i = 0; i < scores.length; i++) {
    if (!labels[i]) continue;
    for (let j = 0; j < scores.length; j++) {
      if (labels[j]) continue;
      if (scores[i] > scores[j]) num += w[i] * w[j];
      else if (scores[i] === scores[j]) num += 0.5 * w[i] * w[j];
    }
  }
  return num / (Wp * Wn);
}

function precisionRecall(scores, labels, threshold, weights) {
  const w = weights || scores.map(() => 1);
  let tp = 0, fp = 0, fn = 0;
  for (let i = 0; i < scores.length; i++) {
    const pred = scores[i] > threshold;
    if (pred && labels[i]) tp += w[i];
    else if (pred && !labels[i]) fp += w[i];
    else if (!pred && labels[i]) fn += w[i];
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

function bestF1Threshold(scores, labels, weights) {
  const cands = Array.from(new Set(scores)).sort((a, b) => a - b);
  // include a threshold just below the smallest score so "all predicted positive" is reachable
  cands.unshift(cands.length ? cands[0] - 1 : 0);
  let best = { threshold: cands[0], f1: -1 };
  for (const t of cands) {
    const { f1 } = precisionRecall(scores, labels, t, weights);
    if (f1 > best.f1) best = { threshold: t, f1 };
  }
  return best;
}

module.exports = { quantile, weightedQuantile, spearman, weightedSpearman, rocAuc, precisionRecall, bestF1Threshold };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/score-metrics.test.js` → PASS, prints "score-metrics tests passed".

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/score-metrics.test.js`.

- [ ] **Step 6: Commit**

```bash
git add harness/score/metrics.js tests/score-metrics.test.js package.json
git commit -m "feat(harness): add score metrics kit (SP3)"
```

---

### Task 4: Felt-truth ingestion (`felt.js`)

**Files:**
- Create: `harness/score/felt.js`
- Test: `tests/score-felt.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `recorder/constants.js` `CONSTANTS.WINDOW_DURATION_MS`.
- Produces:
  - `loadFelt(obj)` → `{ spans, events }`; throws `"felt: <reason>"` on a bad schema/field.
  - `mapFeltToWindows(felt, windows)` → array aligned to `windows` of `{ felt_present, felt_magnitude }`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/score-felt.test.js
"use strict";
const assert = require("assert");
const { loadFelt, mapFeltToWindows } = require("../harness/score/felt");

// loadFelt validation
assert.throws(() => loadFelt({ schema: "wrong" }), /felt:/);
assert.throws(() => loadFelt({ schema: "sensorynav-felt-v1", spans: "x", events: [] }), /felt:/);
assert.throws(() => loadFelt({ schema: "sensorynav-felt-v1", spans: [{ start_ms: 5, end_ms: 5, magnitude: 1 }], events: [] }), /felt:/);
assert.throws(() => loadFelt({ schema: "sensorynav-felt-v1", spans: [], events: [{ at_ms: 1, magnitude: NaN }] }), /felt:/);
const felt = loadFelt({
  schema: "sensorynav-felt-v1",
  spans: [{ start_ms: 1000, end_ms: 3000, magnitude: 3, category: "washboard" }],
  events: [{ at_ms: 5500, magnitude: 4 }]
});
assert.strictEqual(felt.spans.length, 1);

// mapFeltToWindows: 1s windows at t0=0..6.
const windows = [];
for (let i = 0; i < 7; i++) windows.push({ window_id: "w" + i, started_at_ms: i * 1000, duration_ms: 1000 });
const mapped = mapFeltToWindows(felt, windows);
assert.strictEqual(mapped.length, 7);
assert.strictEqual(mapped[0].felt_present, false);            // [0,1000) no overlap (span starts at 1000)
assert.strictEqual(mapped[1].felt_present, true);             // [1000,2000) overlaps span
assert.strictEqual(mapped[1].felt_magnitude, 3);
assert.strictEqual(mapped[2].felt_present, true);             // [2000,3000) overlaps span
assert.strictEqual(mapped[3].felt_present, false);            // [3000,4000) span end exclusive
assert.strictEqual(mapped[5].felt_present, true);             // event 5500 in [5000,6000)
assert.strictEqual(mapped[5].felt_magnitude, 4);

// max magnitude wins when both overlap.
const felt2 = loadFelt({ schema: "sensorynav-felt-v1", spans: [{ start_ms: 5000, end_ms: 6000, magnitude: 2 }], events: [{ at_ms: 5500, magnitude: 4 }] });
assert.strictEqual(mapFeltToWindows(felt2, windows)[5].felt_magnitude, 4);

console.log("score-felt tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/score-felt.test.js`
Expected: FAIL — `Cannot find module '../harness/score/felt'`.

- [ ] **Step 3: Write the implementation**

```javascript
// harness/score/felt.js
"use strict";
const { CONSTANTS } = require("../../recorder/constants");
const WINDOW_DURATION_MS = CONSTANTS.WINDOW_DURATION_MS;

function loadFelt(obj) {
  if (!obj || obj.schema !== "sensorynav-felt-v1") throw new Error("felt: schema must be sensorynav-felt-v1");
  if (!Array.isArray(obj.spans)) throw new Error("felt: spans must be an array");
  if (!Array.isArray(obj.events)) throw new Error("felt: events must be an array");
  for (const s of obj.spans) {
    if (!Number.isFinite(s.start_ms) || !Number.isFinite(s.end_ms)) throw new Error("felt: span needs finite start_ms/end_ms");
    if (s.end_ms <= s.start_ms) throw new Error("felt: span end_ms must exceed start_ms");
    if (!Number.isFinite(s.magnitude)) throw new Error("felt: span magnitude must be finite");
  }
  for (const e of obj.events) {
    if (!Number.isFinite(e.at_ms)) throw new Error("felt: event needs finite at_ms");
    if (!Number.isFinite(e.magnitude)) throw new Error("felt: event magnitude must be finite");
  }
  return { spans: obj.spans, events: obj.events };
}

function mapFeltToWindows(felt, windows) {
  return windows.map((w) => {
    const start = w.started_at_ms;
    const end = w.started_at_ms + (w.duration_ms || WINDOW_DURATION_MS);
    let present = false, mag = null;
    for (const s of felt.spans) {
      if (s.start_ms < end && s.end_ms > start) { present = true; mag = mag === null ? s.magnitude : Math.max(mag, s.magnitude); }
    }
    for (const e of felt.events) {
      if (e.at_ms >= start && e.at_ms < end) { present = true; mag = mag === null ? e.magnitude : Math.max(mag, e.magnitude); }
    }
    return { felt_present: present, felt_magnitude: present ? mag : null };
  });
}

module.exports = { loadFelt, mapFeltToWindows };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/score-felt.test.js` → PASS.

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/score-felt.test.js`.

- [ ] **Step 6: Commit**

```bash
git add harness/score/felt.js tests/score-felt.test.js package.json
git commit -m "feat(harness): add felt-truth loader + time join (SP3)"
```

---

### Task 5: Speed-conditioned baseline (`baseline.js`)

**Files:**
- Create: `harness/score/baseline.js`
- Test: `tests/score-baseline.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `metrics.js` `weightedQuantile`.
- Produces:
  - `fitBaseline(samples, params)` → `{ low, mid, high }` where each band = `{ points: [{ speed, floor }], global, meta: { qualified_bins, fell_back_to_global, n_samples } }`. `sample = { speed, low, mid, high, reliability }`. Throws `"baseline: no reliable samples for band <b>"` if a band has no `reliability > 0` samples.
  - `floorAt(baseline, band, speed)` → floor: ≥2 points interpolate, 1 point constant, 0 points → `global`.
  - `globalFloorAt(baseline, band)` → the speed-independent global floor.
  - `baselineMeta(baseline)` → `{ low: meta, mid: meta, high: meta }`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/score-baseline.test.js
"use strict";
const assert = require("assert");
const { fitBaseline, floorAt, globalFloorAt, baselineMeta } = require("../harness/score/baseline");

// Build samples across two speed ranges, low band cleanly separable.
// 25 samples near 5 m/s with low≈1..2 (floor ~1), 25 near 15 m/s with low≈3..4 (floor ~3).
function mk(speed, low) { return { speed, low, mid: low, high: low, reliability: 1 }; }
const samples = [];
for (let i = 0; i < 25; i++) samples.push(mk(5, 1 + i * 0.04));   // 1.00..1.96
for (let i = 0; i < 25; i++) samples.push(mk(15, 3 + i * 0.04));  // 3.00..3.96
const b = fitBaseline(samples, { MIN_BIN_SAMPLES: 20 });

// Two bins qualified; meta reflects it.
assert.strictEqual(baselineMeta(b).low.qualified_bins, 2);
assert.strictEqual(baselineMeta(b).low.fell_back_to_global, false);
// floorAt near 5 ≈ ~1 (10th pct of 1.00..1.96), near 15 ≈ ~3.
assert.ok(floorAt(b, "low", 5) < 1.5, `floor@5=${floorAt(b, "low", 5)}`);
assert.ok(floorAt(b, "low", 15) > 2.5, `floor@15=${floorAt(b, "low", 15)}`);
// interpolation between bin centers gives an intermediate floor at 10 m/s.
const f10 = floorAt(b, "low", 10);
assert.ok(f10 > floorAt(b, "low", 5) && f10 < floorAt(b, "low", 15), `f10=${f10}`);
// clamp beyond the ends.
assert.strictEqual(floorAt(b, "low", 0), floorAt(b, "low", 5));
assert.strictEqual(floorAt(b, "low", 99), floorAt(b, "low", 15));
// global null floor exists and is the low quantile across all.
assert.ok(globalFloorAt(b, "low") <= floorAt(b, "low", 15));

// Sparse: too few samples → 0 qualifying bins → global fallback.
const sparse = []; for (let i = 0; i < 5; i++) sparse.push(mk(7, 2 + i * 0.1));
const bs = fitBaseline(sparse, { MIN_BIN_SAMPLES: 20 });
assert.strictEqual(baselineMeta(bs).low.qualified_bins, 0);
assert.strictEqual(baselineMeta(bs).low.fell_back_to_global, true);
assert.strictEqual(floorAt(bs, "low", 7), globalFloorAt(bs, "low"));

// EPS_FLOOR clamp: all-zero energy → floor clamped up to EPS_FLOOR.
const zeros = []; for (let i = 0; i < 25; i++) zeros.push(mk(5, 0));
const bz = fitBaseline(zeros, { MIN_BIN_SAMPLES: 20 });
assert.strictEqual(globalFloorAt(bz, "low"), 1e-6);

// No reliable samples → throw.
assert.throws(() => fitBaseline([{ speed: 5, low: 1, mid: 1, high: 1, reliability: 0 }], {}), /no reliable samples/);

console.log("score-baseline tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/score-baseline.test.js`
Expected: FAIL — `Cannot find module '../harness/score/baseline'`.

- [ ] **Step 3: Write the implementation**

```javascript
// harness/score/baseline.js
"use strict";
const { weightedQuantile } = require("./metrics");

const DEFAULTS = { SPEED_BIN_MPS: 2.0, FLOOR_Q: 0.10, MIN_BIN_SAMPLES: 20, EPS_FLOOR: 1e-6 };
const BANDS = ["low", "mid", "high"];

function fitBand(reliable, band, p) {
  // global null-model floor
  const global = Math.max(p.EPS_FLOOR, weightedQuantile(reliable.map((s) => s[band]), reliable.map((s) => s.reliability), p.FLOOR_Q));

  // bucket by speed, then greedily accumulate buckets (in speed order) into qualifying bins
  const byBin = new Map();
  for (const s of reliable) {
    const k = Math.floor(s.speed / p.SPEED_BIN_MPS);
    if (!byBin.has(k)) byBin.set(k, []);
    byBin.get(k).push(s);
  }
  const keys = Array.from(byBin.keys()).sort((a, b) => a - b);
  const points = [];
  let buf = [];
  const flush = () => {
    const wsum = buf.reduce((s, x) => s + x.reliability, 0);
    const repSpeed = wsum > 0 ? buf.reduce((s, x) => s + x.reliability * x.speed, 0) / wsum : buf[0].speed;
    const floor = Math.max(p.EPS_FLOOR, weightedQuantile(buf.map((x) => x[band]), buf.map((x) => x.reliability), p.FLOOR_Q));
    points.push({ speed: repSpeed, floor });
    buf = [];
  };
  for (const k of keys) {
    buf = buf.concat(byBin.get(k));
    if (buf.length >= p.MIN_BIN_SAMPLES) flush();
  }
  if (buf.length) { // leftover merges into the last emitted bin, or is dropped if none qualified
    if (points.length) {
      // re-flush combined last bin: simplest correct behavior is to leave emitted bins as-is and ignore the sub-min tail
      buf = [];
    } else {
      buf = [];
    }
  }
  return { points: points.sort((a, b) => a.speed - b.speed), global, meta: { qualified_bins: points.length, fell_back_to_global: points.length === 0, n_samples: reliable.length } };
}

function fitBaseline(samples, params) {
  const p = Object.assign({}, DEFAULTS, params || {});
  const out = {};
  for (const band of BANDS) {
    const reliable = samples.filter((s) => s.reliability > 0);
    if (!reliable.length) throw new Error("baseline: no reliable samples for band " + band);
    out[band] = fitBand(reliable, band, p);
  }
  return out;
}

function floorAt(baseline, band, speed) {
  const pts = baseline[band].points;
  if (pts.length === 0) return baseline[band].global;
  if (pts.length === 1) return pts[0].floor;
  if (speed <= pts[0].speed) return pts[0].floor;
  if (speed >= pts[pts.length - 1].speed) return pts[pts.length - 1].floor;
  for (let i = 0; i < pts.length - 1; i++) {
    if (speed >= pts[i].speed && speed < pts[i + 1].speed) {
      const frac = (speed - pts[i].speed) / (pts[i + 1].speed - pts[i].speed);
      return pts[i].floor + frac * (pts[i + 1].floor - pts[i].floor);
    }
  }
  return pts[pts.length - 1].floor;
}

function globalFloorAt(baseline, band) { return baseline[band].global; }
function baselineMeta(baseline) { return { low: baseline.low.meta, mid: baseline.mid.meta, high: baseline.high.meta }; }

module.exports = { fitBaseline, floorAt, globalFloorAt, baselineMeta };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/score-baseline.test.js` → PASS.

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/score-baseline.test.js`.

- [ ] **Step 6: Commit**

```bash
git add harness/score/baseline.js tests/score-baseline.test.js package.json
git commit -m "feat(harness): add speed-conditioned baseline fit (SP3)"
```

---

### Task 6: Reliability model (`reliability.js`)

**Files:**
- Create: `harness/score/reliability.js`
- Test: `tests/score-reliability.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `windowReliability(sp1win, sp2rec, params)` → `{ reliability, flags }`. `sp1win` provides `clip_fraction`, `frame_count`, `near_floor`; `sp2rec` provides `speed_confidence`, `flags`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/score-reliability.test.js
"use strict";
const assert = require("assert");
const { windowReliability } = require("../harness/score/reliability");
const close = (a, b, t = 1e-9) => Math.abs(a - b) < t;

const goodSp1 = { clip_fraction: 0, frame_count: 45, near_floor: false };
const goodSp2 = { speed_confidence: 1, flags: [] };

// Perfect window → reliability 1, no flags.
let r = windowReliability(goodSp1, goodSp2, {});
assert.ok(close(r.reliability, 1));
assert.deepStrictEqual(r.flags, []);

// near_floor hard-zeros and flags.
r = windowReliability({ ...goodSp1, near_floor: true }, goodSp2, {});
assert.strictEqual(r.reliability, 0);
assert.ok(r.flags.includes("near_floor"));

// 2% clip → clipFactor 0 (CLIP_TOL 0.02) → reliability 0, "clipped".
r = windowReliability({ ...goodSp1, clip_fraction: 0.02 }, goodSp2, {});
assert.strictEqual(r.reliability, 0);
assert.ok(r.flags.includes("clipped"));

// partial window (frame_count 22 of 45) → frameFactor < 1, flagged.
r = windowReliability({ ...goodSp1, frame_count: 22 }, goodSp2, {});
assert.ok(close(r.reliability, 22 / 45));
assert.ok(r.flags.includes("partial_window"));

// speed_confidence carries through and flags; SP2 flags passed through.
r = windowReliability(goodSp1, { speed_confidence: 0.5, flags: ["interpolated"] }, {});
assert.ok(close(r.reliability, 0.5));
assert.ok(r.flags.includes("low_speed_confidence"));
assert.ok(r.flags.includes("interpolated"));

// interior window with 46 frames clamps frameFactor to 1.
r = windowReliability({ ...goodSp1, frame_count: 46 }, goodSp2, {});
assert.ok(close(r.reliability, 1));

console.log("score-reliability tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/score-reliability.test.js`
Expected: FAIL — `Cannot find module '../harness/score/reliability'`.

- [ ] **Step 3: Write the implementation**

```javascript
// harness/score/reliability.js
"use strict";

const DEFAULTS = { CLIP_TOL: 0.02, FULL_FRAMES: 45 };
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function windowReliability(sp1win, sp2rec, params) {
  const p = Object.assign({}, DEFAULTS, params || {});
  const speedFactor = sp2rec.speed_confidence;
  const clipFactor = clamp01(1 - sp1win.clip_fraction / p.CLIP_TOL);
  const frameFactor = clamp01(sp1win.frame_count / p.FULL_FRAMES);
  const floorGate = sp1win.near_floor ? 0 : 1;
  const reliability = speedFactor * clipFactor * frameFactor * floorGate;

  const flags = [];
  if (speedFactor < 1) flags.push("low_speed_confidence");
  if (clipFactor < 1) flags.push("clipped");
  if (frameFactor < 1) flags.push("partial_window");
  if (floorGate === 0) flags.push("near_floor");
  for (const f of (sp2rec.flags || [])) flags.push(f);

  return { reliability, flags };
}

module.exports = { windowReliability };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/score-reliability.test.js` → PASS.

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/score-reliability.test.js`.

- [ ] **Step 6: Commit**

```bash
git add harness/score/reliability.js tests/score-reliability.test.js package.json
git commit -m "feat(harness): add per-window reliability model (SP3)"
```

---

### Task 7: Roughness scorer (`roughness.js`)

**Files:**
- Create: `harness/score/roughness.js`
- Test: `tests/score-roughness.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `recorder/audio-scoring.js` `roughnessScoreRaw`; `baseline.js` `floorAt`, `globalFloorAt`.
- Produces: `scoreWindowRoughness(sp1win, speed, baseline, params)` → `{ roughness_raw, roughness, detected, magnitude }`. `sp1win` provides `low_energy`, `mid_energy`, `high_energy`. `params.useNullFloor` swaps to the global floor. `detected = roughness_raw > DETECT_TAU`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/score-roughness.test.js
"use strict";
const assert = require("assert");
const { scoreWindowRoughness } = require("../harness/score/roughness");

// A hand-built baseline: speed-conditioned low floor differs from global.
const baseline = {
  low:  { points: [{ speed: 5, floor: 1 }, { speed: 15, floor: 4 }], global: 1, meta: {} },
  mid:  { points: [{ speed: 5, floor: 1 }, { speed: 15, floor: 1 }], global: 1, meta: {} },
  high: { points: [{ speed: 5, floor: 1 }, { speed: 15, floor: 1 }], global: 1, meta: {} }
};
const win = { low_energy: 2, mid_energy: 1, high_energy: 1 };

// At 5 m/s, low floor = 1, so low residual = 2/1 - 1 = 1 → nonzero roughness.
const r5 = scoreWindowRoughness(win, 5, baseline, { DETECT_TAU: 12 });
assert.ok(r5.roughness_raw > 0);
assert.strictEqual(r5.roughness, Math.round(r5.roughness_raw));
assert.strictEqual(r5.magnitude, r5.roughness_raw);

// At 15 m/s, low floor = 4, so 2 < 4 → residual 0 → roughness 0.
const r15 = scoreWindowRoughness(win, 15, baseline, { DETECT_TAU: 12 });
assert.strictEqual(r15.roughness_raw, 0);
assert.strictEqual(r15.detected, false);

// useNullFloor uses global (1) regardless of speed → nonzero at 15.
const rNull = scoreWindowRoughness(win, 15, baseline, { DETECT_TAU: 12, useNullFloor: true });
assert.ok(rNull.roughness_raw > 0);

// detection threshold honored.
const big = { low_energy: 100, mid_energy: 100, high_energy: 100 };
assert.strictEqual(scoreWindowRoughness(big, 5, baseline, { DETECT_TAU: 12 }).detected, true);

console.log("score-roughness tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/score-roughness.test.js`
Expected: FAIL — `Cannot find module '../harness/score/roughness'`.

- [ ] **Step 3: Write the implementation**

```javascript
// harness/score/roughness.js
"use strict";
const { roughnessScoreRaw } = require("../../recorder/audio-scoring");
const { floorAt, globalFloorAt } = require("./baseline");

const DEFAULTS = { DETECT_TAU: 12 };

function scoreWindowRoughness(sp1win, speed, baseline, params) {
  const p = Object.assign({}, DEFAULTS, params || {});
  const floorFor = p.useNullFloor
    ? (band) => globalFloorAt(baseline, band)
    : (band) => floorAt(baseline, band, speed);
  const floor = { low: floorFor("low"), mid: floorFor("mid"), high: floorFor("high") };
  const energies = { low: sp1win.low_energy, mid: sp1win.mid_energy, high: sp1win.high_energy };
  const raw = roughnessScoreRaw(energies, { effective_floor: floor });
  return { roughness_raw: raw, roughness: Math.round(raw), detected: raw > p.DETECT_TAU, magnitude: raw };
}

module.exports = { scoreWindowRoughness };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/score-roughness.test.js` → PASS.

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/score-roughness.test.js`.

- [ ] **Step 6: Commit**

```bash
git add harness/score/roughness.js tests/score-roughness.test.js package.json
git commit -m "feat(harness): add speed-conditioned roughness scorer (SP3)"
```

---

### Task 8: Per-pass orchestrator (`score-pass.js`)

**Files:**
- Create: `harness/score/score-pass.js`
- Test: `tests/score-pass.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `roughness.js` `scoreWindowRoughness`; `reliability.js` `windowReliability`; `felt.js` `mapFeltToWindows`.
- Produces: `scorePass(sp1windows, sp2track, baseline, felt, params)` → array of records `{ window_id, started_at_ms, lat, lon, speed_mps, heading_deg, roughness_raw, roughness, detected, magnitude, roughness_null, reliability, reliability_flags, speed_source, sp2_flags, felt_present, felt_magnitude }`, one per window, joined by `window_id`. `felt` may be `null`. Throws `"scorePass: window_id <id> missing in SP2 track"` on a join miss. Retains `reliability == 0` rows.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/score-pass.test.js
"use strict";
const assert = require("assert");
const { scorePass } = require("../harness/score/score-pass");

const baseline = {
  low:  { points: [], global: 1, meta: {} },
  mid:  { points: [], global: 1, meta: {} },
  high: { points: [], global: 1, meta: {} }
};
function sp1(i, low, clip, frame, nf) { return { window_id: "w" + i, started_at_ms: i * 1000, duration_ms: 1000, low_energy: low, mid_energy: 1, high_energy: 1, clip_fraction: clip || 0, frame_count: frame == null ? 45 : frame, near_floor: !!nf }; }
function sp2(i, conf) { return { window_id: "w" + i, started_at_ms: i * 1000, lat: 45 + i * 1e-5, lon: -122, speed_mps: 10, heading_deg: 90, speed_confidence: conf == null ? 1 : conf, speed_source: "derived", flags: [] }; }

const win = [sp1(0, 5), sp1(1, 1), sp1(2, 5, 0, 45, true)];
const trk = [sp2(0), sp2(1), sp2(2)];

// null felt → all felt_present false; record shape + length.
const scored = scorePass(win, trk, baseline, null, {});
assert.strictEqual(scored.length, 3);
assert.strictEqual(scored[0].window_id, "w0");
assert.strictEqual(scored[0].felt_present, false);
assert.ok(scored[0].roughness_raw > 0);                 // low 5 vs global 1
assert.ok("roughness_null" in scored[0]);
assert.strictEqual(scored[0].lat, trk[0].lat);

// near_floor window retained with reliability 0 (NOT dropped).
assert.strictEqual(scored[2].reliability, 0);
assert.ok(scored[2].reliability_flags.includes("near_floor"));

// felt join.
const felt = { spans: [{ start_ms: 0, end_ms: 1500, magnitude: 3 }], events: [] };
const scored2 = scorePass(win, trk, baseline, felt, {});
assert.strictEqual(scored2[0].felt_present, true);
assert.strictEqual(scored2[0].felt_magnitude, 3);

// missing SP2 window → throw.
assert.throws(() => scorePass(win, [sp2(0), sp2(1)], baseline, null, {}), /missing in SP2 track/);

console.log("score-pass tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/score-pass.test.js`
Expected: FAIL — `Cannot find module '../harness/score/score-pass'`.

- [ ] **Step 3: Write the implementation**

```javascript
// harness/score/score-pass.js
"use strict";
const { scoreWindowRoughness } = require("./roughness");
const { windowReliability } = require("./reliability");
const { mapFeltToWindows } = require("./felt");

function scorePass(sp1windows, sp2track, baseline, felt, params) {
  const sp2By = new Map();
  for (const r of sp2track) sp2By.set(r.window_id, r);
  const feltMap = felt ? mapFeltToWindows(felt, sp1windows) : null;

  return sp1windows.map((w, i) => {
    const sp2 = sp2By.get(w.window_id);
    if (!sp2) throw new Error("scorePass: window_id " + w.window_id + " missing in SP2 track");
    const speed = sp2.speed_mps;
    const rough = scoreWindowRoughness(w, speed, baseline, params);
    const roughNull = scoreWindowRoughness(w, speed, baseline, Object.assign({}, params, { useNullFloor: true })).roughness_raw;
    const rel = windowReliability(w, sp2, params);
    return {
      window_id: w.window_id,
      started_at_ms: w.started_at_ms,
      lat: sp2.lat,
      lon: sp2.lon,
      speed_mps: speed,
      heading_deg: sp2.heading_deg,
      roughness_raw: rough.roughness_raw,
      roughness: rough.roughness,
      detected: rough.detected,
      magnitude: rough.magnitude,
      roughness_null: roughNull,
      reliability: rel.reliability,
      reliability_flags: rel.flags,
      speed_source: sp2.speed_source,
      sp2_flags: sp2.flags,
      felt_present: feltMap ? feltMap[i].felt_present : false,
      felt_magnitude: feltMap ? feltMap[i].felt_magnitude : null
    };
  });
}

module.exports = { scorePass };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/score-pass.test.js` → PASS.

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/score-pass.test.js`.

- [ ] **Step 6: Commit**

```bash
git add harness/score/score-pass.js tests/score-pass.test.js package.json
git commit -m "feat(harness): add per-pass scoring orchestrator (SP3)"
```

---

### Task 9: Validation (`validate.js`)

**Files:**
- Create: `harness/score/validate.js`
- Test: `tests/score-validate.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `metrics.js` `rocAuc`, `precisionRecall`, `bestF1Threshold`, `weightedSpearman`.
- Produces:
  - `validatePass(scored, params)` → summary `{ n_total, n_excluded, presence, magnitude }` where `presence` is `{ auc, auc_null, pr, pr_null, best_f1, status }` (`status` ∈ `"ok" | "no_felt" | "degenerate_labels"`) and `magnitude` is `{ spearman, spearman_null, n, status }` (`status` ∈ `"ok" | "no_felt" | "unstable"`).
  - `validateBatch(perPassScored, params)` → `{ per_pass: [...], aggregate: summary }` where the aggregate re-pools all passes' kept windows.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/score-validate.test.js
"use strict";
const assert = require("assert");
const { validatePass, validateBatch } = require("../harness/score/validate");

function rec(rr, present, mag, rel) {
  return { roughness_raw: rr, roughness_null: rr, reliability: rel == null ? 1 : rel, felt_present: present, felt_magnitude: present ? mag : null };
}

// Perfect separation + monotone magnitude → AUC 1, spearman 1.
const perfect = [rec(1, false, null), rec(2, false, null), rec(40, true, 2), rec(80, true, 4), rec(60, true, 3)];
const v = validatePass(perfect, { DETECT_TAU: 12, MIN_SPEARMAN_N: 3 });
assert.strictEqual(v.presence.status, "ok");
assert.ok(Math.abs(v.presence.auc - 1) < 1e-9);
assert.ok(Math.abs(v.magnitude.spearman - 1) < 1e-9);
assert.strictEqual(v.magnitude.n, 3);

// reliability==0 rows excluded from counts.
const withDead = perfect.concat([rec(99, true, 9, 0)]);
const v2 = validatePass(withDead, { DETECT_TAU: 12, MIN_SPEARMAN_N: 3 });
assert.strictEqual(v2.n_excluded, 1);

// no felt at all → status no_felt.
const none = [rec(1, false, null), rec(2, false, null)];
assert.strictEqual(validatePass(none, {}).presence.status, "no_felt");

// all-present → degenerate labels.
const allPos = [rec(10, true, 1), rec(20, true, 2)];
assert.strictEqual(validatePass(allPos, {}).presence.status, "degenerate_labels");

// too few felt-present → magnitude unstable.
const few = [rec(1, false, null), rec(50, true, 3), rec(60, true, 4)];
assert.strictEqual(validatePass(few, { MIN_SPEARMAN_N: 5 }).magnitude.status, "unstable");

// batch: per-pass + re-pooled aggregate.
const batch = validateBatch([perfect, perfect], { DETECT_TAU: 12, MIN_SPEARMAN_N: 3 });
assert.strictEqual(batch.per_pass.length, 2);
assert.ok(Math.abs(batch.aggregate.presence.auc - 1) < 1e-9);

console.log("score-validate tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/score-validate.test.js`
Expected: FAIL — `Cannot find module '../harness/score/validate'`.

- [ ] **Step 3: Write the implementation**

```javascript
// harness/score/validate.js
"use strict";
const { rocAuc, precisionRecall, bestF1Threshold, weightedSpearman } = require("./metrics");

const DEFAULTS = { DETECT_TAU: 12, MIN_SPEARMAN_N: 5 };

function buildSummary(scored, p) {
  const kept = scored.filter((r) => r.reliability > 0);
  const labels = kept.map((r) => (r.felt_present ? 1 : 0));
  const w = kept.map((r) => r.reliability);
  const scores = kept.map((r) => r.roughness_raw);
  const scoresNull = kept.map((r) => r.roughness_null);
  const nPos = labels.reduce((s, x) => s + x, 0);

  let presence;
  if (nPos === 0) {
    presence = { auc: NaN, auc_null: NaN, pr: null, pr_null: null, best_f1: null, status: "no_felt" };
  } else if (nPos === labels.length) {
    presence = { auc: NaN, auc_null: NaN, pr: null, pr_null: null, best_f1: null, status: "degenerate_labels" };
  } else {
    presence = {
      auc: rocAuc(scores, labels, w),
      auc_null: rocAuc(scoresNull, labels, w),
      pr: precisionRecall(scores, labels, p.DETECT_TAU, w),
      pr_null: precisionRecall(scoresNull, labels, p.DETECT_TAU, w),
      best_f1: bestF1Threshold(scores, labels, w),
      status: "ok"
    };
  }

  const present = kept.filter((r) => r.felt_present);
  let magnitude;
  if (!present.length) {
    magnitude = { spearman: NaN, spearman_null: NaN, n: 0, status: "no_felt" };
  } else {
    const ms = present.map((r) => r.roughness_raw);
    const mn = present.map((r) => r.roughness_null);
    const mm = present.map((r) => r.felt_magnitude);
    const mw = present.map((r) => r.reliability);
    magnitude = {
      spearman: weightedSpearman(ms, mm, mw),
      spearman_null: weightedSpearman(mn, mm, mw),
      n: present.length,
      status: present.length < p.MIN_SPEARMAN_N ? "unstable" : "ok"
    };
  }

  return { n_total: scored.length, n_excluded: scored.length - kept.length, presence, magnitude };
}

function validatePass(scored, params) {
  return buildSummary(scored, Object.assign({}, DEFAULTS, params || {}));
}

function validateBatch(perPassScored, params) {
  const p = Object.assign({}, DEFAULTS, params || {});
  const pooled = [];
  for (const s of perPassScored) for (const r of s) pooled.push(r);
  return { per_pass: perPassScored.map((s) => buildSummary(s, p)), aggregate: buildSummary(pooled, p) };
}

module.exports = { validatePass, validateBatch };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/score-validate.test.js` → PASS.

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/score-validate.test.js`.

- [ ] **Step 6: Commit**

```bash
git add harness/score/validate.js tests/score-validate.test.js package.json
git commit -m "feat(harness): add felt-vs-computed validation (SP3)"
```

---

### Task 10: Report writer (`report.js`)

**Files:**
- Create: `harness/score/report.js`
- Test: `tests/score-report.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces (all return strings):
  - `scoredWindowsJson(scored)`, `sessionSummaryJson(summary)` — `JSON.stringify(..., null, 2)`.
  - `scoredWindowsCsv(scored)` — header row + one row per record.
  - `inspectionHtml(scored, summary)` — self-contained dark-mode page; "no scorable windows" panel when every row has `reliability == 0`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/score-report.test.js
"use strict";
const assert = require("assert");
const { scoredWindowsJson, sessionSummaryJson, scoredWindowsCsv, inspectionHtml } = require("../harness/score/report");

const scored = [
  { window_id: "w0", started_at_ms: 0, lat: 45, lon: -122, speed_mps: 10, heading_deg: 90, roughness_raw: 17.4, roughness: 17, detected: true, magnitude: 17.4, roughness_null: 12.1, reliability: 1, reliability_flags: [], speed_source: "derived", sp2_flags: [], felt_present: true, felt_magnitude: 3 },
  { window_id: "w1", started_at_ms: 1000, lat: 45, lon: -122, speed_mps: 10, heading_deg: 90, roughness_raw: 0, roughness: 0, detected: false, magnitude: 0, roughness_null: 0, reliability: 0, reliability_flags: ["near_floor"], speed_source: "derived", sp2_flags: [], felt_present: false, felt_magnitude: null }
];
const summary = { per_pass: [], aggregate: { n_total: 2, n_excluded: 1, presence: { auc: 0.9, status: "ok" }, magnitude: { spearman: 0.8, n: 1, status: "unstable" } } };

assert.ok(scoredWindowsJson(scored).includes("\"window_id\": \"w0\""));
assert.ok(sessionSummaryJson(summary).includes("\"auc\""));

const csv = scoredWindowsCsv(scored);
const lines = csv.trim().split("\n");
assert.strictEqual(lines.length, 3);                       // header + 2 rows
assert.ok(lines[0].includes("window_id") && lines[0].includes("roughness_raw"));
assert.ok(lines[1].includes("w0"));

const html = inspectionHtml(scored, summary);
assert.ok(html.includes("#1a1a1a") && html.includes("#dcdcdc")); // dark palette
assert.ok(!/src\s*=\s*["']https?:/i.test(html));           // self-contained, no network
assert.ok(html.includes("w0"));

// empty/fully-excluded → no-scorable-windows panel.
const deadHtml = inspectionHtml([scored[1]], summary);
assert.ok(/no scorable windows/i.test(deadHtml));

console.log("score-report tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/score-report.test.js`
Expected: FAIL — `Cannot find module '../harness/score/report'`.

- [ ] **Step 3: Write the implementation**

```javascript
// harness/score/report.js
"use strict";

const COLS = ["window_id", "started_at_ms", "lat", "lon", "speed_mps", "heading_deg",
  "roughness_raw", "roughness", "detected", "magnitude", "roughness_null",
  "reliability", "reliability_flags", "speed_source", "sp2_flags", "felt_present", "felt_magnitude"];

function scoredWindowsJson(scored) { return JSON.stringify(scored, null, 2); }
function sessionSummaryJson(summary) { return JSON.stringify(summary, null, 2); }

function csvCell(v) {
  if (Array.isArray(v)) v = v.join("|");
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function scoredWindowsCsv(scored) {
  const rows = [COLS.join(",")];
  for (const r of scored) rows.push(COLS.map((c) => csvCell(r[c])).join(","));
  return rows.join("\n") + "\n";
}

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function inspectionHtml(scored, summary) {
  const anyScorable = scored.some((r) => r.reliability > 0);
  const head = `<!doctype html><html><head><meta charset="utf-8"><title>SensoryNav SP3 inspection</title>
<style>
  body{background:#1a1a1a;color:#dcdcdc;font-family:system-ui,sans-serif;margin:1rem;}
  .panel{background:#555;padding:1rem;border-radius:6px;margin-bottom:1rem;}
  table{border-collapse:collapse;width:100%;} th,td{border:1px solid #666;padding:4px 8px;text-align:right;}
  th{background:#666;} td.id{text-align:left;} tr.dead{color:#888;}
</style></head><body>`;
  const summaryPanel = `<div class="panel"><h2>Session summary</h2><pre>${esc(JSON.stringify(summary.aggregate || summary, null, 2))}</pre></div>`;
  if (!anyScorable) {
    return head + summaryPanel + `<div class="panel"><strong>No scorable windows</strong> — every window had reliability 0.</div></body></html>`;
  }
  const header = "<tr>" + COLS.map((c) => `<th>${c}</th>`).join("") + "</tr>";
  const body = scored.map((r) => {
    const cls = r.reliability === 0 ? ' class="dead"' : "";
    return `<tr${cls}>` + COLS.map((c) => {
      const v = Array.isArray(r[c]) ? r[c].join("|") : (r[c] === null ? "" : r[c]);
      return `<td${c === "window_id" ? ' class="id"' : ""}>${esc(v)}</td>`;
    }).join("") + "</tr>";
  }).join("");
  return head + summaryPanel + `<table>${header}${body}</table></body></html>`;
}

module.exports = { scoredWindowsJson, sessionSummaryJson, scoredWindowsCsv, inspectionHtml };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/score-report.test.js` → PASS.

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/score-report.test.js`.

- [ ] **Step 6: Commit**

```bash
git add harness/score/report.js tests/score-report.test.js package.json
git commit -m "feat(harness): add dark-mode report writer (SP3)"
```

---

### Task 11: IO driver + end-to-end smoke (CHECKPOINT)

**Files:**
- Create: `harness/score/run-scorer.js`
- Test: `tests/score-run.test.js`
- Modify: `package.json`, `.gitignore`

**Interfaces:**
- Consumes: `load-pass.js` (`loadPass`), `audio-windows.js` (`framesToWindows`), `motion-track.js` (`buildMotionTrack`), `baseline.js` (`fitBaseline`, `baselineMeta`), `reliability.js` (`windowReliability`), `score-pass.js` (`scorePass`), `validate.js` (`validateBatch`), `report.js`.
- Produces:
  - `scorePasses(passes, params)` (pure) where `passes = [{ sp1windows, sp2track, felt }]` → `{ baseline, baseline_meta, per_pass_scored, batch }`.
  - `runScorer({ passFiles, outDir, params })` (IO) → loads each pass file via `loadPass`, derives SP1/SP2, calls `scorePasses`, writes `scored-<i>.json`, `summary.json`, `scored-<i>.csv`, `inspection-<i>.html` to `outDir`. Returns the summary object.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/score-run.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { scorePasses, runScorer } = require("../harness/score/run-scorer");
const { framesToWindows } = require("../harness/audio/audio-windows");
const { buildMotionTrack } = require("../harness/motion/motion-track");
const { loadPass } = require("../harness/audio/load-pass");

// --- Synthetic multi-pass: qualifies bins → speed-conditioned path + validation ---
function synthPass(passId, base, withFelt) {
  const sp1 = [], sp2 = [];
  for (let i = 0; i < 30; i++) {
    const rough = i >= 10 && i < 14; // a felt-rough stretch
    sp1.push({ window_id: "w" + i, started_at_ms: base + i * 1000, duration_ms: 1000,
      low_energy: rough ? 6 : 1, mid_energy: rough ? 6 : 1, high_energy: rough ? 6 : 1,
      clip_fraction: 0, frame_count: 45, near_floor: false });
    sp2.push({ window_id: "w" + i, started_at_ms: base + i * 1000, lat: 45, lon: -122,
      speed_mps: 5 + (i % 12), heading_deg: 90, speed_confidence: 1, speed_source: "derived", flags: [] });
  }
  const felt = withFelt ? { spans: [{ start_ms: base + 10000, end_ms: base + 14000, magnitude: 4 }], events: [] } : null;
  return { sp1windows: sp1, sp2track: sp2, felt };
}
const passes = [synthPass("p1", 1000000, true), synthPass("p2", 2000000, true), synthPass("p3", 3000000, true)];
const res = scorePasses(passes, {});
assert.strictEqual(res.per_pass_scored.length, 3);
assert.strictEqual(res.per_pass_scored[0].length, 30);
// rough windows score higher than smooth, and the felt agreement is strong.
assert.ok(res.per_pass_scored[0][11].roughness_raw > res.per_pass_scored[0][0].roughness_raw);
assert.strictEqual(res.batch.aggregate.presence.status, "ok");
assert.ok(res.batch.aggregate.presence.auc > 0.9);

// --- Real johnson-creek pass: end-to-end, asserts global-fallback + no-felt path ---
const sidecar = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "johnson-creek-pass-1-163508.json"), "utf8"));
const loaded = loadPass(path.join(__dirname, "..", "data", "johnson-creek-pass-1-163508.json"));
const sp1real = framesToWindows(loaded.samples, loaded.sampleRate, sidecar.audio_first_frame_ms);
const sp2real = buildMotionTrack(sidecar.gps_samples, sp1real.map((w) => ({ window_id: w.window_id, started_at_ms: w.started_at_ms })), {});
const realRes = scorePasses([{ sp1windows: sp1real, sp2track: sp2real, felt: null }], {});
// sparse single pass → baseline collapses to global for every band.
assert.strictEqual(realRes.baseline_meta.low.fell_back_to_global, true);
assert.strictEqual(realRes.batch.aggregate.presence.status, "no_felt");

// --- runScorer writes the four artifacts to a temp dir ---
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp3-"));
const summary = runScorer({ passFiles: [path.join(__dirname, "..", "data", "johnson-creek-pass-1-163508.json")], outDir, params: {} });
assert.ok(fs.existsSync(path.join(outDir, "summary.json")));
assert.ok(fs.existsSync(path.join(outDir, "scored-0.json")));
assert.ok(fs.existsSync(path.join(outDir, "scored-0.csv")));
assert.ok(fs.existsSync(path.join(outDir, "inspection-0.html")));
assert.ok(summary.aggregate);

console.log("score-run tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/score-run.test.js`
Expected: FAIL — `Cannot find module '../harness/score/run-scorer'`.

- [ ] **Step 3: Write the implementation**

```javascript
// harness/score/run-scorer.js
"use strict";
const fs = require("fs");
const path = require("path");
const { loadPass } = require("../audio/load-pass");
const { framesToWindows } = require("../audio/audio-windows");
const { buildMotionTrack } = require("../motion/motion-track");
const { fitBaseline, baselineMeta } = require("./baseline");
const { windowReliability } = require("./reliability");
const { scorePass } = require("./score-pass");
const { validateBatch } = require("./validate");
const { scoredWindowsJson, sessionSummaryJson, scoredWindowsCsv, inspectionHtml } = require("./report");

// Pure core: passes = [{ sp1windows, sp2track, felt }].
function scorePasses(passes, params) {
  // First pass: pool (speed, band energies, reliability) samples across all passes.
  const samples = [];
  for (const pass of passes) {
    const sp2By = new Map();
    for (const r of pass.sp2track) sp2By.set(r.window_id, r);
    for (const w of pass.sp1windows) {
      const sp2 = sp2By.get(w.window_id);
      if (!sp2) throw new Error("scorePasses: window_id " + w.window_id + " missing in SP2 track");
      const { reliability } = windowReliability(w, sp2, params);
      samples.push({ speed: sp2.speed_mps, low: w.low_energy, mid: w.mid_energy, high: w.high_energy, reliability });
    }
  }
  const baseline = fitBaseline(samples, params);
  const per_pass_scored = passes.map((pass) => scorePass(pass.sp1windows, pass.sp2track, baseline, pass.felt, params));
  const batch = validateBatch(per_pass_scored, params);
  return { baseline, baseline_meta: baselineMeta(baseline), per_pass_scored, batch };
}

function loadPassToWindows(passFile, params) {
  const sidecar = JSON.parse(fs.readFileSync(passFile, "utf8"));
  const loaded = loadPass(passFile);
  const sp1windows = framesToWindows(loaded.samples, loaded.sampleRate, sidecar.audio_first_frame_ms);
  const sp2track = buildMotionTrack(sidecar.gps_samples, sp1windows.map((w) => ({ window_id: w.window_id, started_at_ms: w.started_at_ms })), params);
  const felt = sidecar.felt || null; // optional inline felt; file-based felt can be wired by the caller
  return { sp1windows, sp2track, felt };
}

// IO driver.
function runScorer(opts) {
  const params = opts.params || {};
  const passes = opts.passFiles.map((f) => loadPassToWindows(f, params));
  const res = scorePasses(passes, params);
  fs.mkdirSync(opts.outDir, { recursive: true });
  const summary = Object.assign({}, res.batch, { baseline_meta: res.baseline_meta });
  fs.writeFileSync(path.join(opts.outDir, "summary.json"), sessionSummaryJson(summary));
  res.per_pass_scored.forEach((scored, i) => {
    fs.writeFileSync(path.join(opts.outDir, "scored-" + i + ".json"), scoredWindowsJson(scored));
    fs.writeFileSync(path.join(opts.outDir, "scored-" + i + ".csv"), scoredWindowsCsv(scored));
    fs.writeFileSync(path.join(opts.outDir, "inspection-" + i + ".html"), inspectionHtml(scored, summary));
  });
  return summary;
}

module.exports = { scorePasses, runScorer };
```

- [ ] **Step 4: Run the test, then the full suite (CHECKPOINT)**

Run: `node tests/score-run.test.js` → PASS, prints "score-run tests passed".
Then **run the full suite**: `npm test`. Expected: every prior "… passed" line prints, exit 0, no error.

- [ ] **Step 5: Wire into package.json and .gitignore**

Append ` && node tests/score-run.test.js` to the `test` script. Add `out/` to `.gitignore` (create the file if absent) so geolocated artifacts are never committed.

- [ ] **Step 6: Commit**

```bash
git add harness/score/run-scorer.js tests/score-run.test.js package.json .gitignore
git commit -m "feat(harness): add SP3 IO driver + end-to-end smoke (SP3)"
```

---

## Self-Review

**1. Spec coverage:**
- FR-1 SP2 lat/lon → Task 2. ✓
- FR-2 stats kit → Task 3. ✓
- FR-3 speed-conditioned floor / FR-4 global null / FR-17 baseline_meta / FR-18 floorAt rules → Task 5. ✓
- FR-5 felt load / FR-6 time join → Task 4. ✓
- FR-7 reliability → Task 6. ✓
- FR-8 roughness (continuous + display) / FR-8a roughnessScoreRaw → Tasks 7, 1. ✓
- FR-9 per-pass records, join, retain zero-rel → Task 8. ✓
- FR-10 presence / FR-11 magnitude / FR-12 null A/B / FR-13 edge cases / FR-14 batch → Task 9. ✓
- FR-15 outputs / FR-16 IO driver / NFR-6 git-ignored outputs → Tasks 10, 11. ✓
- NFR-1 no deps, NFR-2 reuse, NFR-3 dark HTML, NFR-4 function size, NFR-5 desync throw, NFR-7 data-volume fallback → distributed; NFR-5 in Task 8, NFR-7 asserted in Task 11. ✓
- SC-1 perfect-match AUC/ρ=1 → Task 9 test. SC-2 null delta → Tasks 9/11. SC-3 real pass global-fallback → Task 11. SC-4 multi-pass speed-conditioned → Task 11. ✓

**2. Placeholder scan:** No TBD/TODO; every code step is complete and runnable.

**3. Type consistency:** `sample = {speed,low,mid,high,reliability}` is produced in Task 11's `scorePasses` and consumed by `fitBaseline` (Task 5) identically. `baseline` shape `{band:{points:[{speed,floor}],global,meta}}` is produced by Task 5 and read by `floorAt`/`globalFloorAt` (Task 5) and `scoreWindowRoughness` (Task 7). The scored-record keys (Task 8) match `COLS` in `report.js` (Task 10) and the fields `validate.js` reads (Task 9: `roughness_raw`, `roughness_null`, `reliability`, `felt_present`, `felt_magnitude`). `roughnessScoreRaw` (Task 1) is consumed by Task 7. SP2 `lat`/`lon` (Task 2) are read in Task 8. All consistent.

**Note on baseline merge tail:** `fitBand` emits a qualifying bin each time the accumulating buffer reaches `MIN_BIN_SAMPLES`; a sub-minimum tail is dropped (folded into "did not qualify"), which keeps every emitted bin at or above threshold — matching the spec's "merge until satisfied; else global fallback" intent without an unbounded widen loop.

---

## Execution

Use **superpowers:subagent-driven-development**, Sonnet per task (user rule), sequential. All eleven tasks gate on green node tests; the Task 11 checkpoint runs the full `npm test`.
