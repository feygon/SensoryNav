# Design — Scorer units + frontmatter registry (2026-07-09)

**TL;DR:** Refactor the offline research scorer (`harness/audio` + `harness/motion` + `harness/score` +
`harness/tags`) into cleanly separated, independently testable **units**, carving the reusable
**causal/pure cores** out of the few `compose`/fusion functions so a future realtime/streaming scorer
can import them unchanged. Document every unit with an in-file **frontmatter block** — `causality`,
`state`, `mutates`, `contract`, `deps`, `realtime`, `tested-by` — scraped by a new
`scripts/generate-scorer-registry.js` into a derived `docs/scorer-registry.md`. Two-layer safety net:
per-core **deterministic** unit tests + the existing whole-pass **byte-identical** golden gate. No
streaming engine is built here (YAGNI); no algorithm is rewritten; batch output stays bit-for-bit
identical. `timeline-render.js` `chartClient` is a **separate later cycle**, not this spec.

## Contents
- [1. Goal & scope](#1-goal--scope)
- [2. Terms](#2-terms)
- [3. Causality taxonomy + the mutation dimension](#3-causality-taxonomy--the-mutation-dimension)
- [4. Frontmatter schema & format](#4-frontmatter-schema--format)
- [5. Registry generator](#5-registry-generator)
- [6. Per-module map](#6-per-module-map)
- [7. Coordination / fusion units](#7-coordination--fusion-units)
- [8. Testing & safety net](#8-testing--safety-net)
- [9. Ordering (phases)](#9-ordering-phases)
- [10. Constraints & non-goals](#10-constraints--non-goals)
- [11. Success criteria / acceptance](#11-success-criteria--acceptance)
- [12. Risks & open questions](#12-risks--open-questions)

## 1. Goal & scope

**Why.** The offline research scorer is the source of truth for road-audio scoring. A future
realtime/streaming mechanism will reuse its logic; today that logic is partly fused inside large
`compose` functions and is not independently testable. This refactor makes each unit
single-responsibility, declares its interface and effects, and carves out the pure/causal cores the
realtime path will import — so we test each core once and reuse it at every call site (batch, realtime,
app) without duplication or divergence.

**In scope (this cycle):**
- The frontmatter standard + `scripts/generate-scorer-registry.js` + `docs/scorer-registry.md`.
- Frontmatter classification of every module in `harness/audio`, `harness/motion`, `harness/score`,
  `harness/tags`.
- Carving the 5 `compose`/fusion targets (§6) into reusable cores.

**Out of scope:**
- Building the realtime/streaming engine (online baseline, incremental quantiles, ring buffers). This
  spec only makes units *ready* for it.
- Rewriting any scoring algorithm or changing any numeric output.
- `timeline-render.js` `chartClient` re-encapsulation (a separate spec/plan, sequenced after this).
- `recorder/*` modules — `recorder/constants.js` (weights) and `recorder/audio-scoring.js` are consumed
  dependencies, referenced in the registry preamble but not restructured or blocked.

## 2. Terms

- **deterministic** — a unit property: the same inputs produce the same output, with no ambient state.
  This is what makes a unit's test portable to any call site; it is asserted per-unit in isolation.
- **byte-identical** — the composition gate: regenerated `out/score-jc4/*-clean.json` diffs exactly
  against the committed golden. Proves a refactor changed no numeric output.
- **Causality classes** (layperson gloss):
  - **pure** — a calculator; output depends only on the inputs in front of it (`roughnessDb(energy,
    floor)` → dB).
  - **causal** — a car's tripmeter; may use past + present, never the future; updates as data arrives
    (the forward Kalman filter as fixes stream in).
  - **acausal** — grading on a curve; needs the whole run before it can be computed (the speed baseline;
    the 90th-percentile chaos threshold).
  - **compose** — a chef following a recipe; not a new computation, it wires pure/causal/acausal steps
    in order (`scoreResearch` = fit baseline → loop windows → aggregate).

## 3. Causality taxonomy + the mutation dimension

Two orthogonal dimensions describe a unit's reusability:

**Causality** (`causality:` field) — `pure` | `causal` | `acausal` | `compose` (§2). Determines whether a
unit can run at a streaming call site: `pure`/`causal` reuse as-is; `acausal` cannot (a streaming path
supplies a rolling approximation); `compose` recipes are rewritten per setting but reuse the same cores.

**State** (`state:` field) — `none` | `carried:<shape>`. Carried state is threaded *explicitly through
the contract* and returned fresh (e.g. `kalmanStep(state,fix) -> {state,out}`), so batch does a `reduce`
and realtime calls per-sample — same function.

**Mutation / effects** (`mutates:` field), bucketed as the user's three categories + external sinks:
- `none` — gold standard: returns fresh output, touches nothing. Fully portable.
- `input:<name>` — mutates a passed-in argument IN PLACE (e.g. FFT-in-buffer, in-place sort). Legit
  performance pattern, but MUST be declared so callers do not alias.
- `setting:<name>` — mutates config/constants. Should NEVER appear; the generator flags it as a defect
  (a unit rewriting shared config is the "silent divergence between call sites" failure mode).
- `data:<name>` — mutates IN-PROCESS module-level/global state (a cache, a shared accumulator). Breaks
  determinism-across-calls and blocks streaming reuse specifically when the state is HIDDEN/implicit;
  flagged in the registry. (In-process only — external persistence is `io:`, below.)
- `io:<sink>` — external effect: `fs` | `dom` | `postMessage` | `console` | `network` | `db`/`store`. An
  external datastore write is `io:db`, NOT `data:`; and when the store is an EXPLICIT dependency, the
  write is deterministic (a transform of `(inputs, current state) → new state`) — just not pure.

`state` and `mutates` together fully describe behavior: `state: carried:{s,P}` + `mutates: none` is the
clean functional-update pattern (caller owns the returned state); `state: carried` + `mutates:
input:state` is the hazardous in-place variant, declared so nobody aliases it.

**Scope of this taxonomy:** it targets a COMPUTE pipeline whose units aspire to purity, so an effect is a
hazard to flag and drive toward `mutates: none`. A command/repository layer whose PURPOSE is to persist
(a business-rule DB write) is legitimately effectful — it wants its own vocabulary (commands/queries,
repositories, the datastore as an explicit dependency), not "flagged as a defect." `not pure ≠
non-deterministic`: hidden in-process state is the bad case; an explicit external store is a declared part
of the contract.

**The portable ideal:** `causality: pure`, `state: none`, `mutates: none`. Anything else carries an
explicit, reviewable reason. **io belongs in the imperative shell, not the unit:** if a unit would emit
(log, `postMessage`, write a file), prefer returning the value and letting the caller emit — keep the
unit at `mutates: none`. (In this codebase the scorer units return values; `postMessage`/`console` live
in `analyze-worker.js`, the shell.)

**Load-time effect handled once:** every dual-export module runs `self.SensoryNavScore =
Object.assign(…)` at import time. This uniform load-time registration (not a per-call effect) is noted
once in the registry preamble, not stamped `io:global` on every unit.

## 4. Frontmatter schema & format

A delimited block in each unit's leading comment, placed AFTER a one-line prose description so the
existing `scripts/generate-viz-inventory.js` still scrapes the prose as the module description and the
new generator scrapes the fenced fields (the two generators do not collide):

```js
// harness/score/roughness-db.js
// Delta-dB roughness: dB a window's band energy sits above its run's speed-conditioned floor.
// @unit-begin
// unit:        roughness-db
// causality:   pure                 // pure | causal | acausal | compose
// state:       none                 // none | carried:<shape>
// mutates:     none                 // none | input:<n> | setting:<n> | data:<n> | io:<sink>
// contract:    roughnessDb(energies{low,mid,high}, floors{low,mid,high}, weights{low,mid,high}) -> number>=0
// deps:        —                    // sibling units it consumes, by import OR by data
// realtime:    reuse-as-is          // reuse-as-is | needs-streaming-variant | batch-only
// tested-by:   tests/score-roughness-db.test.js
// @unit-end
"use strict";
```

**Field notes:**
- **contract** — the unit's public signature written as its test/reuse spec: entry-point name(s), argument
  shapes, return shape + invariants (`>=0`, "aligned to input length"). Since this is plain JS with no
  type system, the `contract` is the single place shapes/postconditions are stated; because the unit is
  deterministic, the contract *is* the test specification. **Multi-line allowed** — a `compose` unit lists
  its batch entry AND any carved core it exposes (e.g. `scoreResearch(...)` · `scoreWindow(...)`), since
  both are public reuse surfaces.
- **deps** — units whose output this one consumes, whether by code import or by receiving their output as
  data (see §7 fusion rule).
- A unit may legitimately have several exports; the `contract` lists the *public reuse surface*, not
  internal helpers.

## 5. Registry generator

`scripts/generate-scorer-registry.js` scrapes every `@unit-begin … @unit-end` block across `harness/**`
into a derived **`docs/scorer-registry.md`**: a table grouped by `causality`, each row linking file ·
contract · state · mutates · deps · realtime · test. Derived from code — never hand-edited; regenerate in
the same change that touches a unit.

**The generator is also a test** (wired into `npm test`). It fails the build if:
1. a `harness/**` scorer module has no `@unit-begin` block (every unit must be documented);
2. a `tested-by` path does not exist;
3. a `contract` names a function the module does not export;
4. any `mutates: setting:*` appears (defect);
5. a required field is missing or a field value is outside its allowed set.

This keeps the frontmatter from rotting and enforces the "every unit is tested and honestly labelled"
invariant mechanically.

## 6. Per-module map

Most modules just get a **block** (already single-responsibility); only `compose`/fusion units get
**carved**. Byte-identity holds throughout (§8).

**Block-only — add frontmatter, no restructure:**

| Module(s) | class | note |
|---|---|---|
| `linalg`, `geo-project`, `metrics`, `reliability`, `roughness-db`, `tags/schema` | `pure` | already model units |
| `fft`, `audio-windows` (`stft`, `framesToWindows`), `spectral-chaos` (per-window) | `pure`/`causal` | verify `fft` for `mutates: input:` (in-place buffers) |
| `wav-decoder` | `pure` | |
| `baseline` | `fitBaseline`=`acausal`, `floorAt`/`globalFloorAt`=`pure` lookup | classify per function; realtime reuses `floorAt` over a rolling baseline |
| `validate`, `felt`, `report`, `run-scorer`, `score-pass`, `roughness`, `load-pass` | `acausal` / batch tooling | `realtime: batch-only`, no carve |
| `speech-detect` | per-window flag `causal`; range merge `causal` | exclusion is applied by the scorer, not here |
| `motion-track` | `buildMotionTrack`=`compose`/`acausal` (uses RTS); `classifyWindow`/`confidenceFromCov`=`pure` | classify; core carve lives in `kalman-smoother` |

**Carve — split a reusable core out (5 targets):**

| Unit | carved into |
|---|---|
| `kalman-smoother` | keep `forwardFilter`(causal)/`rtsBackward`(acausal)/`smooth`(compose); ADD a per-fix `kalmanStep(state,fix) -> {state,out}` `pure`/`carried:none-mutate` core so a stream folds it |
| `score-frontend` | `causal` windowing+STFT front-end **·** `acausal` motion smoothing, separated so the per-window front-end is reusable |
| `research-scorer` | `acausal` prep (baseline fit, speech ranges) **·** `scoreWindow(window,floors,weights) -> row` `pure` core (batch loop AND realtime call it identically) |
| `squelch-derive` | `joinWindows(chaosSeries, scoredWindows, floors) -> rows` **·** `valueFor(tag,event,rows)` `pure` fusion **·** the event carve below |
| `tags/events` (`detectEvents`) | `chaosThreshold(series) -> thr` `acausal` **·** `seedWindow(row,thr) -> bool` `pure` (preserves the CURRENT predicate `chaos>thr ∧ !low_conf`) **·** `segmentEvents(rows,seedFn,opts) -> events[]` `causal:carried` |

**Net-new reusable cores for the future realtime path:** `kalmanStep`, the causal front-end,
`scoreWindow`, `joinWindows`, `valueFor`, `seedWindow`, `segmentEvents`. Each is `pure` or `causal` with
`mutates: none`; the realtime engine imports these and supplies its own rolling `baseline` /
`chaosThreshold`.

## 7. Coordination / fusion units

Some units combine the OUTPUTS of several other contracts — e.g. an event is the coincidence of high
chaos and an energy condition, and each tag value fuses tonality, sub-bass energy ratio, level-delta, and
a speech flag. The rule that keeps these clean and testable:

**Coordination happens on an explicit *joined row*, never on references between units.** One dedicated
join unit aligns the upstream outputs into a per-window row — the ONLY place fields co-locate:

```
contract: joinWindows(chaosSeries, scoredWindows, floors)
            -> rows[{ t, chaos, tonality, level_db, floor_db, speed, reliability, low_conf }]
```

Every fusion unit's `contract` then takes that **row shape** as input, and its `deps` names the producers
whose outputs are fused (by import OR by data). Because the input is a plain row, a fusion unit is tested
with a synthetic row — no need to run spectral-chaos, baseline, or the front-end — which is what makes it
deterministic and testable in isolation despite logically depending on several units.

**Worked example — `detectEvents` carve** (its real predicate today is `chaos > thr && !low_conf`, where
`thr` is the pass-wide 90th percentile of chaos — an acausal coincidence + segmentation):
- `chaosThreshold(series) -> thr` — `acausal`, batch-only.
- `seedWindow(row, thr) -> bool` — `pure`; the coincidence predicate. This refactor preserves the
  CURRENT rule EXACTLY (`chaos > thr && !low_conf`) to stay byte-identical. Realtime reuses it with a
  rolling `thr`.
- `segmentEvents(rows, seedFn, opts) -> events[]` — `causal:carried` (run-length + merge-gap + max-len
  split + min-len filter).

Because the predicate is now one isolated pure function, a FUTURE change such as adding an explicit
energy term (`chaos>thr ∧ energyΔ>φ ∧ !low_conf`) becomes: edit `seedWindow` + its one fixture test. That
is a separate future change, NOT part of this refactor — this carve changes no output.

## 8. Testing & safety net

1. **Per-core deterministic unit tests** — every carved core (`kalmanStep`, causal front-end,
   `scoreWindow`, `joinWindows`, `valueFor`, `seedWindow`, `segmentEvents`) gets a fixture test asserting
   its `contract` (inputs → exact output/invariants). These are the "test once, reuse anywhere"
   guarantees.
2. **Whole-pass byte-identity gate** — after every carve, regenerate `out/score-jc4/*-clean.json` and diff
   against golden; bit-for-bit unchanged. This is the existing gate used throughout SP3.
3. **Equivalence test per carve** — assert `split composition == original` on a fixture (e.g. `prep +
   fold(scoreWindow)` matches pre-carve `scoreResearch` output), a targeted check beyond the golden diff.
4. **Registry generator as a test** (§5) — wired into `npm test`; fails on undocumented units, dangling
   `tested-by`, contracts naming unexported functions, or `mutates: setting:*`.

All existing tests stay green; new per-core tests are added to the `npm test` chain.

## 9. Ordering (phases)

This cycle = frontmatter standard → scorer refactor. (`chartClient` is a separate later cycle.)

- **Phase A — standard & generator first.** Finalize the block format; write
  `scripts/generate-scorer-registry.js` + generate `docs/scorer-registry.md`; wire its validations into
  `npm test`. (So every unit touched afterward is documented as we go.)
- **Phase B — classify (zero-risk).** Add frontmatter blocks to every block-only module. No code change ⇒
  byte-identity holds trivially; the generator now passes with a fully-populated registry.
- **Phase C — carve (gated), one target at a time**, in order: `kalman-smoother` → `score-frontend` →
  `research-scorer` → `squelch-derive` → `tags/events`. Each target: extract the core → add its
  deterministic unit test → byte-identity gate → equivalence test → regenerate the registry.
- **Phase D — close.** Whole-branch review; final registry regen; update `docs/viz-architecture.md` if any
  export surface changed.

## 10. Constraints & non-goals

- **Byte-identical batch output** is the hard invariant. Any carve that changes a single value of
  `out/score-jc4/*-clean.json` is wrong and must be revised.
- **No algorithm rewrites.** Carving relocates existing logic into named units; it does not change math.
- **No streaming engine** (YAGNI). Cores are made *reusable*; the online baseline / incremental quantiles
  / ring buffers are a future project.
- **Follow existing conventions:** dual Node/browser export (`module.exports` + `self.SensoryNav*`), the
  cross-env `require`/global guard, and shared build helpers under `scripts/lib/`.
- **Supply chain:** no new runtime dependencies; the generator is first-party Node, like the existing
  inventory generator.

## 11. Success criteria / acceptance

1. Every `harness/**` scorer module carries a valid `@unit-begin` frontmatter block; the generator passes
   with zero violations and `docs/scorer-registry.md` lists all units grouped by causality.
2. The generator's four validations (undocumented unit, dangling `tested-by`, unexported contract fn,
   `mutates: setting:*`) run in `npm test` and fail the build when violated (proven by a temporary
   negative check during Phase A).
3. The 5 carve targets each expose their reusable core as an independently importable, `mutates: none`,
   `pure`/`causal` function with its own passing deterministic unit test.
4. `out/score-jc4/*-clean.json` regenerates **byte-identical** to the committed golden after every phase.
5. The full `npm test` suite is green (existing 48 files + new per-core tests).
6. `docs/scorer-registry.md` lets a reader answer, for any unit, "what does it do, how do I call it, what
   does it depend on, does it mutate anything, can I use it in realtime" without reading the source.

## 12. Risks & open questions

- **Hidden mutation surfacing during carving.** A unit assumed `pure` may turn out to mutate an input
  (in-place DSP) or read a global; this is expected and is exactly what the `mutates:` audit surfaces —
  declare it, and if it blocks reuse, note it rather than silently "fixing" (which could break
  byte-identity). Resolution per-unit during Phase B/C.
- **`fft` in-place buffers** — likely `mutates: input:`; confirm during Phase B and declare, do not
  "clean up" (would change output/perf).
- **Join-row field set** — the exact `joinWindows` row shape (§7) must carry every field the fusion units
  and `detectEvents` read; enumerated during the `squelch-derive` carve, cross-checked against current
  `makeValueFor` branches.
- **Registry vs viz-inventory overlap** — both scrape `harness/**`; they must not fight over the leading
  comment. Mitigated by the prose-line-then-fenced-block layout (§4); verified in Phase A.
- **Plan size** — 22 modules + 5 carves is a large plan; the writing-plans step will granularize into
  per-phase, per-target tasks with the byte-identity gate as each task's exit check.
