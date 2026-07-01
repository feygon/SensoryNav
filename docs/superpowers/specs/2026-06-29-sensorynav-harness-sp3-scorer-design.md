# SensoryNav Harness SP3 — Research Scorer & Felt-Validation (Design)

**Status:** READY — passed the Requirements Rubric gate (R1 = 38/45 → R2 = 43/45; 0 critical/high, no open should-fix). Cleared for `writing-plans`.
**Date:** 2026-06-29
**Scope:** SP3 only. SP1 (audio front-end) and SP2 (motion track) are built and merged. Road-condition classification (SP4), the SP1 phase-2 feature extension, cross-pass aggregation, and the on-device app scorer are all **deferred** and appear here only as downstream context.

---

## 1. Purpose & context

The ingestion harness turns each captured drive pass (`.wav` + `sensorynav-capture-v1` sidecar) into per-second roughness scores so **computed** roughness can be validated against **felt** experience on a known road (Johnson Creek Rd). SP1 produces per-1-second-window spectral features; SP2 fuses GPS into a smooth per-window speed + heading + confidence.

**SP3 is the offline research scorer/validator.** For one pass it computes, per window: a **roughness** score (the residual above a speed-conditioned baseline floor), a **detection** flag and **spike magnitude**, and a **reliability** weight; then it validates those against per-pass felt annotations. A baseline-fit step pools samples across the vehicle's passes first.

Because the harness is offline (SP2 already uses an acausal RTS smoother), SP3 may use whole-pass and pooled-per-vehicle information. The on-device app scorer is a later, causal re-derivation and is **out of scope**.

### Staged research progression (why SP3 scores only presence + magnitude)
1. **Presence (primary):** did computed roughness fire where a disturbance was felt, and stay quiet where it wasn't? Foundational — if it can't separate "something happened" from "smooth," nothing downstream matters.
2. **Spike magnitude (secondary):** among felt-present windows, does computed magnitude track *how big* it felt?
3. **Qualitative category (DEFERRED, SP4 + SP1 feature extension):** pothole vs. washboard vs. slab rhythm, etc. See `docs/sp4-road-condition-taxonomy.md`. SP3 records an optional `category` in felt files for SP4 but does **not** score it.

---

## 2. Scope

**In scope:**
- A small extension to SP2's motion-track record to emit per-window `lat`/`lon`.
- Per-pass scoring: speed-conditioned lower-envelope baseline → roughness residual → detection + magnitude → reliability.
- Felt-truth ingestion (`sensorynav-felt-v1`) and per-pass **time-based** join to windows.
- Validation: presence (ROC/PR) + magnitude (Spearman), reliability-weighted, with a speed-independent **null-model A/B**.
- Outputs: scored-windows JSON, session-summary JSON, a dark-mode HTML inspection report, and a CSV of scored windows.
- A disk/IO orchestrator that batches over passes.

**Out of scope (deferred):**
- Road-condition **categories** (SP4) and the SP1 phase-2 feature extension (periodicity, crest factor, spectral flatness).
- Cross-pass **aggregation** into per-location/direction priors, and in-situ prediction (before/pattern/predicted-after).
- The on-device **app scorer** (causal, online baseline, low-power).
- Any change to the product's no-raw-audio-export guarantee; research captures are a local dev/research exception.

---

## 3. Inputs

Per pass, all on a shared **epoch-ms** clock:

1. **SP1 windows** — array of `{ window_id, started_at_ms, duration_ms, frame_count, low_energy, mid_energy, high_energy, rms, clip_fraction, near_floor }` (from `harness/audio/audio-windows.js`).
2. **SP2 track (extended)** — array aligned to the same windows: `{ window_id, started_at_ms, lat, lon, speed_mps, heading_deg, speed_confidence, speed_source, flags }`. `lat`/`lon` are new in this spec (§4.1). Joined to SP1 by `window_id`.
3. **Felt file (optional)** — `sensorynav-felt-v1` (§4.4). If absent, the pass is scored but not validated.

Multiple passes of the same vehicle feed the **baseline fit** (§4.3). Disk reading lives in `run-scorer.js` / existing `load-pass.js`; every other module is a pure function over in-memory inputs.

### 3.1 Data-volume precondition (speed-conditioning is data-hungry; global fallback is the default until then)

Speed-conditioning only engages where a 2 m/s speed bin reaches `MIN_BIN_SAMPLES` (20) reliable windows pooled across passes. A meaningful speed-conditioned curve for a band needs roughly **≥ 2 qualifying bins**, i.e. ~40+ reliable windows spread across ≥ 2 speed ranges — realistically **several passes**, not one. The one real pass on hand (`data/johnson-creek-pass-1-163508.json`, 3 GPS fixes / ~25 windows) will **not** populate bins; its baseline collapses to the **global floor** (§4.3 step 5, 0-bin case), and many windows carry low `speed_confidence` → low reliability. This is expected and not a failure: the design degrades gracefully to the speed-independent null model and **reports** that it did (`baseline_meta`, §4.3). SC-3 (§7) exercises exactly this global-fallback path and asserts it; the speed-conditioned path is exercised on **synthetic** multi-pass fixtures with enough samples to qualify bins.

**Single-vehicle batch precondition:** the baseline is pooled **per vehicle**, so a `run-scorer.js` batch (and the `validateBatch` re-pooled aggregate, §4.8) is **single-vehicle** — every pass in one run is the same car/tires. Multi-vehicle pooling (different baselines per vehicle) is out of scope here and belongs to the deferred cross-vehicle aggregation work (§12).

---

## 4. Components

### 4.1 SP2 extension — per-window position (prerequisite task)

`harness/motion/motion-track.js` already computes the smoothed state `s = [x, y, vx, vy]` via `evaluateAt`, and `buildMotionTrack` already holds `lat0`/`lon0` from `projectFixes` (currently discarded). Extend the per-window record with:

```
lat = lat0 + y / (R_EARTH * DEG)
lon = lon0 + x / (R_EARTH * DEG * cos(lat0 * DEG))
```

reusing the exported `R_EARTH` from `geo-project.js` and `DEG = π/180` (the exact inverse of `projectFixes`; do not re-declare `R_EARTH`). **Threading:** `buildMotionTrack` already destructures `projectFixes(...)`; change it to keep `{ points, lat0, lon0 }` and pass `lat0, lon0` into `windowMotion`, which computes `lat`/`lon` and emits them in the record after `started_at_ms`. There are **two emit sites** and both must set the keys: (1) `windowMotion` (normal path) emits the inverted lat/lon; (2) the existing `< 2 fixes` early-return branch emits `lat = null, lon = null` (no track). SP2's existing tests are updated for the new keys; a new test asserts the projection round-trips (`projectFixes` then invert ≈ identity to < 1e-6°).

### 4.2 `metrics.js` — pure statistics kit

Row-major-free, plain numbers. Functions:
- `quantile(values, q)` and `weightedQuantile(values, weights, q)` — linear-interpolated percentile; `q ∈ [0,1]`. Empty input throws `"quantile: empty"`.
- `spearman(xs, ys)` and `weightedSpearman(xs, ys, weights)` — rank correlation; ties via average ranks; returns a number in `[-1,1]`, or `NaN` if `n < 2` or zero variance (caller reports `n/a`).
- `rocAuc(scores, labels, weights)` — weighted area under ROC; `labels` are `0/1`; returns `NaN` if labels are all-one or all-zero.
- `precisionRecall(scores, labels, threshold, weights)` → `{ precision, recall, f1 }` (weighted); `bestF1Threshold(scores, labels, weights)` → `{ threshold, f1 }` scanning candidate thresholds (the distinct values present in `scores`).

All weighted variants treat a missing `weights` as all-ones. **All ranking/threshold metrics operate on the continuous `roughness_raw` (§4.6), never the rounded integer `roughness`** — this is what makes ROC and Spearman tie-free.

### 4.3 `baseline.js` — speed-conditioned lower-envelope floor

`fitBaseline(samples, params)` where each `sample = { speed, low, mid, high, reliability }` pooled across the vehicle's passes (built by `run-scorer.js` from the scored windows of every pass, **before** final scoring — a first pass over the data).

Algorithm, **per band** independently (`low`, `mid`, `high`):
1. Drop samples with `reliability == 0`.
2. Bucket by speed into `SPEED_BIN_MPS`-wide bins (default `2.0`), bin index `floor(speed / SPEED_BIN_MPS)`.
3. For each bin with `≥ MIN_BIN_SAMPLES` (default `20`) effective samples, compute `weightedQuantile(energy, reliability, FLOOR_Q)` (default `FLOOR_Q = 0.10`). A bin's **representative speed** is the reliability-weighted mean speed of its pooled samples (not the nominal bin center — so merged/uneven bins sit where their data actually is).
4. Bins below `MIN_BIN_SAMPLES` merge into the nearest neighbor bin (widen until satisfied); if no bin qualifies, fall back to the **global** floor for that band.
5. `floorAt(baseline, band, speed)`:
   - **≥ 2 qualifying bins** → linearly interpolate between adjacent bins' representative speeds; speeds beyond the end representatives **clamp** to the end bin's value.
   - **exactly 1 qualifying bin** → constant floor (that bin's quantile) at all speeds. This is the expected real-data case until enough passes accumulate (§3.1).
   - **0 qualifying bins** → returns the global floor for the band.

**Precondition / honesty (see §3.1):** on a single short pass almost no 2 m/s bin reaches 20 samples, so the speed-conditioned curve degenerates to a constant or to the global floor. `fitBaseline` therefore returns `baseline_meta` per band: `{ qualified_bins, fell_back_to_global (bool), n_samples }`, which `run-scorer.js` surfaces in the session summary so a reader can see whether speed-conditioning actually engaged or collapsed to global.

`fitBaseline` also always computes the **null-model** global floor per band: `weightedQuantile(all reliable energies for the band, reliabilities, FLOOR_Q)`, exposed as `globalFloorAt(baseline, band)` (speed-independent). Both the speed-conditioned floor and the global floor are clamped up to `EPS_FLOOR = ENERGY_FLOOR_MIN` (1e-6) to avoid divide-by-tiny in the residual. If a band has **no** reliable samples at all, `fitBaseline` throws `"baseline: no reliable samples for band <b>"` (§6).

### 4.4 `felt.js` — felt-truth ingestion & time join

`sensorynav-felt-v1` schema:
```json
{
  "schema": "sensorynav-felt-v1",
  "pass_id": "johnson-creek-pass-1",
  "clock": "epoch_ms",
  "spans":  [ { "start_ms": 0, "end_ms": 0, "magnitude": 0, "category": "optional" } ],
  "events": [ { "at_ms": 0, "magnitude": 0, "category": "optional" } ]
}
```
- `loadFelt(obj)` validates: `schema === "sensorynav-felt-v1"`, `spans`/`events` arrays present (either may be empty), every `magnitude` a finite number, every span `end_ms > start_ms`. Violations throw `"felt: <reason>"`. `category` is preserved but unused by SP3.
- `mapFeltToWindows(felt, windows)` → for each window `{ window_id }` returns `{ felt_present, felt_magnitude }`:
  - A window's time interval is `[started_at_ms, started_at_ms + (duration_ms || WINDOW_DURATION_MS))` — the window's actual `duration_ms` so the (rare) trailing partial window isn't over-counted; full windows are `WINDOW_DURATION_MS`.
  - **Present** if any span overlaps the interval (`span.start_ms < windowEnd && span.end_ms > windowStart`) or any event falls inside it (`windowStart ≤ at_ms < windowEnd`).
  - `felt_magnitude` = the **max** magnitude among all overlapping spans/events (most severe wins); `null` when not present.

### 4.5 `reliability.js` — per-window trust weight

`windowReliability(sp1win, sp2rec, params)` → `{ reliability, flags }`, `reliability ∈ [0,1]`:
```
speedFactor = sp2rec.speed_confidence                              // already [0,1]; 0 for gap_unscored / insufficient_fixes
clipFactor  = clamp(1 - sp1win.clip_fraction / CLIP_TOL, 0, 1)     // CLIP_TOL default 0.02
frameFactor = clamp(sp1win.frame_count / FULL_FRAMES, 0, 1)        // FULL_FRAMES derived (§8)
floorGate   = sp1win.near_floor ? 0 : 1
reliability = speedFactor * clipFactor * frameFactor * floorGate
```
`flags` collects human-readable causes when a factor bites: `"low_speed_confidence"` (speedFactor < 1), `"clipped"` (clipFactor < 1), `"partial_window"` (frameFactor < 1), `"near_floor"` (floorGate == 0), plus SP2's own `flags` passed through.

`near_floor` is a hard gate: a no-signal window (dead/blocked mic, engine off) cannot be trusted and must not define the baseline floor. Silent-smooth road is **not** `near_floor` (it is real signal near the fitted floor) and is unaffected.

### 4.6 `roughness.js` — residual, detection, magnitude

The recorder's existing `roughnessScore(windowEnergies, baseline)` (`recorder/audio-scoring.js`) computes a weighted per-band residual above an `effective_floor` and returns `clamp(round(raw · SCORE_SCALE), 0, 100)` — a **rounded integer**. Rounding is fine for human display but would flood the magnitude Spearman (FR-11) with ties and make detection flip in unit steps. So:

**Recorder change (single residual implementation, honoring NFR-2):** refactor `recorder/audio-scoring.js` to expose `roughnessScoreRaw(windowEnergies, baseline)` returning the **continuous, unrounded** `clamp(raw · SCORE_SCALE, 0, 100)`; `roughnessScore` becomes `Math.round(roughnessScoreRaw(...))`. The integer output of `roughnessScore` is byte-for-byte unchanged (verified by the existing recorder test), so this is a non-breaking extraction, not a re-implementation.

SP3 supplies a **speed-conditioned** floor per window and ranks on the continuous value:

```
floor = { low:  floorAt(baseline,"low",  speed),
          mid:  floorAt(baseline,"mid",  speed),
          high: floorAt(baseline,"high", speed) }
roughness_raw = roughnessScoreRaw({low,mid,high}, { effective_floor: floor })  // continuous 0..100
roughness     = Math.round(roughness_raw)                                       // integer, DISPLAY only
detected      = roughness_raw > DETECT_TAU                                       // threshold on continuous; DETECT_TAU default 12
magnitude     = roughness_raw                                                    // the spike size IS the continuous scalar
```
`scoreWindowRoughness(sp1win, speed, baseline, params)` returns `{ roughness_raw, roughness, detected, magnitude }`. A `useNullFloor` option swaps `floorAt` for `globalFloorAt` to produce `roughness_null` (continuous) for the §4.8 A/B. **Every metric in §4.8 ranks/thresholds on `roughness_raw` / `roughness_null`; the integer `roughness` appears only in the HTML/CSV display.**

### 4.7 `score-pass.js` — per-pass orchestrator

`scorePass(sp1windows, sp2track, baseline, felt, params)` → array, one record per window, joined by `window_id`:
```
{ window_id, started_at_ms, lat, lon, speed_mps, heading_deg,
  roughness_raw, roughness, detected, magnitude, roughness_null,
  reliability, reliability_flags, speed_source, sp2_flags,
  felt_present, felt_magnitude }
```
`felt` may be `null` → `felt_present = false`, `felt_magnitude = null` for all. Order and length match `sp1windows`. `scorePass` **retains every window, including `reliability == 0` rows** — they appear in the scored JSON/CSV/HTML for inspection (you want to *see* the dead/clipped windows); only the baseline fit (§4.3) and validation (§4.8) drop them. If an SP1 window has no matching SP2 `window_id`, that is a hard error `"scorePass: window_id <id> missing in SP2 track"` (the join must not silently desync).

### 4.8 `validate.js` — felt-vs-computed agreement

`validatePass(scored, params)` → a summary object. Excludes windows with `reliability == 0`. Over the remaining windows (ranking/thresholding on the **continuous** `roughness_raw`):
- **Presence:** `rocAuc(roughness_raw, felt_present, reliability)`; `precisionRecall(roughness_raw, felt_present, DETECT_TAU, reliability)` at the **fixed operating point** `DETECT_TAU`; and `bestF1Threshold(roughness_raw, felt_present, reliability)` reported **alongside** as the data-driven optimum (so you can see if `DETECT_TAU` wants tuning). `DETECT_TAU` is the frozen headline operating point; `bestF1` is reference-only and does not replace it.
- **Null-model A/B:** the identical presence metrics on `roughness_null` → `auc_null`, `pr_null` (**using the same `DETECT_TAU`** so the A/B is apples-to-apples), and `bestF1` on `roughness_null`.
- **Magnitude:** over felt-present windows only, `weightedSpearman(roughness_raw, felt_magnitude, reliability)`; and on `roughness_null` → `spearman_null`.
- **Edge cases (reported, not hidden):** no felt (all `felt_present` false) → presence/magnitude `n/a` with reason `"no_felt"`; all-present or all-absent → AUC `n/a` reason `"degenerate_labels"`; `< MIN_SPEARMAN_N` (default `5`) felt-present windows → spearman flagged `unstable` with its `n`.

`validateBatch(perPassScored[], params)` → per-pass summaries **plus** an aggregate computed by **re-pooling all passes' (non-zero-reliability) windows into one set and recomputing the metrics over that pool** (not by averaging per-pass numbers — pooled and averaged metrics differ, and pooled is the correct cross-pass picture).

### 4.9 `report.js` & `run-scorer.js` — outputs & IO

`report.js` (pure, returns strings):
- `scoredWindowsJson(scored)` and `sessionSummaryJson(batchSummary)` — canonical machine outputs. The session summary includes the per-band `baseline_meta` (§4.3: `qualified_bins`, `fell_back_to_global`, `n_samples`) so a reader can tell whether speed-conditioning engaged or collapsed to global, plus exclusion counts by reason.
- `scoredWindowsCsv(scored)` — flat CSV of the scored records.
- `inspectionHtml(scored, summary)` — a **self-contained** dark-mode static page (inline CSS, no network/deps): summary panel, then the per-window table with roughness/reliability color-coded and the felt overlay column. Colors: bg `#1a1a1a`, text `#dcdcdc`, containers mid-gray (`#555`/`#666`); no pure-white surfaces. The table is **unpaginated** — intended for research passes (≤ ~a few thousand windows); no large-scale rendering bound is in scope. A pass with **every window excluded** (`reliability == 0`) renders a clear "no scorable windows" panel instead of an empty table.

`run-scorer.js` (the only IO module): load each pass (`load-pass.js` + SP1 `framesToWindows` + SP2 `buildMotionTrack`), build pooled baseline samples (first pass), `fitBaseline`, `scorePass` each, `validateBatch`, and write the four artifacts to an output directory. The summary currently reports a scalar `n_excluded` count (per pass and in the re-pooled aggregate). **Deferred enhancement:** a per-reason breakdown of exclusions (`near_floor` vs `clipped` vs `partial_window` vs `low_speed_confidence`) tallied from the scored records' `reliability`/`reliability_flags` — the scored records already carry `reliability_flags`, so this is an additive summary field to add when an analyst needs it. Not implemented in the initial build; no FR/NFR/SC depends on it.

**Output-artifact privacy:** the scored JSON/CSV/HTML embed per-window `lat`/`lon` — a precise location trace. `run-scorer.js` writes them to a **git-ignored** output directory (default `out/score/`, added to `.gitignore`); these artifacts are **never committed**, consistent with the local-research-exception posture (research captures and their geolocated derivatives stay local, off any product/export path).

---

## 5. Data flow

```
pass files ─> load-pass ─> SP1 framesToWindows ─┐
                        └> SP2 buildMotionTrack ─┼─ join by window_id ─> per-window {energies, speed, lat/lon, quality}
                                                 │
all passes ──────────────────────────────────────┴─> pooled {speed, low/mid/high, reliability} samples
                                                          │
                                                  fitBaseline ─> floorAt / globalFloorAt
                                                          │
per window: floor=f(speed) ─> roughnessScore ─> {roughness, detected, magnitude}; roughness_null via globalFloor
            reliability = windowReliability(...)
            felt = mapFeltToWindows(...)
                          │
                   scorePass ─> validatePass / validateBatch ─> report (JSON, CSV, dark HTML)
```

---

## 6. Error handling

- **Missing SP2 window for an SP1 `window_id`** → hard throw (no silent desync).
- **Malformed felt file** → `loadFelt` throws `"felt: <reason>"`; a *missing* felt file is allowed (validation skipped).
- **Empty/degenerate stats** → `metrics` returns `NaN`; `validate` maps `NaN`/degenerate inputs to explicit `n/a` + reason strings (never a thrown error from the metric itself).
- **Baseline with no qualifying bins** for a band → global-floor fallback; if even the global floor has no reliable samples (all windows excluded) → throw `"baseline: no reliable samples for band <b>"`.
- **Floor below `EPS_FLOOR`** → clamped up to `EPS_FLOOR`.

---

## 7. Testing

Node `assert` scripts, chained into `npm test` (same convention as SP1/SP2). Each file ends `console.log("<name> tests passed")`.
- `audio-scoring` (recorder) — `roughnessScore` output is **byte-for-byte unchanged** after the `roughnessScoreRaw` extraction (existing recorder test still passes); `roughnessScoreRaw` returns the continuous pre-round value and `Math.round` of it equals `roughnessScore`.
- `metrics` — weighted `quantile` (known answer), `spearman` (ρ = 1 monotone, ρ = −1 antitone, ties), `rocAuc` (perfect = 1, random ≈ 0.5, degenerate = NaN), `precisionRecall` + `bestF1Threshold`.
- `felt` — `loadFelt` accept/reject cases; span-overlap and event-in-window boundaries (using each window's `duration_ms`); max-magnitude wins.
- `baseline` — synthetic multi-pass samples that **qualify ≥ 2 bins** → known interpolated per-bin floor; reliability weighting moves the floor; sparse-bin merge with reliability-weighted representative speed; **single-qualifying-bin → constant floor**; **0-bin → global floor**; `baseline_meta` counts correct; global null model; `EPS_FLOOR` clamp; no-reliable-samples throw.
- `reliability` — each factor independently; the four flags; hard `near_floor` zero; product; `FULL_FRAMES = 45` known answer.
- `roughness` — `roughness_raw` continuous + `roughness = round(raw)`; matches `roughnessScoreRaw` under a known speed-conditioned floor; `detected` thresholds on `roughness_raw`; null-floor path.
- `score-pass` — join by `window_id`; missing-window throw; null-felt path; **`reliability == 0` rows retained** in output; record shape/length.
- `validate` — synthetic perfect match (continuous `roughness_raw`) → AUC = 1, ρ = 1; null-vs-speed-cond delta; pooled `validateBatch` aggregate re-pools windows (≠ per-pass average); the three edge cases (`no_felt`, `degenerate_labels`, `unstable`).
- `report` — JSON/CSV shape (incl. `baseline_meta` in summary); HTML is self-contained (no `http`/`src=http`), dark palette present.
- **End-to-end smoke** on the real `data/johnson-creek-pass-1-163508.json` pass: scores end-to-end, asserts the **global-fallback** path (`baseline_meta.fell_back_to_global == true`, §3.1) and the no-felt validation-skipped path; plus a synthetic **multi-pass** fixture (felt + enough samples) exercising the speed-conditioned + validated path.
- **SP2 patch** — `lat`/`lon` round-trip the projection inversion; `< 2 fixes` branch emits `lat/lon = null`.

---

## 8. Tunable defaults

All `params`-overridable:

| Name | Default | Meaning |
|---|---|---|
| `SPEED_BIN_MPS` | `2.0` | baseline speed-bin width |
| `FLOOR_Q` | `0.10` | lower-envelope quantile |
| `MIN_BIN_SAMPLES` | `20` | min effective samples per baseline bin before merge |
| `CLIP_TOL` | `0.02` | clip fraction at which `clipFactor` hits 0 |
| `FULL_FRAMES` | derived (**= 45** at 48 kHz) | expected FFT frames in a full window = `floor((samplesPerWindow − FFT_SIZE)/HOP) + 1`; `samplesPerWindow = round(sampleRate·WINDOW_DURATION_MS/1000)`, `HOP = FFT_SIZE/2`. At `sampleRate 48000`: `samplesPerWindow 48000`, `FULL_FRAMES = floor((48000−2048)/1024)+1 = 45`. NB `framesToWindows` assigns frames by center-sample (`audio-windows.js`), so an interior window can legitimately hold 44–46 frames; `frameFactor`'s `clamp(…,0,1)` caps such windows at 1 (no penalty) and only genuinely short/partial windows score `< 1`. The `reliability` test uses 45 as its known answer. |
| `DETECT_TAU` | `12` | roughness above which `detected = true` (operating threshold) |
| `MIN_SPEARMAN_N` | `5` | min felt-present windows before magnitude ρ is trusted |
| `EPS_FLOOR` | `1e-6` | floor lower clamp (= `ENERGY_FLOOR_MIN`) |

`WINDOW_DURATION_MS`, `FFT_SIZE`, `WEIGHTS`, `SCORE_SCALE`, `ENERGY_FLOOR_MIN` come from `recorder/constants.js`.

---

## 9. Module structure

New `harness/score/` (vanilla JS, Node-only `module.exports`, no dependencies):
`metrics.js`, `felt.js`, `baseline.js`, `reliability.js`, `roughness.js`, `score-pass.js`, `validate.js`, `report.js`, `run-scorer.js`. Plus two edits to existing code: the SP2 patch to `harness/motion/motion-track.js` (§4.1) and the `roughnessScoreRaw` extraction in `recorder/audio-scoring.js` (§4.6). Tests under `tests/`.

---

## 10. Constraints (global)

- **No dependencies.** Vanilla JS. Node-only modules → plain `module.exports = { ... }`.
- **Reuse** `recorder/audio-scoring.js` and `recorder/constants.js`; the only recorder change is extracting `roughnessScoreRaw` (§4.6) with `roughnessScore` unchanged — do not otherwise re-implement the residual or redefine constants.
- **Dark-mode** HTML only (bg `#1a1a1a`, text `#dcdcdc`, gray containers; no pure white) per the standing visual-accommodation requirement.
- **Function size** ~100 lines/function target, 300 hard; decompose orchestrators into the named helpers above.
- **No raw-audio export path** touched; research captures stay a local exception. Scored output artifacts embed `lat`/`lon` and are written to a **git-ignored** dir (`out/score/`), never committed (§4.9).

---

## 11. Requirements traceability

| ID | Requirement | Component |
|---|---|---|
| FR-1 | SP2 emits per-window `lat`/`lon` (projection inverse) | §4.1 |
| FR-2 | Pure stats kit: weighted quantile, spearman, rocAuc, precision/recall, bestF1 | §4.2 |
| FR-3 | Speed-conditioned per-band lower-envelope floor (per-bin weighted quantile, interpolated, clamped) | §4.3 |
| FR-4 | Global speed-independent null-model floor | §4.3 |
| FR-5 | `sensorynav-felt-v1` load + validation | §4.4 |
| FR-6 | Felt→window **time** join (span overlap / event-in-window; max magnitude) | §4.4 |
| FR-7 | Per-window reliability = speed × clip × frame × floorGate, with flags | §4.5 |
| FR-8 | Roughness via reused residual; **continuous `roughness_raw`** for ranking + integer `roughness` for display; detection on `roughness_raw`; magnitude | §4.6 |
| FR-8a | `roughnessScoreRaw` extracted in recorder; `roughnessScore` output unchanged | §4.6 |
| FR-9 | Per-pass scored records joined by `window_id`, length == windows, null-felt path, **zero-reliability rows retained** | §4.7 |
| FR-10 | Presence validation on `roughness_raw` (ROC-AUC, P/R/F1 at fixed `DETECT_TAU`, bestF1 reference), reliability-weighted | §4.8 |
| FR-11 | Magnitude validation (weighted Spearman on `roughness_raw` over felt-present) | §4.8 |
| FR-12 | Null-model A/B (speed-cond vs global floor) on presence & magnitude, **same `DETECT_TAU`** | §4.8 |
| FR-13 | Edge cases reported as `n/a` + reason (`no_felt`, `degenerate_labels`, `unstable`) | §4.8 |
| FR-14 | Batch over passes: per-pass + aggregate by **re-pooling windows** (not averaging) | §4.8/§4.9 |
| FR-15 | Outputs: scored JSON, summary JSON (+ `baseline_meta`), CSV, dark-mode self-contained HTML | §4.9 |
| FR-16 | IO orchestrator builds pooled baseline then scores/validates/writes to git-ignored dir | §4.9 |
| FR-17 | `baseline_meta` per band (qualified bins / global-fallback / n) surfaced in summary | §4.3/§4.9 |
| FR-18 | `floorAt` rules: ≥2 bins interpolate, 1 bin constant, 0 bins global; rep speed = weighted mean | §4.3 |
| NFR-1 | No dependencies; Node-only `module.exports` | §10 |
| NFR-2 | Reuse residual (`roughnessScoreRaw`/`roughnessScore`) + constants; no re-implementation | §10 |
| NFR-3 | Dark-mode HTML only | §10 |
| NFR-4 | Function-size limits / decomposition | §10 |
| NFR-5 | Hard throw on SP1↔SP2 `window_id` desync | §4.7/§6 |
| NFR-6 | Geolocated output artifacts git-ignored, never committed | §4.9/§10 |
| NFR-7 | Data-volume precondition stated; graceful global-fallback when under-data | §3.1 |
| SC-1 | Synthetic perfect-match pass (continuous ranking) → AUC = 1, ρ = 1 | §7 |
| SC-2 | Null-vs-speed-conditioned delta computed and reported | §7 |
| SC-3 | Real johnson-creek pass scores end-to-end via the **asserted global-fallback** path | §7 |
| SC-4 | Synthetic multi-pass fixture qualifies ≥2 bins → speed-conditioned + validated path exercised | §7 |

---

## 12. Deferred / downstream (not built here)

- **SP4** road-condition classifier + **SP1 phase-2** feature extension (periodicity, crest factor, spectral flatness) — `docs/sp4-road-condition-taxonomy.md`.
- **Cross-pass aggregation** into per-location/direction priors; in-situ prediction (before/pattern/predicted-after); conditional SP4 firing.
- **App scorer** — causal, online/adaptive baseline, low-power gating.
