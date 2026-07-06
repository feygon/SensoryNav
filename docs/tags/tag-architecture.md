# SensoryNav Tag & Metadata Architecture

Status: **definition / living reference** · First written 2026-07-05

The metric layer does not emit a single "chaos" number. It emits a set of **tags** —
scientifically-grounded, named acoustic/physical descriptors of a road-surface event, each with
a **value** and a **confidence**. Tags are the substrate the aggregator and the (later) classifier
reason over to produce statements like *"Manhole: 74% — broadband, transient, sub-bass, sharp
onset."* This document defines what a tag is, the metadata every tag carries, and the **specific
methodology** for adding one (so tag selection cannot become a bikeshed).

## Why tags, not a scalar

- **Interpretable substrate.** A classifier (human, heuristic, or LLM) reasons over named
  descriptors with grounding, not an opaque score.
- **Aggregation-ready.** The aggregator weights tag assertions across many trips; a per-trip
  guess becomes a resolved answer only if the unit of assertion is a tag with a confidence.
- **Extensible under governance.** Innovators will propose tags. Without a methodology that is
  the bikeshed. The methodology below makes inclusion an empirical, documented act.
- **Names the accelerometer gap.** Some tags are only partially determinable from audio; the
  metadata records exactly which axis an accelerometer would resolve.

## Tag object schema

Each tag is one record (proposed home: `harness/tags/registry/<name>.json` + a generated
`docs/tag-registry.md` index). Fields:

| field | type | meaning |
|---|---|---|
| `name` | kebab-case string | stable id, e.g. `sub-bass-ratio` |
| `display` | string | human label, e.g. "Sub-bass ratio" |
| `domain` | enum | `acoustics` \| `harmonics` \| `automotive-physics` \| `psychoacoustics` \| `mapping` |
| `definition` | string | what the tag asserts, in one sentence |
| `indicators` | string[] | the auditory / harmonic / physical signs that define it (the science) |
| `detection` | object | `{ method, band, window_samples, measure, provenance }` — how it is computed |
| `value` | object | `{ type: "scalar"\|"ratio"\|"bool"\|"enum", unit, range }` |
| `confidence` | object | `{ model, basis }` — how a confidence is assigned to the value |
| `accel_dependency` | enum | `none` \| `disambiguates` \| `required` — what a vertical-impact sensor would add |
| `status` | enum | `proposed` \| `validated` \| `deprecated` |
| `discrimination_test` | object | `{ dataset, claim, result }` — the empirical evidence it separates real cases |
| `notes` | string | caveats, contamination modes (e.g. speech), speed/vehicle coupling |

`detection.provenance` cites where the heuristic came from (e.g. "sub-bass discovery, 2026-07-04
stop-vs-drive test; lib/squelch.js computeSpectralChaos").

## Confidence semantics

A tag's `confidence` is **not** the value — it is how sure we are the value is meaningful for this
event, given signal quality and the measure's known failure modes. Basis examples: reliability of
the window (clipping / near-floor / speech contamination), the sharpness of the underlying
measure (e.g. a strong spectral peak → high tonality confidence), and `accel_dependency` (a tag
that `requires` accel is reported with capped audio-only confidence and a flag).

## Inclusion methodology (governance — anti-bikeshed)

A tag is added **only** when all five hold. Aesthetic preference is not grounds; a discrimination
result is.

1. **Domain grounding.** Names a specific principle in acoustics / harmonics / automotive physics
   / psychoacoustics / mapping. Cited in `indicators`.
2. **Detectable indicators.** The defining signs are computable from available signal
   (audio now; audio+accelerometer later). Vague perceptual language alone is insufficient.
3. **Detection method producing value + confidence.** A concrete `detection` spec (band, window,
   measure) yielding a typed value and a confidence, reproducible on the captures.
4. **Discrimination test on real data.** Demonstrated to separate at least two known cases on the
   Johnson Creek passes / Highway 26 / future labeled captures (e.g. "sub-bass tonality separates
   idle-stop from moving-road: 0.78 vs 0.67"). Recorded in `discrimination_test`.
5. **Review + registry entry.** A registry record with all fields, `status: proposed` until the
   discrimination test is reproduced, then `validated`.

Deprecation follows the same rigor: a tag moves to `deprecated` with a recorded reason, never
silently deleted.

## Starter tag set (v0 — to be validated during implementation)

Derived from heuristics already written into `lib/squelch.js` and this session's analysis. Values
and thresholds are placeholders pending the discrimination tests in the spec.

| tag | domain | indicators | detection (band / window) | accel |
|---|---|---|---|---|
| `sub-bass-ratio` | acoustics | energy concentrated 20–80 Hz vs above | band-power ratio / 8192 | none |
| `tonality` | harmonics | narrow stable spectral peaks vs broadband | harmonic-to-noise ratio / adaptive | none |
| `onset-sharpness` | acoustics | fast attack (impulsive) vs gradual swell | envelope attack time / short win | disambiguates |
| `ring-decay` | automotive-physics | post-impact decaying oscillation (suspension/cargo impulse response) | envelope decay / long win | disambiguates |
| `bandwidth` | acoustics | narrow vs broadband spectral spread | spectral spread over event | none |
| `level` | acoustics | loudness above the speed-conditioned floor | delta-dB / per-band | none |
| `duration` | acoustics | tick (<0.1 s) vs sustained | event length | none |
| `speed-locked` | automotive-physics | pitch tracks speed (texture) vs RPM (engine) | tone freq ÷ speed vs ÷ RPM | none (future) |
| `speech-contaminated` | mapping/privacy | mid+high co-spike = voices, not road | speech detector (existing) | none |

`speed-locked` and full `ring-decay` are flagged **future** — noted here so the schema is stable,
built when their discriminators exist.

## Relationship to the rest of the chain

Tags are produced by the **metric/tag-extraction layer** (this spec). They are consumed by the
**aggregator** (weights tag assertions across trips → resolves per-trip guesses) and then the
**classifier** (tags → event label + confidence). See
[`sensorynav-full-chain-intentions.md`](../sensorynav-full-chain-intentions.md).
