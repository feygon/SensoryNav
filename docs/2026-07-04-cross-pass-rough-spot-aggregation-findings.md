# Cross-Pass Rough-Spot Aggregation — Findings (2026-07-04)

Follows `docs/2026-06-30-real-capture-ingestion-findings.md`. Covers the research tooling
built on top of the merged SP3 scorer, and the first substantive result from it: **roughness
at a location on Johnson Creek Rd is reproducible across independent passes, so rough spots
can be aggregated into a confidence-ranked map.**

All of this is **offline research tooling** under `scripts/` + one shared harness module. It
does not change the product scorer's defaults; it is how we study whether computed roughness
tracks the road (and, later, felt experience).

## Captures used

Seven `sensorynav-capture-v1` sets in `data/` (all 48 kHz, zero clipping, zero near_floor):

| Pass | file | dur | max speed | GPS acc | notes |
|---|---|---|---|---|---|
| jc1 | johnson-creek-pass-1-134511 | 7.2 min | 19 m/s | 1.5 m | the clean "real" pass |
| jc2 | johnson-creek-pass-2-132902 | 7.7 min | 18 m/s | 1.5 m | clean |
| jc3 | johnson-creek-pass-3-164052 | 10.3 min | 18 m/s | 2.3 m | phone **on seat**; **talking** (~25%) |
| jc4 | johnson-creek-pass-4-181806 | 10.2 min | 17 m/s | 2.6 m | talking (~29%); drove slowest at turns |
| jc5 | johnson-creek-pass-5-115820 | 8.0 min | 18 m/s | 2.6 m | talking (~25%) |
| hwy26 | Long-163826 | 21 min | **31.6 m/s (71 mph)** | 2.0 m | **Highway 26**, different road, **0% talking** — clean high-speed reference |

(Also `johnson-creek-pass-1-131504`, a 7 m-accuracy shakedown, and the 3-fix throwaway
`163508` — both excluded from aggregation for GPS quality.)

All 5 JC passes traverse the **same ~4 km route in the same direction**, which is what makes
spatial alignment possible.

## Architecture: baseline is per-run; only delta-dB aggregates

The load-bearing rule (now enforced by a tested module, `harness/score/roughness-db.js`):

- The **baseline** — the road/tire/car/condition noise expected at a given speed — is fit
  **once per run** (per vehicle, per conditions) and is **never aggregated**. Speed is
  conditioned *inside* the baseline (per-speed floor).
- The only quantity comparable across runs is the **delta-dB**: how many dB a window's band
  energy sits above *that run's own* speed-conditioned floor, weighted per band. Because the
  floor already absorbs run-specific and speed-specific baseline, the delta is what carries
  road information across runs. `scripts/aggregate-rough.js` only ever reads `roughness_db`
  (the delta) — never raw energy or the floor.

The module's test encodes this: identical energy yields a smaller delta against a louder run's
own floor, and zero delta against its own floor.

**Band reweight (research):** low/mid/high = **0.6 / 0.3 / 0.1** (down from the product's
0.45/0.40/0.15). High (1–4 kHz) is de-emphasized because it carries cargo rattle (a kid's
bicycle in the car) and speech consonants, not road. This is a tool override, not the product
`CONSTANTS.WEIGHTS`.

## Result: rough spots are reproducible

`scripts/aggregate-rough.js` grid-bins clean windows (25 m cells), takes each pass's median
`roughness_db` per cell, and measures cross-pass agreement:

- **ICC = 0.63** — 63% of roughness variance is explained by *location*, not pass-to-pass
  noise. The road has a stable roughness fingerprint.
- **Split-half Spearman = 0.61** — passes {jc1,jc3,jc5} vs {jc2,jc4}, scored independently,
  agree on which cells are rough. Independent cross-validation.
- Holds **despite each pass using its own baseline** — the location signal survives.
- Coverage: of 260 cells, 95 driven by all 5 passes, 79 by 4, 38 by 3.
- **~41 confident rough spots** (≥3 passes present, ≥2 agree rough), several at 5/5 agreement,
  clustering along the −122.610…−122.614 stretch.

Map: `scripts/plot-roughmap.js` → `out/score/roughmap.html` (the road drawn by its own GPS
cells, blue=calm → yellow=rough, red ring = consistent rough spot). This gives **positional
ground truth for roughness with no in-drive annotation**.

## Low-speed / worst-chop: a real gap and its cause

The consistency map initially **missed the worst chop in the run** — the low-speed turnoff at
the west hairpin. Diagnosis (data, not the baseline being unestablished):

1. **Only jc4 crawled slow enough to sense it** (down to 0 m/s; the others rolled through at
   5–12 m/s and grazed it). jc4 scored 7–13 dB there — the worst in the dataset.
2. **Median-over-dwell dilution**: at a turn you sit in one cell for ~15–19 windows, so jc4's
   `max 13.1` collapsed to `median 2.5`.
3. **The "≥3 passes agree" rule structurally can't fire** where only one pass drove slowly
   enough to record it.

**Fix:** a **peak (p90) statistic per cell-pass** and a **worst-chop tier** — cells with peak
> p95 (~6.6 dB) but < 3-pass agreement get a dashed orange ring, colored by peak. ~7 surfaced
(the hairpin at 9.4 dB plus other dwell/low-speed points). The consistent-field view is kept
intact underneath.

**Deeper implication:** the audio proxy + spatial aggregation are weakest exactly where you go
slow — brief jolts get diluted by dwell and are sensed only if a pass happens to crawl. jc4's
12.5 dB proves the signal is recoverable from audio at crawl speed, but it is fragile. Evidence
for the deferred accelerometer (felt low-speed chop is vertical jolts, speed-independent to
capture).

## delta-dB vs speed, and the log-scale caveat

Median `roughness_db` is **flat across 0–20 m/s** (2.2–2.7 dB), Pearson r(speed, delta) =
−0.14. The per-run speed-conditioned floor normalizes speed out — the measurement is internally
consistent.

**Caveat (do not over-read the flat line):** delta-dB is `10·log10(bump/floor)`, a **ratio** on
a log scale. A flat ratio across speed is consistent with the **absolute** energy difference
*growing* with speed (loud floor × same ratio = bigger absolute gap). Felt severity tracks
absolute impact (~v²), so **flat delta-dB does not mean felt roughness is speed-invariant** —
the log/ratio nature likely hides speed-growth of felt severity. delta-dB is a good detector of
a surface anomaly's *presence*, a poor proxy for its *felt severity*, and the gap between them
is speed-dependent. This is the seam where the accelerometer / sensory-weighting work attaches.
The physics: a 10-mph speed bump is terrain at 5 mph and an axle-breaker at 100 — the bump's
existence is speed-invariant, its felt impact is not.

## Baseline bin overlap (refinement, opt-in)

`harness/score/baseline.js` gained an opt-in `OVERLAP_TIERS` param: wide (sparse) speed bins
borrow neighbour samples to stabilise their floor — span >10 m/s → 25%, >5 → 50%, else hard
bin. The research path uses `[[10,0.25],[5,0.50]]`; harness defaults stay off (byte-identical
output when off, verified by checksum).

Effect on the aggregate: **negligible** — ICC 0.632 → 0.629, split-half 0.608 → 0.606. Confirms
overlap costs no distinctiveness (distinctiveness lives in residuals, not the floor). One bias
to name: overlap on a lower-envelope percentile drags wide-bin (= low-speed) floors *down*,
nudging low-speed roughness *up* — compounds the log-scale over-representation of low speed.
Minor now (low speed is low-priority); relevant when the controlled low-speed study happens.

## Speed buckets (baseline resolution)

Bins are variable-width: windows bucketed at `SPEED_BIN_MPS=2.0`, greedily accumulated to
`MIN_BIN_SAMPLES=20`, wider where sparse; `floorAt` interpolates between bin rep speeds. Per
pass (low band): jc1=8, jc2=9, jc3=8, jc4=8, jc5=6, hwy26=**15**. The backroad passes are
**coarsest at low speed** (one bin from crawl to ~10 mph); the highway gives high-speed bins to
30.7 m/s but on a different surface.

## Research tooling built (all under `scripts/`)

- `serve-out.js` — zero-dep static server (repo root, HTTP Range) for local review only; the
  audio player is **localhost-only** because it streams the raw research WAV.
- `plot-timeline.js` — interactive dark-mode timeline: speed + roughness over time, click-zoom
  to 30 s, drag-pan, **audio player** (playhead follows), ~47 Hz high-res overlay, **dB
  roughness** default (log, non-saturating) with linear toggle, **temporal-envelope** smoothing
  slider, **two split band panels** (LOW road rumble apart from MID+HIGH voices+cargo),
  **talking-contamination ribbon**.
- `score-research.js <sidecar> <outDir>` — the generalized scorer (SP1+SP2 → talking-exclude →
  own-baseline fit → reweighted dB + linear roughness + highres). Supersedes the earlier
  pass-3-specific script.
- `aggregate-rough.js`, `plot-roughmap.js` — cross-pass aggregation + map.
- `highres-trace.js` — standalone high-res trace (largely superseded by score-research).

## Open questions / next

1. **Pooled-JC baseline** — pool all 5 passes' clean samples into one shared floor so per-pass
   dB is directly comparable (fixes jc5 reading ~1–2 dB low on its own baseline). ICC survived
   independent baselines, so this is refinement, not correction.
2. **Controlled-speed passes** — same physical chop at 5/15/25/35 mph (a parking lot with a
   rough patch or bump; a country road for the high end) to characterize delta-dB vs speed for
   a *fixed* bump and test the log-scale / felt-severity gap. Leaning: do this **before** the
   accelerometer (it needs no new hardware and gives the accelerometer a target).
3. **Accelerometer phase** — ground truth for felt vertical impact; the sensory-weighting of
   roughness by speed belongs here, layered on top of the delta-dB measurement, not inside it.
4. **`sensorynav-felt-v1` annotations** — the confident rough-spot list is now hand-validatable
   against memory of the road, and could seed felt annotations.

## Process note

This tooling was built in exploratory/iterative mode, not the full Superpowers spine
(brainstorm → rubric → writing-plans → SDD) that produced the SP3 harness. TDD was applied to
the pieces that touch product/harness code (`roughness-db.js`, `baseline.js` overlap,
`theme.js`); the `scripts/` analysis tooling is test-light by intent. The dark-mode website
changes and these research artifacts are committed separately from SP3.
