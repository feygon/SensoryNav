# Spec: Spectral-Chaos Metric + Tag-Extraction Layer

Status: **design / PRD** · 2026-07-05 · Slice 1 of the
[full chain](../../sensorynav-full-chain-intentions.md)

**TL;DR:** The amplitude-based "chaos" metric failed — an idling stop did not read quiet, because
loud-but-rhythmic ≠ chaotic. Replace it with **spectral tonality** (harmonic-to-noise) in a
first-class **sub-bass 20–80 Hz** band using **frequency-adaptive windows**; reshape the output from
a scalar into governed **tags** (value + confidence per event); **fold** level + baseline + delta +
chaos into one line per band. Make-or-break: an idle stop reads quiet.

## Contents
- [Context](#context)
- [Goals and success criteria](#goals-and-success-criteria)
- [Scope](#scope)
- [Architecture](#architecture)
  - [Metric: spectral tonality with adaptive windows](#metric-spectral-tonality-with-adaptive-windows)
  - [Tag-extraction layer](#tag-extraction-layer)
  - [Event detection](#event-detection-req-5)
  - [Build order](#build-order-dependency-ordered)
  - [Folded display](#folded-display)
- [Data contracts](#data-contracts)
- [Validation and testing](#validation-and-testing)
- [Non-goals and deferred](#non-goals-and-deferred)
- [Open questions](#open-questions)

## Context

The research scorer measures road roughness as **delta-dB loudness** (per-band level above a
speed-conditioned smooth-road floor), which aggregates by location well (ICC 0.63). A second
dimension — **chaos** — was added to capture *felt harshness* distinct from loudness. The first
chaos metric measured **amplitude-envelope spread × (1−autocorr periodicity)** and failed its
make-or-break test: an idling stop did not read quiet (chaos 2.04 ≈ driving 2.35), because
amplitude swing ≠ chaos (a flywheel-steadied engine is loud-but-periodic).

Reframed vocabulary (2026-07-05): **loudness ↔ decibels/amplitude; chaos ↔ frequency-stability.**
Chaos means "the frequency is all over the place" (broadband, shifting — cracks, seams, gravel);
the opposite is tonal/periodic (a stable harmonic comb — engine, or a regular texture whose tone
tracks speed). Measuring frequency stability requires **enough cycles to resolve the comb**, so
low frequencies need **longer windows** (constant-Q).

Empirical pivot: idle-vs-road discriminates only in a **sub-bass 20–80 Hz** band (the engine's
firing fundamental/low harmonics live below 80 Hz). Stop vs drive, spectral tonality: sub-bass
**0.78 / 0.67** ✅ vs low 80–250 0.72 / 0.75 ✗. The 80–250 "low" band is broadband either way.

This slice redesigns the chaos metric around **spectral tonality** in a **first-class sub-bass
band** with **frequency-adaptive windows**, and reshapes the metric output from a scalar into a
**tag set** (per [tag-architecture.md](../../tags/tag-architecture.md)) — the substrate for the
later aggregator/classifier.

## Goals and success criteria

- **REQ-1 — Make-or-break: a stop goes quiet.** In sub-bass (20–80 Hz), idle (speed < 0.5 m/s)
  reads high tonality; moving-over-rough (speed ≥ 8 m/s on non-smooth segments) reads low tonality.
  **Acceptance:** median sub-bass tonality(idle) − median tonality(moving-rough) **≥ 0.15** with
  **non-overlapping inter-quartile ranges**, AND the event detector yields **zero high-chaos events
  during a verified idle stop** (REQ-5).
- **REQ-2 — Reproducibility documented, not degraded.** Re-run `aggregate-squelch.js` on the new
  tonality/chaos. **Acceptance:** positional ICC on the strongest chaos band is reported alongside
  the delta-dB 0.63 baseline. A lower chaos-ICC does **not** block the slice — chaos is a
  felt/real-time dimension, delta-dB stays the positional map metric; the requirement is that the
  number is measured and recorded.
- **REQ-3 — Tag output.** The layer emits the v0 starter tags (value + confidence) per event; a tag
  reaches `status: validated` only after its `discrimination_test` reproduces on the captures.
- **REQ-4 — Folded display.** One line per band carries level+baseline+delta AND chaos; sub-bass
  has its own folded panel; events surface tags via tooltips. Dark-mode, no pure-white surfaces,
  CVD-safe.
- **REQ-5 — Event detection.** Deterministic, parameterized, unit-tested (see Event detection).

Every test, tag registry record, and tag `discrimination_test` cites the REQ-ID it serves.

## Scope

**In:** spectral-tonality chaos; sub-bass 20–80 Hz first-class + its own baseline; adaptive
windows; HNR tonality measure; tag-extraction layer emitting v0 tags with confidence; tag-registry
schema + inclusion methodology (already drafted in tag-architecture.md, formalized here);
event detection for tagging; the folded single-line display (Q1 = option A); validation reruns;
legacy-visualization snapshot.

**Out (own later specs):** the aggregator; the classifier (tags → "manhole 74%"); the multi-route
negative-space map; the privacy/vocal-deletion upload pipeline; the accelerometer app; on-device /
real-time / battery concerns (offline research tooling only).

## Architecture

Offline tooling under `scripts/` + shared `harness/`-style modules. Components:

- **`harness/score/spectral-chaos.js`** (new, tested) — pure DSP: FFT, per-band spectral tonality
  (HNR), adaptive windowing. No I/O.
- **`harness/tags/`** (new) — tag registry records (`registry/<name>.json`) + `extract.js` that
  turns per-event spectral features into tag values+confidences per the schema.
- **`harness/score/baseline.js`** (modify) — add a sub-bass (20–80 Hz) band to the
  speed-conditioned floor so delta-dB works in sub-bass.
- **`scripts/squelch-extract.js`** (modify) → writes `squelch-clean.json` (spectral chaos) +
  `tags-clean.json` (per-event tags).
- **`scripts/plot-timeline.js`** (modify) — folded band display + tag tooltips; sub-bass panel.
- **`scripts/aggregate-squelch.js`** (modify) — rerun reproducibility on the new metric.

### Metric: spectral tonality with adaptive windows

For each band, over a sliding hop (0.25 s), take a Hann-windowed FFT sized to resolve the comb at
the band's low edge (~3 periods; **5 for sub-bass** to keep a suspension/cargo ring as one event
rather than fragmenting it into false chaos). At 48 kHz:

| band | range | N_periods | window (samples) | covers f ≥ |
|---|---|---|---|---|
| sub-bass | 20–80 Hz | 5 | 16384 (3→8192 tunable) | ~15 Hz |
| low | 80–250 Hz | 3 | 2048 | ~70 Hz |
| mid | 250–1000 Hz | 3 | 1024 | ~141 Hz |
| high | 1000–4000 Hz | 3 | 512 | ~281 Hz |

**Tonality ∈ [0, 1]** = harmonic-to-noise via **spectral peak prominence**: `sum(energy in bins
exceeding a percentile-smoothed spectral floor, e.g. local median × k) ÷ total band energy`, clamped
to [0, 1] (tonal comb → 1; broadband → 0). Spectral flatness is retained only as the
discrimination-test comparison baseline. **Chaos = 1 − tonality** (also [0, 1]); for display it maps
to line hue/thickness via a single constant **`CHAOS_DISPLAY_DB = 8`** (chaos × 8 → dB-ish
thickness), replacing the prototype's `FLAT_TO_DB`.

**Near-silence / degradation:** when a band's level is within **`BAND_SNR_MIN = 6 dB`** of the
per-run noise floor (or the tonality denominator → 0 at near-silence), tonality is emitted with
**confidence 0** — never a spurious high reading — and that window cannot seed an event. This guards
the sub-bass mic-self-noise case (Open Questions).

**These window sizes and the peak-prominence tonality SUPERSEDE the prototype** `SBANDS` /
spectral-flatness in `scripts/lib/squelch.js` (currently subbass 8192 / low 8192 / mid 2048 /
high 1024): update the constant to subbass 16384 / low 2048 / mid 1024 / high 512 — do not reuse
the old values.

Per-window output: `{ t, level_db, tonality (0–1), chaos (0–1), peak_freqs }`, where **`peak_freqs`
= up to 5 dominant in-band peak frequencies in Hz, descending by prominence; `[]` when none clear.**

Design constraints honored:
- **Window ≥ ring length.** The suspension/cargo impulse-response ring is one event; sub-bass
  window (5 periods, 16384 ≈ 340 ms) is long enough not to split it into fake chaos. Validate
  against the ring-decay tag.
- **Vehicle-coupled by construction** — the per-run baseline already isolates per-vehicle/condition
  offset; the measure is "road as felt through this car," which is correct for felt experience.
- **Speed-locked discriminator deferred** — texture tone tracks speed, engine tracks RPM; the
  `speed-locked` tag is registered but built later.

### Tag-extraction layer

Consumes per-event spectral features + delta-dB level + reliability, emits v0 tags (see
tag-architecture.md starter set): `sub-bass-ratio, tonality, onset-sharpness, ring-decay,
bandwidth, level, duration, speech-contaminated` (+ `speed-locked` future). Each tag returns
`{ value, confidence }`. Every tag must pass its `discrimination_test` on the captures before
`status: validated`.

**Confidence model.** `confidence = reliability_factor × measure_sharpness × accel_cap`, each in
[0, 1]:
- `reliability_factor` — the window reliability the pipeline already computes: **0** if clipping
  ≥ 2% of samples, **0** if `near_floor`, **0** if speech-contaminated *for mid/high tags only*
  (sub-bass/low tags ignore the speech flag — speech is mid/high); otherwise the SP2 reliability.
- `measure_sharpness` — how decisive the underlying measure is (e.g. tonality confidence scales with
  the peak-prominence margin; a value near the [0,1] midpoint → lower confidence).
- `accel_cap` — **1.0** for `accel_dependency: none`, **0.6** for `disambiguates`, **0.4** for
  `required` (audio alone cannot fully determine it; the cap makes the accelerometer seam explicit).

### Event detection (REQ-5)

An **event** is a contiguous run of windows where chaos exceeds a per-pass threshold, merged across
short gaps, length-bounded:
- **Threshold:** chaos > **p90 of that pass's own chaos distribution** (data-driven; computed per
  band).
- **Merge gap:** runs separated by ≤ **0.5 s** merge into one event.
- **Max length:** an event is capped at **2.0 s**; a longer run splits at the cap (sustained texture
  = many events, not one).
- **Min length:** runs < **0.1 s** (one hop after merge) are dropped as sub-event ticks *unless*
  onset-sharpness is high (kept as a transient).

Each event carries one **tag set** aggregated over its member windows: each tag `value` = the
**confidence-weighted median** of window values; event `confidence` = the **confidence-weighted
mean** of window confidences (low-reliability windows dilute, never dominate).

**Tests (REQ-5, feeds REQ-1):** a verified idle segment (constant tone, speed 0) yields **zero
events**; a synthetic broadband burst yields **exactly one** event spanning it; two bursts 0.3 s
apart merge to one, 0.8 s apart stay two.

### Build order (dependency-ordered)

1. `harness/score/baseline.js` — add sub-bass (20–80 Hz) to `BANDS` (`["low","mid","high"]` today)
   so the `level`/delta-dB tag computes in sub-bass. *Blocks everything using sub-bass level.*
2. `harness/score/spectral-chaos.js` — the metric (FFT, adaptive windows, peak-prominence tonality,
   near-silence guard). *Blocks extraction.*
3. `harness/tags/` — registry records + `extract.js` (events → tags + confidence). *Depends on 1, 2.*
4. `scripts/squelch-extract.js` — writes `squelch-clean.json` + `tags-clean.json`. *Depends on 2, 3.*
5. `scripts/plot-timeline.js` — folded display + tag tooltips. *Depends on 4.*
6. `scripts/aggregate-squelch.js` — reproducibility rerun (REQ-2). *Depends on 4.*

Steps 5 and 6 are independent of each other.

### Folded display

- **New sub-bass panel** carrying, in one line: the smooth-road **baseline (dashed)**, the
  **level** line over it with **delta-dB shading**, and **chaos folded into the line** — hue
  cool(tonal)→hot(noise) on a **CVD-safe ramp (blue→yellow, never red→green)**, thickness ∝ chaos.
  **Thickness is a redundant, colour-independent channel** — the accessibility guarantee for
  colour-blind viewers. No second fill; replaces both the 47 Hz picket fence and the per-point
  chaos ribbon.
- **Placement:** sub-bass panel sits **above** the existing low panel (deepest = topmost of the
  band stack), so the felt-road channel leads.
- **low/mid/high panels** keep the delta-dB level+baseline story (no chaos line — it does not
  discriminate there); mid/high remain speech-flagged.
- **Events** render as marks on the main/sub-bass panels; hovering an event shows its **tags with
  tooltips** — `Manhole? · broadband 0.8 · transient 0.9 · sub-bass 0.7 · sharp-onset 0.85` — each
  tag a value+confidence, with an accelerometer-gap note where `accel_dependency ≠ none`.
- Dark-mode, no pure-white surfaces, avoid visual busy-ness (project accessibility rule).

## Data contracts

- `squelch-clean.json`: `{ params:{hopSec, bands:[{key,lo,hi,N}]}, subbass:[…], low:[…], mid:[…],
  high:[…] }`, each point `{t, level_db, tonality, chaos, peak_freqs}`.
- `tags-clean.json`: `{ events:[{ t_start, t_end, lat, lon, speed_mps, tags:{ name:{value,
  confidence} }, accel_gaps:[name…] }] }`. Coordinates rounded to ~6 dp (≈0.1 m); **no raw audio is
  written — features only** (consistent with the deferred privacy intent).
- Backward compatibility: absent `tags-clean.json` → the timeline still draws all panels, lines,
  and baselines; only event marks + tag tooltips are omitted (no error).

## Validation and testing

- **Code constraints:** each function targets ≤ 100 lines; > 300 lines is a blocking defect.
  Decompose the DSP into independently testable functions — FFT, per-band window/hop loop, tonality
  estimator, near-silence guard, peak-picker.
- **TDD** for `harness/score/spectral-chaos.js`, `harness/tags/extract.js`, `baseline.js`
  sub-bass addition (unit tests: synthetic tone → tonality → 1; synthetic white noise → tonality
  → 0; near-silence → confidence 0; known window sizes per band).
- **Discrimination tests** (recorded in each tag's registry record) on the 5 JC passes + Highway
  26: the primary is **stop-goes-quiet** in sub-bass; also idle-tonal-vs-gravel-broadband when
  the 82nd/39th Ave chop capture arrives.
- **Reproducibility rerun**: `aggregate-squelch.js` ICC on the new tonality/chaos vs delta-dB 0.63.
- `scripts/` analysis tooling stays test-light by intent; product/harness modules are TDD.

## Non-goals and deferred

Classifier, aggregator, dashboard map, privacy upload pipeline, accelerometer app, real-time /
on-device. Rough-road (82nd/39th Ave) and controlled-speed captures are prerequisites for *fully*
validating texture discrimination but not for landing this slice (stop-goes-quiet is testable now).

## Open questions

- HNR estimator: spectral peak-prominence vs cepstral peak prominence — pick by discrimination
  test during implementation.
- Sub-bass window 3 vs 5 periods (8192 vs 16384) — resolve empirically against the ring-decay tag.
- Phone-mic sub-bass response: confirm 20–80 Hz is real signal, not mic self-noise, on the
  captures before trusting sub-bass tonality.
