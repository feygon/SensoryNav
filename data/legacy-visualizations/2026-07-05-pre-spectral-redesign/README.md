# Legacy visualizations — 2026-07-05, pre-spectral-redesign

**TL;DR:** These are the research-prototype visualizations frozen at the moment *before* the
spectral-chaos redesign. They are kept because the redesign (see
[`docs/superpowers/specs/2026-07-05-spectral-chaos-tags-design.md`](../../../docs/superpowers/specs/2026-07-05-spectral-chaos-tags-design.md))
overwrites the generators, so this exact rendering will not exist again. The code that made them is
committed at **`90b33a2`**; the full 7-pass timeline set regenerates from that commit + the `data/`
captures.

## Contents
- [The research moment](#the-research-moment)
- [The artifacts](#the-artifacts)
- [What changes next](#what-changes-next)
- [Regeneration](#regeneration)

## The research moment

By 2026-07-05 the offline research scorer had reached a fork. The arc that produced these views:

1. **Delta-dB loudness + speed-conditioned baseline.** Roughness measured as per-band level above a
   per-run, speed-conditioned smooth-road floor. Cross-pass, this aggregates by location well
   (ICC 0.63) — the first positional "sensory fingerprint" of a road.
2. **The baseline made visible.** The timeline gained a dashed smooth-road baseline under the live
   band level, with the gap (delta-dB) shaded — teaching what the roughness number *is*.
3. **A second dimension: chaos.** An attempt to separate *felt harshness* from mere loudness. The
   first chaos metric measured amplitude-envelope spread × (1 − autocorrelation periodicity) — and
   **failed** its make-or-break test: an idling stop did not read quiet, because a loud-but-rhythmic
   engine is not chaotic.
4. **The pivot (documented, built next).** Vocabulary corrected — loudness ↔ decibels/amplitude,
   chaos ↔ frequency-stability. Chaos becomes **spectral tonality** (harmonic-to-noise), and the
   discriminating signal lives in a **sub-bass 20–80 Hz** band (idle-stop vs road: tonality
   0.78 vs 0.67). The redesign formalizes this.

These visualizations are the ones that "fire the imagination" — the pitch artifacts for the first
innovators (Rogers' 2.5%). See
[`docs/sensorynav-full-chain-intentions.md`](../../../docs/sensorynav-full-chain-intentions.md).

## The artifacts

| file | what it is |
|---|---|
| `timeline-jc4.html` | Interactive per-trip timeline (Johnson Creek pass 4). Speed + roughness over time; dashed smooth-road baseline + delta-dB shading; hover-inspect (peak-snap, per-band composition, dual raw/smoothed roughness dots); the **amplitude-chaos ribbon** band-view (the metric the redesign replaces) with its toggle. Audio player is localhost-only. Representative of all 7 pass timelines (same renderer). |
| `roughmap.html` | Cross-pass aggregation map — the road drawn in negative space by its own GPS cells, blue→yellow by roughness, red rings on the confident rough spots. The seed of the "emerging map layout" aggregation vision. |
| `ribbon-jc4.html` | Standalone aperiodic-chaos "squelch" ribbon prototype (the exploration that led to the tonality pivot). |

## What changes next

The redesign replaces the amplitude-chaos ribbon with **spectral tonality**, promotes **sub-bass
20–80 Hz** to a first-class **folded panel** (level + baseline + delta + chaos in one line), and
reshapes the metric output into a **governed tag set** (value + confidence per event). The band
panels, the chaos ribbon, and `lib/squelch.js` are all rewritten. That is why these copies exist.

## Regeneration

The other four pass timelines (`timeline-134511/132902/164052/jc5`), the b-variant, and the
Highway 26 timeline share `timeline-jc4.html`'s design and were omitted to avoid ~13 MB of
near-duplicate HTML. To reproduce any of them exactly, check out **`90b33a2`** and run the
`scripts/` generators against the `data/` captures (audio served locally via `scripts/serve-out.js`).
