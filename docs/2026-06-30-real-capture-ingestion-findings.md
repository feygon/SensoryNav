# Real-Capture Ingestion Findings — Johnson Creek Rd, 2026-06-30

First real drive captures (car back from AC repair), ingested through the built harness (SP1 audio front-end + SP2 motion track). **SP3 (the scorer) is not yet implemented**, so this is an ingestion/sanity pass, not a roughness scoring — it validates the real data against what exists and calibrates expectations for SP3.

## Captures in `data/`

| Set | Time | WAV | Sidecar | GPS fixes / duration | Median accuracy | Role |
|---|---|---|---|---|---|---|
| `johnson-creek-pass-1-163508` | Jun 26 | 2.4 MB | 1.8 KB | 3 fixes / 25 s | 100–212 m | Throwaway test (existing smoke fixture) |
| `johnson-creek-pass-1-131504` | Jun 30 13:20 | 33.7 MB | 77 KB | 342 fixes / 340 s | 7.0 m | Shakedown ("just making sure it worked") |
| `johnson-creek-pass-1-134511` | Jun 30 13:52 | 41.4 MB | 96 KB | **429 fixes / 428 s** | **1.5 m** | **The real pass** (ingested below) |

All three are `sensorynav-capture-v1`, 48 kHz audio, GPS at ~1.0 Hz. `speed_mps` (Doppler) present on nearly every fix (1 null in `131504`, 4 in `134511`).

## Method

`loadPass(wav, json)` → SP1 `framesToWindows` → 432 one-second windows; `buildMotionTrack(gps_samples, windows, {})` → SP2 track. Full decode + score of the 41 MB / 7.2 min pass took **5.4 s**. Pure offline, no dependencies.

## SP1 audio results (`134511`, 432 windows)

- **Zero clipping** (`clip_fraction` max 0.0000; no window with any clipped sample).
- **Zero `near_floor`** windows.
- `rms` [min/med/max]: 0.025 / 0.144 / 0.253.
- Band energy [min/med/max]: low 0.000/0.001/0.006, mid ≈ 0.000/0.000/0.001, high ≈ 0. Energy concentrated in the **low band** — low-frequency road/engine rumble, as expected.

## SP2 motion results (`134511`, 432 records)

- Speed [min/med/max]: **0.0 / 13.1 / 19.2 m/s** (~43 mph max) — a real drive with stops and cruising.
- `speed_source`: **400 `native_crosschecked`** (Doppler agreed with position-derived speed) + 32 `derived`.
- `flags`: 48 `stationary` (start/stops), 24 `doppler_mismatch`, 4 `low_accuracy`.
- `speed_confidence` [min/med/max]: **0.016 / 0.225 / 0.250**.

## Findings

### 1. Audio hygiene is excellent — the Blue Yeti is not needed
Zero clipping and zero near-floor windows across 7+ minutes. The phone mic and gain are well within range for this vehicle/mount. The clipping-check that was queued for the first capture (see `memory/project-real-trip-captures.md`) is resolved: **stay on the phone mic.**

### 2. `speed_confidence` is compressed low on real GPS — a `VAR_SCALE` calibration signal (defer)
SP2 computes `speed_confidence = 1 / (1 + velTraceVar / VAR_SCALE)` with `VAR_SCALE = 1.0`. On real ~1.5 m GPS the velocity-variance trace lands in the steep part of that curve, so confidence caps at **0.25** (median 0.225). It still discriminates (0.016–0.25, a 15× spread), but since **SP3 reliability = `speed_confidence × clip × frame × floorGate`**, every window would be scaled to ≤ 0.25.

**Decision: do NOT tune `VAR_SCALE` yet.** Reasons:
- It is already `params`-overridable in SP2 (`DEFAULTS.VAR_SCALE`, read by `confidenceFromCov`); `run-scorer` passes `params` through to `buildMotionTrack`, so **no code change is needed** — SP3 can run `{ VAR_SCALE: N }` directly.
- There is **no calibration target** until SP3 + felt annotations can measure whether a change improves computed-vs-felt agreement. Tuning in isolation is guessing.
- It is a **monotonic, relative** weight; SP3's weighted-quantile (baseline) and weighted-correlation (validation) care about relative window weights, so near-uniform compression ≈ unweighted, a defensible default.
- SP3 is the instrument built to answer "does this knob help," via the same null-model A/B pattern it already runs for the baseline.

**Plan:** once SP3 exists, sweep `VAR_SCALE` (e.g. 1, 4, 9) as a `params` value and keep whichever maximizes presence/magnitude agreement on an annotated pass.

### 3. These passes are the fixtures SP3's baseline actually needs
The 3-fix test pass (`163508`) can't populate the speed-conditioned baseline's bins — SP3's design (§3.1) has it collapse to the global-fallback floor, which is asserted as such in the plan's smoke test. The real passes (`134511`: 429 fixes across a 0–19 m/s range; `131504`: 342 fixes) **will** populate `SPEED_BIN_MPS` bins, so real speed-conditioning becomes testable for the first time. After SP3 is built, run the real passes through `run-scorer` for actual roughness output; keep the synthetic multi-pass fixture for deterministic unit tests.

## Implications for SP3 execution

- **Task 2 (SP2 lat/lon) confirmed pending:** the ingestion's position readout errored because `buildMotionTrack` does not yet emit `lat`/`lon` on this branch (that is Task 2 of the plan). No other issue.
- **Felt annotations still owed for validation:** to get presence/magnitude numbers on `134511`, author a `sensorynav-felt-v1` file (per-pass, epoch-ms, post-hoc from the recording). Without it SP3 scores the pass and emits the inspection table but reports `no_felt`.
- **No blockers surfaced.** The real data ingests cleanly through SP1+SP2; the SP3 plan (`docs/superpowers/plans/2026-06-29-sensorynav-harness-sp3-scorer.md`, 11 tasks) is unaffected and ready to execute on branch `feat/sensorynav-harness-sp3`.

## Next steps

1. Execute SP3 (subagent-driven, Sonnet per task) — see `.superpowers/sdd/progress.md`.
2. Author `sensorynav-felt-v1` for `134511` (and optionally `131504`).
3. Run `run-scorer` on the real passes; sweep `VAR_SCALE` against felt agreement.
