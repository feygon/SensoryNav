# Spec: Spectral-Chaos Metric + Tag-Extraction Layer

Status: **design / PRD** · 2026-07-05 · Slice 1 of the
[full chain](../../sensorynav-full-chain-intentions.md)

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

## Goals & success criteria

1. **Make-or-break: a stop goes quiet.** Idle (stopped) reads as high tonality / low chaos in
   sub-bass; moving-over-rough reads low tonality / high chaos. Target: clear separation, wider
   than the current 0.78/0.67.
2. **Cross-pass reproducibility preserved or improved** for the positional signal (re-run the
   aggregation with the new metric; report ICC vs the delta-dB 0.63 baseline).
3. **Tag output** — the layer emits the v0 starter tags (value + confidence) per event, validated
   by discrimination tests, ready for aggregation.
4. **Folded display** — one uncluttered line per band carries level+baseline+delta AND chaos;
   sub-bass gets its own folded panel; tags surface on events via tooltips. Sensory-safe dark mode.

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

**Tonality** = harmonic-to-noise via **spectral peak prominence**: energy in narrow peaks above a
percentile-smoothed spectral floor ÷ total band energy (tonal comb → high; broadband → low). This
replaces spectral flatness (retained only as a comparison baseline in the discrimination test).
**Chaos** = 1 − tonality, scaled for display. Per-window output: `{ t, level_db, tonality,
chaos, peak_freqs }`.

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
`{ value, confidence }`; confidence is capped/flagged by `accel_dependency` and by window
reliability (clipping / near-floor / speech). Every tag must pass its `discrimination_test` on the
captures before `status: validated`.

### Event detection

Tags describe *events*, so define an event: a contiguous run where chaos or delta-dB crosses a
data-driven threshold (p-tile of the pass), merged within a short gap, bounded to a max length.
Each event gets one tag set (aggregated over its windows: median value, min-confidence-weighted).
Steady stretches (idle, smooth cruise) produce few/no events — the make-or-break test is that a
stop yields no high-chaos events.

### Folded display (Q1 = A)

- **New sub-bass panel** carrying, in one line: the smooth-road **baseline (dashed)**, the
  **level** line over it with **delta-dB shading**, and **chaos folded into the line** — hue
  cool(tonal)→hot(noise), thickness ∝ chaos. No second fill; replaces both the 47 Hz picket fence
  and the per-point chaos ribbon.
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
  confidence} }, accel_gaps:[name…] }] }`.
- Backward compatibility: the timeline degrades gracefully if `tags-clean.json` is absent.

## Validation & testing

- **TDD** for `harness/score/spectral-chaos.js`, `harness/tags/extract.js`, `baseline.js`
  sub-bass addition (unit tests: synthetic tone → high tonality; synthetic noise → low tonality;
  known window sizes).
- **Discrimination tests** (recorded in each tag's registry record) on the 5 JC passes + Highway
  26: the primary is **stop-goes-quiet** in sub-bass; also idle-tonal-vs-gravel-broadband when
  the 82nd/39th Ave chop capture arrives.
- **Reproducibility rerun**: `aggregate-squelch.js` ICC on the new tonality/chaos vs delta-dB 0.63.
- `scripts/` analysis tooling stays test-light by intent; product/harness modules are TDD.

## Non-goals / deferred

Classifier, aggregator, dashboard map, privacy upload pipeline, accelerometer app, real-time /
on-device. Rough-road (82nd/39th Ave) and controlled-speed captures are prerequisites for *fully*
validating texture discrimination but not for landing this slice (stop-goes-quiet is testable now).

## Open questions

- HNR estimator: spectral peak-prominence vs cepstral peak prominence — pick by discrimination
  test during implementation.
- Sub-bass window 3 vs 5 periods (8192 vs 16384) — resolve empirically against the ring-decay tag.
- Phone-mic sub-bass response: confirm 20–80 Hz is real signal, not mic self-noise, on the
  captures before trusting sub-bass tonality.
