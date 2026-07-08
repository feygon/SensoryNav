# Analyze page — on-device timeline parity (design)

**TL;DR:** Make `analyze.html` reproduce **`out/score/timeline-jc4.html`** (the current
data-driven stacked timeline: speed + roughness + folded sub-bass + low/mid/high bands + tag
events, with all its toggles, hover, zoom, and localhost audio) — but computed **on-device**
from the dropped `.wav` + `.json`, in a Web Worker. **Same methods, not a reimplementation:** we
*extract* the timeline renderer into a shared `timeline-render.js` (exactly as `ribbon-render.js`
was pulled out of `squelch-ribbon.js`), and we *port* the existing offline scorer modules
(SP1/SP2/SP3 + tags) into the worker via the repo's dual `require`/`self.SensoryNav*` pattern.
**Privacy:** the audio is scored for immediate verification and then discarded — it is never
saved or uploaded; only the **annotated deidentified JSON** persists.

---

## Contents
- [1. Goal & scope](#1-goal--scope)
- [2. Functionality parity (must-match checklist)](#2-functionality-parity-must-match-checklist)
- [3. Architecture & data flow](#3-architecture--data-flow)
- [4. Methods & reuse (the "same methods")](#4-methods--reuse-the-same-methods)
- [5. Privacy contract](#5-privacy-contract)
- [6. Error handling](#6-error-handling)
- [7. Testing & verification](#7-testing--verification)
- [8. Out of scope / follow-ups](#8-out-of-scope--follow-ups)
- [9. Glossary](#9-glossary)
- [10. References](#10-references)

---

## 1. Goal & scope

**Goal.** Drop a capture (`.wav` + `.json`) on `analyze.html`; it decodes + scores the audio in a
background worker and renders the **exact `timeline-jc4.html` view**, driven by data computed
on-device instead of fetched from `out/score-XX/`.

**In scope**
- Extract the timeline renderer (`chartClient` + `buildData`) into a shared browser module.
- Port the offline scorer + tag extractor into the worker so it emits `{ scored, hires, squelch,
  tags }` for one pass.
- Wire `analyze.html` to feed those four on-device products into the shared renderer.
- Emit an **annotated deidentified JSON** as the durable artifact.

**Out of scope (this cycle):** the Stop→Analyze hand-off (separate follow-up, see §8), cross-pass
aggregation, the map tier, and the `164052b` "Band view: chaos" toggle (a stale one-off the current
`timeline-jc4.html` does not have).

## 2. Functionality parity (must-match checklist)

Every behavior of `timeline-jc4.html` the analyze page must reproduce, and *how*. If any row is
wrong, this spec is wrong — **please check this table.**

| # | Function in `timeline-jc4.html` | Reproduced by |
|---|---|---|
| F1 | **Main panel:** speed (m/s, left axis) + roughness (right axis) lines over time | shared renderer, unchanged; fed on-device `scored` |
| F2 | **Rough toggle** — dB-above-floor ↔ raw linear 0–100 | shared renderer; needs `scored.roughness_db` (SP3 dB) |
| F3 | **Folded sub-bass panel** — hue tonal→chaos, thickness = chaos, dashed baseline, shaded Δ | shared renderer; fed on-device `squelch` (incl. `subbass_floor`) |
| F4 | **Low panel** (road rumble) + shaded Δ over speed-conditioned baseline | shared renderer; fed on-device `hires.lo/floLo` |
| F5 | **Mid+high panel** (voices + cargo) + dashed baselines | shared renderer; fed on-device `hires.mi/hi/floMi/floHi` |
| F6 | **Bands toggle** (show/hide the three band panels) | shared renderer, unchanged |
| F7 | **Envelope + smooth slider** (centered moving-average roughness trend) | shared renderer, unchanged |
| F8 | **Auto annotations** — stop / rough / cruise shaded bands + staggered labels | shared renderer (`buildData` run-detection), unchanged |
| F9 | **Tag-event dots** along panel bottoms + hover tooltip listing each event's tags | shared renderer; fed on-device `tags.events` |
| F10 | **Speech ribbon** (pink strip where mid+high co-spike) | shared renderer; fed on-device `hires.speech` |
| F11 | **Hover-inspect** — dots + delta segment + tooltip below the hovered panel (peak-snap) | shared renderer, unchanged |
| F12 | **Zoom/pan** — full-view click→30 s, zoomed drag-pan, single-click seek, dbl-click reset | shared renderer, unchanged |
| F13 | **Reset-zoom button** + **range readout** | shared renderer, unchanged |
| F14 | **Audio player** (Play; playhead sweep; zoomed view auto-follows) — **localhost only** | shared renderer, unchanged; on analyze the WAV object-URL is the source, **localhost-gated exactly as today** |
| F15 | **Legend + Glossary** panels with `data-tip` tooltips | markup reused from the generator's shell into `analyze.html` |
| F16 | **`satpct`** ("% of windows pinned at roughness 100") | shared renderer, unchanged |
| F17 | **Dark-mode, no baked data** (data-driven shell) | analyze already dark-mode; renderer receives data objects, not fetches |

**Same-method guarantee:** F1–F16 are the *same functions* running — one renderer, called by both
the generator and the page. The only new code is the worker that produces `{scored, hires, squelch,
tags}` on-device, and it is the **existing harness modules** loaded via `importScripts`, not a copy.

**Band chaos treatment (matches `sample/timeline-jc4.html`, the recording-page sample).** Chaos is
**folded into the sub-bass panel only** (F3): hue tonal→chaos + thickness carry chaos *together with*
level. Low / mid+high panels (F4, F5) show **level only** — this mirrors the sample verbatim and the
spectral-chaos spec's finding that tonality/chaos discriminates idle-vs-road **only in sub-bass**
(engine firing fundamental < 80 Hz). Per-band chaos for low/mid/high is **not absent from the analyze
page** — it lives in the separate 4-band spectral-chaos **ribbon** already on the page. The old
`164052b` "Band view: chaos" toggle (an either/or that *hid* level to show chaos) is intentionally
**not** carried forward. See §8 for the validation-gated path to folding the low panel later.

## 3. Architecture & data flow

**Page layout (top → bottom).** The entry controls stay at the top; the timeline is the output below.

1. **Pipeline strip — the 5 large friendly tier buttons** (Capture · Local analysis · Deidentified
   upload · Aggregator · Route map), with **Local analysis** marked active. This is the **shared
   `pipeline.js` / `pipeline.css` component** already used on the capture page — reused verbatim
   (`<div id="pipeline-strip" data-active="analysis">`), not rebuilt. Same visual across the app.
2. **File drop — at the top of the page**, the primary input: the two drop/choose zones (`.wav`
   audio + `.json` sidecar) sit directly under the strip, above everything the analysis produces.
   Dropping a pair is what kicks off the on-device scoring.
3. **Local-read summary** (existing) — quick file/header/pair-check card.
4. **The timeline** (F1–F16) renders below, once the worker returns.

The file-drop remains the entry point even after the Stop→Analyze hand-off ships (§8): the hand-off
pre-loads a capture, but manual drop stays available at the top.

```
analyze.html  (drop .wav + .json)
    │  full ArrayBuffer transferred
    ▼
analyze-worker.js
    importScripts( wav-decoder, audio-windows/fft, motion-track/kalman/geo/linalg,
                   baseline, reliability, roughness, roughness-db, spectral-chaos/squelch,
                   tags/extract )
    ├─ decode WAV → samples
    ├─ SP1: audio windows (band energies)         → sp1windows
    ├─ SP2: Kalman motion track from gps_samples  → sp2track (speed_mps)
    ├─ SP3: fit baseline → score roughness + dB    → scored[]
    ├─ hires: per-frame bands + floors + speech    → hires
    ├─ squelch: folded sub-bass + subbass_floor    → squelch
    └─ tags: sub-bass event extraction             → tags
    │  postMessage({ scored, hires, squelch, tags, annotatedJson })
    ▼
analyze.js  →  SensoryNavTimeline.drawTimeline({scored,hires,squelch,tags},
                                               { label, audioUrl }, #chart)
    └─ offers the annotated deidentified JSON for download (audio discarded)
```

- **Single pass.** The offline scorer pools baseline samples across a vehicle's passes; on-device
  we fit the baseline from the one pass's own samples (the scorer already supports this).
- **Audio URL** for F14 is an in-memory `URL.createObjectURL(wavBlob)`, localhost-gated by the
  same `isLocal` check the renderer already applies — no raw audio ever leaves the device.

## 4. Methods & reuse (the "same methods")

| Piece | Action | Source of truth |
|---|---|---|
| 5-tier pipeline strip (top of page) | **Reuse verbatim** (`#pipeline-strip data-active="analysis"`) | `pipeline.js` / `pipeline.css` (already on capture page) |
| Timeline renderer (`chartClient`, `buildData`) | **Extract** → `timeline-render.js`, export `window.SensoryNavTimeline.drawTimeline` | today stringified in `scripts/plot-timeline.js` |
| `plot-timeline.js` | **Rewrite to a shell** that loads `timeline-render.js` (mirrors `squelch-ribbon.js`) | — |
| `timeline.css` | **Reuse** (link it on `analyze.html`) | `scripts/lib/timeline.css` |
| Ribbon renderer | unchanged (already shared) | `ribbon-render.js` |
| WAV decode | reuse (already in worker) | `harness/audio/wav-decoder.js` |
| SP1 audio windows / FFT | **Port** (add `self.SensoryNavScore` export) | `harness/audio/audio-windows.js`, `fft.js` |
| SP2 motion track | **Port** | `harness/motion/{motion-track,kalman-smoother,geo-project,linalg}.js` |
| SP3 scorer | **Port** | `harness/score/{baseline,reliability,roughness,roughness-db,score-pass}.js` |
| Sub-bass chaos / squelch | reuse/extend to emit `subbass_floor` | `harness/score/spectral-chaos.js` + `scripts/lib/squelch.js` |
| Tags | **Port** | `harness/tags/{extract,events,schema}.js` |
| Load-pass I/O | **Split** file-read from pure windowing so the worker feeds an ArrayBuffer | `harness/audio/load-pass.js` |

"Port" = add the dual `if (typeof module...) module.exports` / `self.SensoryNav* = Object.assign(...)`
tail (block-scoped `exported`), regenerate `docs/viz-architecture.md`. No forks: the Node tests keep
covering the same files.

## 5. Privacy contract

- The dropped `.wav` is decoded and scored **in memory, on-device**. It is **never** written to
  disk by us, never uploaded, never placed in the durable artifact.
- The durable artifact is an **annotated deidentified JSON**: the input sidecar plus the derived
  `scored` / `tags` / `squelch` summary. This is the "only derived features leave" tier.
- F14 audio playback is localhost-only, using an in-memory object-URL, matching the renderer's
  existing `isLocal` gate.

## 6. Error handling

- **Undecodable WAV, malformed sidecar, mismatched pair** → the existing `analyze.js`
  summary/`status` surfaces the error; the timeline stays hidden.
- **No GPS fixes** → speed track degrades to null-speed; roughness still renders (baseline uses
  what it has); a note is shown. (Matches the recorder's `no-GPS` warning semantics.)
- **Worker/`importScripts` failure** → `analysis-status` shows a legible message; page stays usable.
- **Long capture** (10-min/56 MB) → all scoring is in the worker so the page never freezes; a
  "scoring on your device…" status is shown until `postMessage`.

## 7. Testing & verification

1. **Renderer extraction is byte-identical:** regenerate `out/score/timeline-jc4.html` (and the
   other `timeline-*.html`) from the extracted `timeline-render.js`; diff against current output —
   must be identical. (Same proof used when `ribbon-render.js` was extracted.)
2. **Ported modules keep green Node tests:** the existing SP1/SP2/SP3/tags test scripts must still
   pass unchanged after the dual-export tails are added.
3. **On-device vs offline agreement:** score a known pass (e.g. `data/johnson-creek-pass-4`) in the
   worker and compare `scored`/`tags` to the offline `run-scorer.js` output within tolerance.
4. **Manual:** drop the pass on `analyze.html`; confirm every F1–F16 behavior against
   `timeline-jc4.html` side by side.

## 8. Out of scope / follow-ups

- **Stop→Analyze hand-off** — after Stop, offer to open `analyze.html` with the just-recorded
  capture (one-shot IndexedDB stash + CTA). Small, independent; its own spec/plan.
- **Annotated-JSON schema** finalization for the deidentified-upload tier (naming, versioning).
- **Low-band chaos folding (validation-gated).** The spectral-chaos spec scoped chaos to sub-bass
  because that is where idle-vs-road discriminates in the tests done so far (Johnson Creek, ~35 mph).
  It **explicitly defers** the highway / rough-road / cargo regime: at highway speed, road-texture
  energy climbs into the **low 80–250 Hz** band and cargo vibration multiplies impacts, so low-band
  chaos *may* begin to discriminate there. When the incoming highway + cargo captures confirm it, the
  right move is to **fold the low panel like sub-bass** (level + chaos in one line) — not to restore
  the either/or toggle. Until that data exists, low stays level-only to match the sample.
- Cross-pass aggregation, roughmap, and the map tier remain later pipeline stages.

## 9. Glossary

- **Roughness (dB)** — how far the road rumble sits above this car's smooth-pavement floor at the
  current speed; the default, log-scaled, non-saturating. **Linear** is the raw 0–100 score.
- **Baseline / floor** — the run's own speed-conditioned 10th-percentile noise floor (rises with
  speed). The shaded Δ above it *is* the roughness.
- **Folded sub-bass** — the 20–80 Hz panel drawn with tonal→chaos hue and chaos-width; **chaos** =
  spectral flatness (1 − tonality).
- **hires** — per-frame (~47 Hz) band energies + floors + speech mask feeding the band panels and
  the faint amber trace.
- **squelch** — the sub-bass chaos product (level, tonality, chaos, floor) per 0.25 s.
- **tags** — auto-detected sub-bass events (value + confidence), shown as dots.
- **SP1/SP2/SP3** — the offline harness stages: audio front-end / motion track / scorer.

## 10. References

**Reused / extended code**
- `scripts/plot-timeline.js` — renderer to extract (F1–F16 all live here today).
- `ribbon-render.js` (`SensoryNavRibbon.drawRibbon`) — the pattern to mirror for the extraction.
- `scripts/lib/timeline.css` — the timeline stylesheet.
- `harness/` SP1/SP2/SP3 + `harness/tags/` — the scorer to port.
- `docs/viz-architecture.md` — the reuse inventory (regenerate after porting).

**Prior specs / plans**
- `docs/superpowers/specs/2026-06-27-sensorynav-harness-sp1-audio-frontend-design.md`
- `docs/superpowers/specs/2026-06-27-sensorynav-harness-sp2-motion-track-design.md`
- `docs/superpowers/specs/2026-06-29-sensorynav-harness-sp3-scorer-design.md` (note: it explicitly
  **deferred** the on-device scorer as a *causal* re-derivation — this spec instead reuses the
  acausal offline code, run whole-file post-drive, for true parity)
- `docs/superpowers/specs/2026-07-05-spectral-chaos-tags-design.md`
- `docs/superpowers/specs/2026-06-24-sensorynav-capture-page-design.md`

**Project directives**
- `CLAUDE.md` (project) — reuse-before-build gate; dark-mode gate.
- Privacy tiers — `pipeline.js` (Capture → Local analysis → Deidentified upload → …).
