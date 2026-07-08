# Analyze page — on-device timeline parity (design)

**TL;DR:** Make `analyze.html` reproduce **`out/score/timeline-jc4.html`** (= `sample/timeline-jc4.html`) —
the data-driven stacked timeline (speed + roughness + folded sub-bass + low/mid/high bands + tag
events, with all toggles, hover, zoom, localhost audio) — but computed **on-device** in a Web
Worker from the dropped `.wav` + `.json`. **Same methods, not a reimplementation:** *extract* the
timeline renderer into a shared `timeline-render.js` (as `ribbon-render.js` was extracted), and
*extract* the exact derivation logic that today produces the timeline's `*-clean.json` — which lives
in **`scripts/score-research.js`** and **`scripts/squelch-extract.js`**, NOT in `run-scorer.js` — into
worker-callable modules the same generators keep calling. **Privacy:** audio is scored in memory then
discarded; it is never saved or uploaded; only derived features persist.

---

## Contents
- [1. Goal & scope](#1-goal--scope)
- [2. Functionality parity (must-match checklist)](#2-functionality-parity-must-match-checklist)
- [3. Architecture, data flow & budgets](#3-architecture-data-flow--budgets)
- [4. Methods & reuse (the "same methods")](#4-methods--reuse-the-same-methods)
- [5. Data contracts](#5-data-contracts)
- [6. Privacy contract](#6-privacy-contract)
- [7. Error handling](#7-error-handling)
- [8. Testing & verification](#8-testing--verification)
- [9. Out of scope / follow-ups](#9-out-of-scope--follow-ups)
- [10. Glossary](#10-glossary)
- [11. References](#11-references)

---

## 1. Goal & scope

**Goal.** Drop a capture (`.wav` + `.json`) on `analyze.html`; a background worker decodes + scores
the audio and renders the **exact `timeline-jc4.html` view**, driven by data computed on-device
instead of fetched from `out/score-jc4/`.

**In scope**
- Extract the timeline renderer (`chartClient` + `buildData`) into a shared browser module.
- Extract the derivation logic from `scripts/score-research.js` and `scripts/squelch-extract.js`
  into worker-callable modules, and port their harness dependencies, so the worker emits the same
  `{ scored, hires, squelch, tags }` those scripts write today.
- Wire `analyze.html` to feed those four on-device products into the shared renderer.
- Keep the shared 5-tier pipeline strip + the file-drop entry at the top of the page.

**Out of scope (this cycle)**
- Emitting a downloadable **annotated deidentified JSON** and finalizing its schema — moves to the
  follow-up with the Stop→Analyze hand-off (§9). This cycle **renders** on-device; it persists
  nothing new. The audio-never-saved invariant (§6) still holds.
- Cross-pass aggregation, roughmap, the map tier, and the `164052b` "Band view: chaos" toggle.

## 2. Functionality parity (must-match checklist)

Every behavior of `timeline-jc4.html` the analyze page must reproduce, and *how*. **Please check
this table** — if a row is wrong, the spec is wrong.

| # | Function in `timeline-jc4.html` | Reproduced by (data source in **bold** = which on-device product) |
|---|---|---|
| F1 | **Main panel:** speed (left) + roughness (right) over time | shared renderer; **scored** (`speed_mps`, `roughness_raw`) |
| F2 | **Rough toggle** dB ↔ raw linear 0–100 | shared renderer; **scored.roughness_db** + **hires.rdb** |
| F3 | **Folded sub-bass** — hue tonal→chaos, thickness = chaos, dashed baseline, shaded Δ | shared renderer; **squelch** (`subbass` + `subbass_floor`) |
| F4 | **Low panel** (road rumble) + shaded Δ over speed-conditioned baseline | shared renderer; **hires.lo/floLo** |
| F5 | **Mid+high panel** (voices + cargo) + dashed baselines | shared renderer; **hires.mi/hi/floMi/floHi** |
| F6 | **Bands toggle** | shared renderer, unchanged |
| F7 | **Envelope + smooth slider** | shared renderer, unchanged |
| F8 | **Auto annotations** — stop / rough / cruise bands + labels | shared renderer (`buildData` run-detection), unchanged |
| F9 | **Tag-event dots** + hover tag tooltip | shared renderer; **tags.events** |
| F10 | **Speech ribbon** (pink; mid+high co-spike) | shared renderer; **hires.speech** (from the extracted talking detector, H1) |
| F11 | **Hover-inspect** — dots + delta segment + tooltip, peak-snap | shared renderer, unchanged |
| F12 | **Zoom/pan** — click→30 s, drag-pan, click-seek, dbl-click reset | shared renderer, unchanged |
| F13 | **Reset-zoom button** + **range readout** | shared renderer, unchanged |
| F14 | **Audio player** (Play; playhead sweep; zoomed follow) — **localhost only** | shared renderer; in-memory WAV object-URL, same `isLocal` gate |
| F15 | **Legend + Glossary** panels with `data-tip` tooltips | markup reused from the generator shell into `analyze.html` |
| F16 | **`satpct`** ("% pinned at roughness 100") | shared renderer, unchanged |
| F17 | **Dark-mode, no baked data** (data-driven) | analyze already dark-mode; renderer receives data objects |

**Same-method guarantee.** F1–F16 are the *same functions* running — one renderer, called by both
the generator and the page. The scored/hires/squelch/tags values are produced by the **same
derivation code** that writes today's `*-clean.json`, extracted from `score-research.js` /
`squelch-extract.js` into modules the worker and the scripts both call. No numbers are recomputed by
a second, divergent path. The timeline's producer is `score-research.js` (not `run-scorer.js`)
because of its **talking-exclusion baseline, `OVERLAP_TIERS`, and `roughness_db`** — reusing
`run-scorer.js` would silently break F1/F2/F4/F5 on those axes. (Band **weights** are no longer a
divergence risk: the former product weighting was removed; `CONSTANTS.WEIGHTS = low 0.6 / mid 0.3 /
high 0.1` is now the single canonical set used by the app, SP3, and the timeline alike.)

**Band chaos treatment (matches `sample/timeline-jc4.html`).** Chaos is **folded into the sub-bass
panel only** (F3): hue + thickness carry chaos *with* level. Low / mid+high (F4, F5) show **level
only** — mirroring the sample and the spectral-chaos spec finding that tonality/chaos discriminates
idle-vs-road **only in sub-bass** (engine firing fundamental < 80 Hz). Per-band chaos for low/mid/high
is not absent from the page — it lives in the separate 4-band **ribbon** already present. The
`164052b` "Band view: chaos" toggle is intentionally **not** carried forward. Low-panel folding is a
validation-gated future path (§9).

## 3. Architecture, data flow & budgets

**Page layout (top → bottom).** Entry controls at top; timeline output below.
1. **Pipeline strip — the 5 large friendly tier buttons** (Capture · Local analysis · Deidentified
   upload · Aggregator · Route map), **Local analysis** active. The **shared `pipeline.js` /
   `pipeline.css`** component, reused verbatim (`<div id="pipeline-strip" data-active="analysis">`).
   *Already present on `analyze.html` — retain, don't rebuild.*
2. **File drop — at the top**, the primary input: the `.wav` + `.json` drop/choose zones directly
   under the strip. Dropping a pair kicks off on-device scoring.
3. **Local-read summary** (existing file/header/pair-check card).
4. **The timeline** (F1–F16) renders below, once the worker returns.

**Data flow.**
```
analyze.html  (drop .wav + .json; strip + drop zones at top)
    │  full WAV ArrayBuffer transferred to the worker
    ▼
analyze-worker.js   importScripts(harness deps + the extracted derivation modules)
    │  SHARED FRONT-END — computed ONCE per drop, passed into both modules:
    ├─ decode WAV (wav-decoder)                         → samples
    ├─ SP1 framesToWindows + stft (audio-windows)       → sp1 windows, stft frames
    └─ SP2 buildMotionTrack (Kalman)                    → sp2 track (speed)
    │
    ├─ research-scorer module  (extracted from scripts/score-research.js)
    │     talking detector · baseline A (talking-excluded low/mid/high, OVERLAP_TIERS) ·
    │     RW reweight · roughness_raw/db + per-band floors + speech      → scored, hires
    └─ squelch/tags module     (extracted from scripts/squelch-extract.js)
          computeSpectralChaos (subbass N=16384 …) · baseline B (subbass-inclusive) ·
          nearest-time joins · sub-bass floor · detectEvents · extractTags → squelch, tags
    │  postMessage({ scored, hires, squelch, tags })
    ▼
analyze.js → SensoryNavTimeline.drawTimeline({scored,hires,squelch,tags},
                                             { label, audioUrl }, #chart)
```

- **Shared front-end (avoid double compute).** Today each script re-decodes and independently
  rebuilds SP1 windows + the SP2 Kalman track. On-device, **decode + SP1 (`framesToWindows`/`stft`)
  + SP2 (`buildMotionTrack`) run once** and are passed into both derivation modules; only the two
  **baselines differ** and stay per-module — **A** (research scorer): talking-excluded low/mid/high
  with `OVERLAP_TIERS`; **B** (squelch): sub-bass-inclusive via its own window build. The heavy
  sub-bass FFT (`computeSpectralChaos`, N=16384) is inherently separate from the SP1 `stft` (different
  window sizes) and runs once inside the squelch module. To keep the extracted scripts byte-identical
  in Node, the shared front-end is a small helper the thin script wrappers also call (so a script run
  still decodes+SP1+SP2 itself); only the worker reuses one front-end across both modules.

- **Single pass.** The scripts already score one capture at a time (they take one sidecar); the
  baseline is fit from that pass's own talking-excluded samples with `OVERLAP_TIERS`. *Open risk:*
  `OVERLAP_TIERS` was tuned on the JC passes — single-pass floor stability on an arbitrary drop is
  asserted, not yet validated (§9, N2).
- **Audio URL** (F14) is an in-memory `URL.createObjectURL(wavBlob)`, localhost-gated by the
  renderer's existing `isLocal` check — no raw audio leaves the device.

**Budgets (target: Samsung Galaxy A16, Chrome, HTTPS).** A 10-min mono 48 kHz capture decodes to
~29 M Float32 samples (~115 MB) plus STFT frames. Transfer the WAV `ArrayBuffer` into the worker
(no main-thread copy); **free the raw WAV bytes after decode**; keep peak worker memory **≤ ~500 MB**;
target end-to-end scoring **≤ ~15 s** for a 10-min capture, with a "scoring on your device…" status
until `postMessage`. The page must never freeze (all scoring in the worker).

## 4. Methods & reuse (the "same methods")

| Piece | Action | Source of truth |
|---|---|---|
| 5-tier pipeline strip (top of page) | **Reuse verbatim** (already on the page) | `pipeline.js` / `pipeline.css` |
| Timeline renderer (`chartClient`, `buildData`) | **Extract** → `timeline-render.js`, export `window.SensoryNavTimeline.drawTimeline` | stringified in `scripts/plot-timeline.js` |
| `plot-timeline.js` | **Rewrite to a shell** that loads `timeline-render.js` (mirrors `squelch-ribbon.js`) | — |
| `timeline.css` | **Reuse** (link on `analyze.html`) | `scripts/lib/timeline.css` |
| **Research scorer** (RW reweight, talking-exclusion baseline, `OVERLAP_TIERS`, `roughLinear`, `roughDbCalc`, scored-window builder, hires frame loop → `scored` + `hires`) | **Extract the pure derivation** out of the `fs`/`argv` driver into a worker-callable module; the script becomes a thin I/O wrapper calling it (Node output byte-identical) | inline in `scripts/score-research.js` |
| **Talking / speech detector** (`speechCount` + `isTalking`, feeds F10 speech ribbon AND the baseline exclusion) | **Extract into a shared module** (not currently reusable) | inline in `scripts/score-research.js` |
| **Squelch + tags** (`nearestIndex` joins, sub-bass floor, `buildScoredWindows`, per-tag value/confidence, near-silence guard → `squelch` + `tags`) | **Extract the pure derivation** into a worker-callable module; script becomes a thin wrapper | inline in `scripts/squelch-extract.js` |
| WAV decode | reuse (already in worker) | `harness/audio/wav-decoder.js` |
| `stft` / `framesToWindows` (SP1) | **Port** (dual export) | `harness/audio/audio-windows.js`, `fft.js` |
| Motion track (SP2 Kalman) | **Port** | `harness/motion/{motion-track,kalman-smoother,geo-project,linalg}.js` |
| Baseline / reliability / roughness-db / validate | **Port** | `harness/score/{baseline,reliability,roughness-db,validate}.js` |
| Spectral chaos DSP | reuse/extend to emit `subbass_floor` | `harness/score/spectral-chaos.js` |
| Tags DSP | **Port** | `harness/tags/{events,extract,schema}.js` |
| `load-pass` I/O | **Split** file-read from pure windowing so the worker feeds an ArrayBuffer | `harness/audio/load-pass.js` |

- **"Extract the pure derivation"** = move the math into a module with **no `fs`/`process.argv`**;
  the existing script `require`s it and keeps doing its own I/O, so its `*-clean.json` output stays
  byte-identical. The worker `importScripts` the same module. This is the reuse-before-build
  discipline applied to the scorers — no forked second copy.
- **"Port"** = add the dual `module.exports` / `self.SensoryNav* = Object.assign(...)` tail
  (block-scoped `exported`); Node tests keep covering the same files. Regenerate
  `docs/viz-architecture.md` after.
- **Function-size policy.** The extracted `chartClient` (~600 lines) is preserved **byte-identical**
  for parity — this **overrides** the ≤100/≤300-line guidance for the *move*. Decomposing
  `chartClient` into smaller functions is a separate behavior-preserving follow-up (§9), not done
  during extraction (changing it would risk the byte-identical proof). The **newly extracted scorer
  modules** DO follow the size guidance (decompose into named, independently testable functions).

## 5. Data contracts

The four on-device products must match these shapes (the timeline renderer reads them unchanged):

- **`scored`** — `[{ window_id, started_at_ms, lat, lon, speed_mps, heading_deg, roughness_raw,
  roughness, detected, magnitude, roughness_null, roughness_db, reliability, reliability_flags,
  speed_source, sp2_flags, felt_present, felt_magnitude }]` (per `score-research.js`).
- **`hires`** — `{ t0, dt, r, rdb, lo, mi, hi, floLo, floMi, floHi, speech }` (the **full**
  `highres-clean.json` — with `rdb` + floor arrays; **not** the floorless `highres-trace.js`).
- **`squelch`** — `{ params:{hopSec, bands:[{key,lo,hi,N}]}, subbass:[…], low:[…], mid:[…], high:[…],
  subbass_floor:[…] }`, each point `{ t, energy, level_db, tonality, chaos, peak_freqs, low_conf }`
  (per `spectral-chaos.js`; `energy` feeds the level / sub-bass-ratio tag math + baseline samples,
  `low_conf` the near-silence guard).
- **`tags`** — `{ events:[{ t_start, t_end, lat, lon, speed_mps, tags:{ name:{value,confidence} },
  accel_gaps:[…] }] }`; absent/empty ⇒ timeline still draws, only marks omitted (no error).

## 6. Privacy contract

- The dropped `.wav` is decoded and scored **in memory, on-device**. It is **never** written to disk
  by us, never uploaded, never placed in any persisted artifact.
- This cycle persists nothing new (it renders). The downloadable **annotated deidentified JSON**
  (derived features only — the "only derived features leave" tier) is the follow-up (§9); its schema
  and on-device deidentification rules are designed there.
- F14 audio playback is localhost-only via an in-memory object-URL, matching the renderer's `isLocal`
  gate.

## 7. Error handling

- **Undecodable WAV, malformed sidecar, mismatched pair** → the existing `analyze.js` summary/status
  surfaces the error; the timeline stays hidden.
- **No GPS fixes** → speed track degrades; roughness still renders from what the baseline has; a note
  is shown (matches the recorder's no-GPS warning).
- **Worker / `importScripts` failure** → `analysis-status` shows a legible message; page stays usable.
- **Long capture** → all scoring in the worker; status shown until `postMessage`; never freezes.

## 8. Testing & verification

1. **Renderer extraction is byte-identical.** Regenerate `out/score/timeline-jc4.html` (and the other
   `timeline-*.html`) from the extracted `timeline-render.js`; diff against current output — must be
   identical. (Same proof used when `ribbon-render.js` was extracted.)
2. **Scorer extraction is numerically identical.** After moving the derivation into modules, re-run
   `scripts/score-research.js` + `scripts/squelch-extract.js` on `data/johnson-creek-pass-4` and diff
   the emitted `scored-clean.json` / `highres-clean.json` / `squelch-clean.json` / `tags-clean.json`
   against the committed `out/score-jc4/*-clean.json` — must be identical (same code path).
3. **On-device vs offline agreement.** Score the same pass in the worker; compare its four products
   to `out/score-jc4/*-clean.json`. Because it is the *same extracted code*, require **exact match on
   the emitted (rounded) fields** and `|Δ| ≤ 1e-6` on any unrounded intermediate — not a loose
   tolerance. Reference artifacts: `out/score-jc4/{scored,highres,squelch,tags}-clean.json`.
4. **Ported modules keep green Node tests** — the SP1/SP2/roughness-db/tags test scripts pass
   unchanged after the dual-export tails are added.
   - The numeric-identity bar (steps 2–3) rests on **`decodeWav` being byte-path-independent** —
     it must yield identical samples whether fed a Node `Buffer` (`fs.readFileSync`) or the
     transferred `ArrayBuffer`/`Uint8Array` in the worker. Assert this with a small fixture test.
5. **Manual.** Drop `johnson-creek-pass-4` on `analyze.html`; confirm every F1–F16 behavior against
   `timeline-jc4.html` side by side (bands, dB toggle, envelope, hover values, zoom, tag dots,
   speech ribbon, localhost audio).

## 9. Out of scope / follow-ups

- **Stop→Analyze hand-off + annotated-JSON emission.** After Stop, offer to open `analyze.html` with
  the just-recorded capture (one-shot IndexedDB stash + CTA); emit the downloadable annotated
  deidentified JSON and finalize its schema/versioning there. Small, independent; its own spec/plan.
- **`chartClient` decomposition** — break the ~600-line renderer into smaller named functions
  (behavior-preserving), after the byte-identical extraction has landed.
- **Low-band chaos folding (validation-gated).** Chaos is scoped to sub-bass because that is where
  idle-vs-road discriminates in the tests done so far (Johnson Creek, ~35 mph). The spectral-chaos
  spec **explicitly defers** the highway / rough-road / cargo regime: at highway speed road-texture
  energy climbs into the **low 80–250 Hz** band and cargo vibration multiplies impacts, so low-band
  chaos *may* begin to discriminate. When the incoming highway + cargo captures confirm it, **fold the
  low panel like sub-bass** (level + chaos in one line) — not the either/or toggle. Until then, low
  stays level-only to match the sample.
- **Sticky timeline controls (UI follow-up).** When the page is scrolled past the scored timeline,
  freeze the timeline's Play / Reset-zoom / Rough dB / Bands controls to the top of the viewport (a
  sticky toolbar) so they stay usable while looking at the panels/ribbon below.
- Cross-pass aggregation, roughmap, and the map tier remain later pipeline stages.

## 10. Glossary

- **Roughness (dB)** — how far the road rumble sits above this car's smooth-pavement floor at the
  current speed; default, log-scaled, non-saturating. **Linear** = the raw 0–100 score.
- **Band weights** — `CONSTANTS.WEIGHTS = low 0.6 / mid 0.3 / high 0.1`, the single canonical set
  (the old product weighting `0.45/0.4/0.15` was removed); high is de-emphasized as cargo rattle +
  speech consonants, not road. Sub-bass is not weighted here — it is a first-class separate channel.
- **Talking exclusion** — windows where mid+high co-spike (speech) are dropped from the baseline fit
  and marked; also drives the pink speech ribbon (F10).
- **Baseline / floor** — the run's own speed-conditioned 10th-percentile noise floor (rises with
  speed), fit with tiered bin overlap. The shaded Δ above it *is* the roughness.
- **Folded sub-bass** — the 20–80 Hz panel drawn with tonal→chaos hue + chaos-width; **chaos** =
  spectral flatness (1 − tonality).
- **hires** — per-frame (~47 Hz) roughness + band energies + floors + speech mask feeding the band
  panels and the faint amber trace.
- **squelch** — the sub-bass chaos product (level, tonality, chaos, floor) per 0.25 s.
- **SP1/SP2** — offline harness stages: audio front-end / motion track.

## 11. References

**Reused / extended code**
- `scripts/plot-timeline.js` — the renderer to extract (F1–F16 live here today).
- `scripts/score-research.js` — **true producer** of `scored-clean.json` + `highres-clean.json`
  (canonical `CONSTANTS.WEIGHTS`, talking exclusion, `OVERLAP_TIERS`, `roughness_db`, floors, speech).
- `scripts/squelch-extract.js` — **true producer** of `squelch-clean.json` + `tags-clean.json`.
- `ribbon-render.js` (`SensoryNavRibbon.drawRibbon`) — the extraction pattern to mirror.
- `scripts/lib/timeline.css`; `pipeline.js` / `pipeline.css` — reused assets.
- `harness/` SP1/SP2/score/tags — the DSP dependencies to port.
- `docs/viz-architecture.md` — reuse inventory (regenerate after porting).

**Prior specs**
- `2026-06-27-sensorynav-harness-sp1-audio-frontend-design.md`
- `2026-06-27-sensorynav-harness-sp2-motion-track-design.md`
- `2026-06-29-sensorynav-harness-sp3-scorer-design.md` (explicitly **deferred** the on-device scorer
  as a *causal* re-derivation — this spec instead reuses the acausal research-scorer code, run
  whole-file post-drive, for true parity)
- `2026-07-05-spectral-chaos-tags-design.md`
- `2026-06-24-sensorynav-capture-page-design.md`

**Project directives** — `CLAUDE.md` (reuse-before-build gate; dark-mode gate); privacy tiers in
`pipeline.js`.
