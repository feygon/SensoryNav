# Scorer unit frontmatter standard

**TL;DR:** A structured in-file comment block (`@unit-begin … @unit-end`) that documents each scorer unit
with `causality · state · mutates · contract · deps · realtime · tested-by`, so units are easy to
reference, safe to reuse across call sites (batch / realtime / app), and testable in isolation. A
generator scrapes the blocks into a derived registry and enforces them as build-time checks. **Status:**
extracted from [`docs/superpowers/specs/2026-07-09-scorer-units-and-frontmatter-design.md`](superpowers/specs/2026-07-09-scorer-units-and-frontmatter-design.md).
Intended to become **(a) a Superpowers skill** (apply the block when writing/refactoring a unit) and
**(b) a requirements rubric** (the §7 validation rules). Parked here for later — not yet enforced.

## Contents
- [1. Purpose](#1-purpose)
- [2. The block](#2-the-block)
- [3. Field reference](#3-field-reference)
- [4. Placement rule](#4-placement-rule)
- [5. Coordination / fusion rule](#5-coordination--fusion-rule)
- [6. Load-time effect](#6-load-time-effect)
- [7. Validation rules (rubric seed)](#7-validation-rules-rubric-seed)
- [8. Causality + mutation quick reference](#8-causality--mutation-quick-reference)
- [9. Turning this into a skill + rubric](#9-turning-this-into-a-skill--rubric)
- [10. Appendix — current viz architecture inventory (snapshot)](#10-appendix--current-viz-architecture-inventory-snapshot)

## 1. Purpose

Two properties make a unit reusable at any call site (offline batch, future realtime/streaming, the app)
with a single test as the guarantee:

- **deterministic** — same inputs → same output, no ambient state (asserted per-unit in isolation).
- **explicit interface** — every input is a parameter; every effect is declared. No unit reaches into
  another's internals or a shared global.

The frontmatter block records exactly what a caller/test author needs to know without reading the source:
what the unit does, how to call it, what it depends on, whether it mutates anything, and where it can be
reused.

## 2. The block

A delimited block in the unit's leading comment, AFTER a one-line prose description:

```js
// harness/score/roughness-db.js
// Delta-dB roughness: dB a window's band energy sits above its run's speed-conditioned floor.
// @unit-begin
// unit:        roughness-db
// causality:   pure                 // pure | causal | acausal | compose
// state:       none                 // none | carried:<shape>
// mutates:     none                 // none | input:<n> | setting:<n> | data:<n> | io:<sink>
// contract:    roughnessDb(energies{low,mid,high}, floors{low,mid,high}, weights{low,mid,high}) -> number>=0
// deps:        —                    // sibling units consumed, by import OR by data
// realtime:    reuse-as-is          // reuse-as-is | needs-streaming-variant | batch-only
// tested-by:   tests/score-roughness-db.test.js
// @unit-end
"use strict";
```

## 3. Field reference

| Field | Allowed values | Meaning |
|---|---|---|
| `unit` | kebab-case name | the unit's short name (usually the filename stem) |
| `causality` | `pure` \| `causal` \| `acausal` \| `compose` | see §8 |
| `state` | `none` \| `carried:<shape>` | carried state is threaded through the contract and returned fresh (batch folds it; realtime calls per-sample) |
| `mutates` | `none` \| `input:<n>` \| `setting:<n>` \| `data:<n>` \| `io:<sink>` | what the unit mutates; `setting:*` is a defect (see §7). `data:` = IN-PROCESS module/global state only; external persistence is `io:` (`io:db` for a datastore write, not `data:`). `io` sinks: `fs` \| `dom` \| `postMessage` \| `console` \| `network` \| `db`/`store` |
| `contract` | signature line(s) | public entry point(s): name, argument shapes, return shape + invariants. This is the test/reuse spec. Multi-line allowed (a `compose` unit lists its batch entry AND any carved core it exposes) |
| `deps` | unit names or `—` | units whose output this one consumes, by code import OR by receiving their output as data |
| `realtime` | `reuse-as-is` \| `needs-streaming-variant` \| `batch-only` | where the unit can run |
| `tested-by` | test path(s) | the test(s) asserting the contract |

**The portable ideal:** `causality: pure`, `state: none`, `mutates: none`. Anything else must carry an
explicit, reviewable reason. **io belongs in the imperative shell, not the unit:** if a unit would emit
(log, `postMessage`, write a file), prefer returning the value and letting the caller emit — keep the unit
at `mutates: none`.

## 4. Placement rule

The block sits AFTER a one-line prose description of the module. Reason: an existing generator
(`scripts/generate-viz-inventory.js`) scrapes the leading prose `//` line as the module description; the
new scorer-registry generator scrapes the fenced `@unit-begin … @unit-end` fields. Prose-then-block keeps
the two generators from colliding over the same comment.

## 5. Coordination / fusion rule

Units that combine the OUTPUTS of several other contracts (e.g. an event = coincidence of high chaos and
an energy condition; a tag value = tonality + energy ratio + level-delta + speech flag) MUST coordinate on
an explicit **joined row**, never on references between units:

```
contract: joinWindows(chaosSeries, scoredWindows, floors)
            -> rows[{ t, chaos, tonality, level_db, floor_db, speed, reliability, low_conf }]
```

One dedicated join unit aligns upstream outputs into a per-window row — the only place fields co-locate.
Every fusion unit's `contract` then takes that row shape as input, and its `deps` names the producers. A
fusion unit is therefore tested with a synthetic row — no need to run the upstream units — which is what
makes it deterministic and testable in isolation.

## 6. Load-time effect

Dual-export modules run `self.SensoryNavScore = Object.assign(…)` at import time. This uniform load-time
registration (not a per-call effect) is noted ONCE in the generated registry's preamble, not stamped
`io:global` on every unit.

## 7. Validation rules (rubric seed)

Rules 1–5 and 7 are **mechanical generator checks** (six total, wired into `npm test`). Rule 6 is a
**design-review guideline** — reference-vs-data coordination isn't statically detectable, so it's checked
at review, not by the generator. The generator (and the future rubric) fails / flags when:

1. a scorer module has no `@unit-begin` block (every unit must be documented);
2. a `tested-by` path does not exist;
3. a `contract` names a function the module does not export;
4. any `mutates: setting:*` appears (a unit rewriting shared config is the "silent divergence between
   call sites" defect);
5. a required field is missing, or a field value is outside its allowed set;
6. **(review guideline, not mechanical)** a `compose`/fusion unit's inputs are not an explicit joined row /
   parameter bundle (coordinates by reference instead of by data — §5);
7. a unit claims `causality: pure` / `state: none` but the `mutates` field is not `none` (contradiction).

## 8. Causality + mutation quick reference

**Causality** (layperson gloss):
- **pure** — a calculator; output depends only on the inputs in front of it.
- **causal** — a car's tripmeter; uses past + present, never the future; updates as data arrives.
- **acausal** — grading on a curve; needs the whole run before it can compute.
- **compose** — a chef following a recipe; wires pure/causal/acausal steps in order.

Realtime consequence: `pure`/`causal` cores drop into a live stream; `acausal` steps cannot (a streaming
path supplies a rolling approximation); `compose` recipes are rewritten per setting but reuse the same
cores.

**Mutation** buckets (the three categories + external sinks):
- `input:<n>` — mutates a passed-in argument in place (legit DSP pattern; MUST be declared so callers
  don't alias).
- `setting:<n>` — mutates config/constants; should NEVER appear (defect).
- `data:<n>` — mutates IN-PROCESS module/global state (a cache, a shared accumulator); breaks
  determinism-across-calls and blocks streaming reuse when the state is hidden. In-process only.
- `io:<sink>` — external effect (`fs` \| `dom` \| `postMessage` \| `console` \| `network` \| `db`/`store`).
  A datastore write is `io:db`, NOT `data:`; with the store as an explicit dependency it is deterministic
  (a transform of `(inputs, state) → new state`) — just not pure.

`state` + `mutates` together fully describe behavior: `state: carried:{s,P}` + `mutates: none` is the
clean functional-update pattern; `state: carried` + `mutates: input:state` is the hazardous in-place
variant, declared so nobody aliases it.

**Scope note:** this taxonomy targets a COMPUTE pipeline whose units aspire to purity, so an effect is a
hazard to minimize toward `mutates: none`. A command/repository layer whose PURPOSE is to persist
(a business-rule DB write) is legitimately effectful and wants its own vocabulary (commands/queries,
repositories, the datastore as an explicit dependency) — `not pure ≠ non-deterministic`.

## 9. Turning this into a skill + rubric

- **Skill** (e.g. `writing-a-scorer-unit`): when creating or refactoring a unit under `harness/**`, add
  the block from §2, fill it honestly (audit `mutates` by reading the body, not by assuming), aim for the
  portable ideal, and regenerate the registry in the same change. Include the §8 taxonomy as the decision
  aid.
- **Rubric** (`scorer-unit-frontmatter`): the §7 validation rules become scored checks; a unit passes when
  all block fields are present, valid, internally consistent (rule 7), the contract matches the exports,
  the test exists, and there is no `mutates: setting:*`. This mirrors how the Requirements Rubric gate is
  used before planning.
- **Generator**: `scripts/generate-scorer-registry.js` (planned) scrapes the blocks into
  `docs/scorer-registry.md` and enforces §7 in `npm test` — so the standard is machine-checked, not just
  documented.

## 10. Appendix — current viz architecture inventory (snapshot)

A point-in-time copy of [`docs/viz-architecture.md`](viz-architecture.md) as of **2026-07-09**, embedded
so this standard carries the module inventory the scorer registry will sit alongside. The live version is
**generated** by `scripts/generate-viz-inventory.js` — treat this copy as read-only reference; regenerate
the source for current state. (Descriptions are truncated with `…` exactly as the generator emits them.)

> **Reusable front-end / build inventory** — Before you build a page, renderer, generator, shared helper,
> or browser/worker module, check this list and reuse or extend what's here instead of writing a second
> copy. Generated from the code by convention — `scripts/lib/*`, page generators that use `viz-page`, and
> any module exporting a `window`/`self.SensoryNav*` global.

### Shared build helpers

| Module | What it is / when to use | Entry points |
|---|---|---|
| `scripts/lib/squelch.js` | Shared aperiodic-chaos "squelch" DSP so the timeline ribbon and the cross-pass aggregation measure the SAME thing… | `computeSquelch`, `computeSpectralChaos`, `bandpass`, `analyzeBand`, `BANDS`, `SBANDS` |
| `scripts/lib/timeline.css` | — | — |
| `scripts/lib/viz-page.js` | Emit a small, DATA-DRIVEN research page. The generated HTML is a SHELL: at load time it FETCHES the pipeline's JSON and builds SVG in the browser… | `buildPage`, `toUrl`, `esc`, `BASE_CSS` |

### Page / artifact generators

| Module | What it is / when to use | Entry points |
|---|---|---|
| `scripts/plot-roughmap.js` | Aggregated rough-spot map: the road drawn by its own GPS cells, colored by median roughness across passes; the generator bakes NO SVG, emits a shell… | — |
| `scripts/squelch-ribbon.js` | Spectral-chaos "ribbon" view of ONE pass from squelch-clean.json. The renderer lives in the shared ribbon-render.js (byte-identical with analyze.html); this generator only emits the shell… | — |

### Browser / worker modules

Modules that attach to a `window`/`self.SensoryNav*` global, so they run in a page, a Worker, AND Node
(dual export). `SensoryNavScore` carries the decode + scoring pipeline; `SensoryNavCore` the recorder
pieces.

| Module | What it is / when to use | Exports · global |
|---|---|---|
| `pipeline.js` | the shared pipeline/tier strip across the app (Capture → Local analysis → Deidentified upload → Aggregator → Route map)… | — · `SensoryNavPipeline` |
| `ribbon-render.js` | the ONE spectral-chaos ribbon renderer (used by squelch-ribbon.js and analyze.html)… | `drawRibbon` · `SensoryNavRibbon` |
| `timeline-render.js` | the ONE stacked-timeline renderer (used by plot-timeline.js and analyze.html)… | `buildData`, `chartClient`, `drawTimeline` · `SensoryNavTimeline` |
| `recorder/audio-scoring.js` | — | `bandEnergiesFromSpectrum`, `averageWindowEnergies`, `bandForFrequency`, `roughnessScore`, `roughnessScoreRaw` · `SensoryNavCore` |
| `recorder/calibration.js` | — | `computeBaseline`, `median` · `SensoryNavCore` |
| `recorder/capture-handoff.js` | one-shot IndexedDB stash handing a just-recorded capture (WAV + sidecar) from capture to analyze across a navigation… | — · `SensoryNavHandoff` |
| `recorder/capture-manifest.js` | — | `buildManifest`, `SCHEMA` · `SensoryNavCore` |
| `recorder/capture-state.js` | — | `nextState` · `SensoryNavCore` |
| `recorder/constants.js` | — | `CONSTANTS` · `SensoryNavCore` |
| `recorder/cvd-scale.js` | Cividis-style control points (perceptually uniform, colorblind-safe), dark blue → muted yellow. | `colorForScore`, `CONTROL_STOPS`, `NEUTRAL_COLOR` · `SensoryNavCore` |
| `recorder/fixtures.js` | — | `buildFixtureSession` · `SensoryNavCore` |
| `recorder/gps-track.js` | — | `normalizeFix`, `observedFixHz` · `SensoryNavCore` |
| `recorder/sample-pairing.js` | — | `pairWindowsWithGps`, `nearestGps` · `SensoryNavCore` |
| `recorder/session-export.js` | — | `buildSession`, `validateSession`, `SCORE_FORMULA_VERSION` · `SensoryNavCore` |
| `recorder/trim-capture.js` | — | `trimCapture` · `SensoryNavCore` |
| `recorder/wav-encoder.js` | — | `encodeWav`, `floatTo16BitPCM` · `SensoryNavCore` |
| `harness/audio/audio-windows.js` | — | `framesToWindows`, `windowIndexFor`, `stft` · `SensoryNavScore` |
| `harness/audio/fft.js` | — | `realFftDb` · `SensoryNavScore` |
| `harness/audio/load-pass.js` | — | `loadPass`, `windowsFromSamples` · `SensoryNavScore` |
| `harness/audio/wav-decoder.js` | — | `decodeWav` · `SensoryNavScore` |
| `harness/score/baseline.js` | — | `fitBaseline`, `floorAt`, `globalFloorAt`, `baselineMeta` · `SensoryNavScore` |
| `harness/score/metrics.js` | — | `quantile`, `weightedQuantile`, `spearman`, `weightedSpearman`, `rocAuc`, `precisionRecall`, `bestF1Threshold` · `SensoryNavScore` |
| `harness/score/reliability.js` | — | `windowReliability` · `SensoryNavScore` |
| `harness/score/research-scorer.js` | Pure, worker-callable RESEARCH scorer: flag talking windows, EXCLUDE them from the speed-conditioned baseline, score every window with the canonical band weights (low 0.6 / mid 0.3 / high 0.1)… | `scoreResearch` · `SensoryNavScore` |
| `harness/score/roughness-db.js` | Delta-dB roughness: dB a window's band energy sits ABOVE its run's speed-conditioned baseline floor; aggregate deltas, never baselines… | `toDb`, `bandDeltaDb`, `roughnessDb`, `EPS_ENERGY`, `BANDS` · `SensoryNavScore` |
| `harness/score/score-frontend.js` | Shared front-end for on-device / research scoring: decode WAV → SP1 windows → STFT frames → SP2 Kalman motion track, indexed by window_id… | `buildFrontEnd` · `SensoryNavScore` |
| `harness/score/spectral-chaos.js` | — | `fft`, `hann`, `powerSpectrum`, `SBANDS`, `tonality`, `PEAK_K`, `median`, `computeSpectralChaos`, `BAND_SNR_MIN` · `SensoryNavScore` |
| `harness/score/speech-detect.js` | Talking/speech detector, extracted verbatim so the on-device worker and the research scorer share ONE detector; feeds baseline exclusion + the speech ribbon… | `detectSpeech`, `HI`, `MID`, `SPEECH_FRAMES` · `SensoryNavScore` |
| `harness/score/squelch-derive.js` | Pure, worker-callable squelch derivation: spectral-chaos DSP (subbass/low/mid/high ribbons) joined against the SP1+SP2 scored-window series… | `deriveSquelch` · `SensoryNavScore` |
| `harness/score/validate.js` | — | `validatePass`, `validateBatch` · `SensoryNavScore` |
| `harness/motion/geo-project.js` | — | `projectFixes`, `bearingDeg`, `R_EARTH` · `SensoryNavScore` |
| `harness/motion/kalman-smoother.js` | — | `smooth`, `evaluateAt`, `forwardFilter`, `rtsBackward`, `INIT_VEL_VAR` · `SensoryNavScore` |
| `harness/motion/linalg.js` | — | `matMul`, `transpose`, `identity`, `matAdd`, `matSub`, `scale`, `solve` · `SensoryNavScore` |
| `harness/motion/motion-track.js` | — | `buildMotionTrack`, `classifyWindow`, `confidenceFromCov`, `sortDedupFixes` · `SensoryNavScore` |
| `harness/tags/events.js` | — | `detectEvents` · `SensoryNavScore` |
| `harness/tags/extract.js` | — | `confidence`, `extractTags`, `ACCEL_CAP` · `SensoryNavScore` |
| `harness/tags/schema.js` | — | `validateTag`, `loadRegistry`, `DOMAINS`, `ACCEL` · `SensoryNavScore` |

*Not in the inventory:* theme/dark-mode (`theme.js`, `styles.css`, governed by `docs/dark-mode.md`) and
page orchestrators (`capture.js`, `analyze.js`, `app.js`) which consume the modules above but aren't
themselves reusable.

---

Full design context (scope, per-module map, carve targets, testing, ordering):
[`docs/superpowers/specs/2026-07-09-scorer-units-and-frontmatter-design.md`](superpowers/specs/2026-07-09-scorer-units-and-frontmatter-design.md).
