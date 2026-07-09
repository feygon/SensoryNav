# SensoryNav — dev progress & pending tasks (2026-07-08)

**TL;DR:** The on-device analyze page (record → score in a Web Worker → timeline + ribbon, plus a
capture→analyze hand-off) is **built, committed, and browser-verified**. The two deploy-blockers
(reuse-inventory regen D1, deploy allowlist D2) and the minor-findings triage (D3) are now **done**
(commits `6050f99` + pending). Three items remain: **T12** scoring budget check, the **final Opus
whole-branch review**, and the **on-device capture test** (needs a phone). Nothing is broken —
finish-work.

## Contents
- [Working state / how to run](#working-state--how-to-run)
- [What's complete](#whats-complete)
- [Pending — documentation](#pending--documentation)
- [Pending — development](#pending--development)
- [Known validation gaps (open, documented)](#known-validation-gaps-open-documented)
- [Reference index](#reference-index)

## Working state / how to run
- **Branch:** `feat/sensorynav-harness-sp3` · **HEAD:** `3e115bd` · **merge-base main:** `cb61137`
- **Base before this session's plan:** `8389e58` (weight unification)
- **Serve locally:** `node scripts/serve-out.js` → http://localhost:8137 (serves repo root)
- **Tests:** `npm test` (48 node test files, all green)
- **Fixture:** `data/johnson-creek-pass-4-181806.{wav,json}` (58 MB WAV, 613 GPS fixes) — the JC4 pass
  used for every verification. Golden scorer outputs: `out/score-jc4/{scored,highres,squelch,tags}-clean.json`.
- **Manual analyze test:** open `analyze.html`, drop the JC4 pair (or use the capture hand-off).

## What's complete
On-device analyze parity + UI, commits `8389e58..3e115bd` (23 commits). Highlights:

| Area | What | Key commits |
|---|---|---|
| Weights | Unified on `CONSTANTS.WEIGHTS = 0.6/0.3/0.1`; product weights removed | `8389e58` |
| Renderer | `timeline-render.js` extracted from `plot-timeline.js` (byte-identical) | `a4cc884` |
| Harness ports | SP1/SP2/score/tags dual-export to `self.SensoryNavScore` | `d2d6282`,`b191ef3`,`9a740c3`,`a26d290` |
| Scorer extract | shared front-end + `research-scorer.js` + `squelch-derive.js` (byte-identity triple-proven) | `6cf3e7c`,`52509de`,`4d83738`,`ae5d93b` |
| Worker | `analyze-worker.js` runs the full pipeline; per-module `new Function` isolation | `4808ee1`,`ed8fa9e` |
| Analyze page | timeline + ribbon wired; layout; legend placement; ticks/hover; dB snapping; tooltips; glossary; sticky toolbar | `2715b2c`,`a9a20b3`,`b7dfc70`,`ebc70f4`,`19ed8b7` |
| Capture hand-off | "Analyze upon stopping" + "Also download" → IndexedDB stash → analyze auto-loads | `3e115bd` |

Detailed per-task record: **`.superpowers/sdd/progress.md`** (SDD ledger — Tasks 1–11 complete with
review verdicts). UI batch: **`docs/changelog-2026-07-08-analyze-ui-and-handoff.md`** (all 7 checked).

## Pending — documentation

### D1. Regenerate the reuse inventory — ✅ DONE (commit `6050f99`)
`docs/viz-architecture.md` regenerated (`node scripts/generate-viz-inventory.js`); now lists
`timeline-render.js`, `recorder/capture-handoff.js`, and the full harness scorer chain
(`score-frontend`, `speech-detect`, `research-scorer`, `squelch-derive`, + motion/audio/tags modules).

### D2. Complete the deploy allowlist — ✅ DONE (commit `6050f99`)
`.github/workflows/deploy-pages.yml`:
- Added `timeline.css` + `timeline-render.js` to the web `for f in …` loop.
- The harness worker-module copy list is now **derived from `analyze-worker.js`'s `MODULES` array**
  (`sed`/`grep`), so the allowlist can never drift out of sync with the worker; the deploy fails
  loudly if a declared module is missing from source. All 22 modules verified to resolve.
- Copies `harness/tags/registry.json` (fetched by `analyze.js`). `recorder/*.js` (incl.
  `capture-handoff.js`) already covered.

### D3. Triage the logged Minor review findings — ✅ DONE (commit pending)
Dispositions recorded in `.superpowers/sdd/progress.md` ("D3 minor-findings triage — RESOLVED"):
1. `timeline-render.js` col-0 wrapper indentation → **won't-fix** (intentional; verbatim-moved
   byte-identical functions, reindenting is churn/risk).
2. `tests/browser-scope.test.js` → **fixed** — backfilled `realFftDb` + the whole analyze-worker
   MODULES surface (entry points `buildFrontEnd`/`scoreResearch`/`deriveSquelch`, etc.).
3. `scripts/squelch-extract.js` → **fixed** — relabeled the misleading diagnostic to "first subbass
   floor" (not the old derivation); gated output proven byte-identical.

## Pending — development

### UI-fix backlog (2026-07-09) — ribbon hover + chaos stats
Three follow-up UI fixes, specced with decisions locked in
**`docs/changelog-2026-07-09-ribbon-hover-and-chaos-stats.md`**:
- **R1** — ribbon hover must also snap to the base **event tick marks** (not only the chaos-line
  peaks), matching the timeline's tick-snap.
- **R2** — **synchronized hover within a panel**: hovering one section draws the guide line + dots +
  tooltip on all 4–5 sections of that **same** chart at that time. Per-renderer, does NOT cross
  between the ribbon and the timeline. Primary work is the ribbon (sync across its 4 bands).
- **R3** — **chaos statistics** (median, binned-mode, peak, std-dev) per band + total (weighted
  composite headline + pooled), behind a ⓘ info icon top-right of the spectral-chaos region.

### T12. Scoring time/memory budget (from the plan, Task 12)
Never formalized. Informally ~seconds for the 10-min JC4 pass in-browser, no acceptance check.
- **Target (spec §3):** ≤ ~15 s scoring, ≤ ~500 MB peak worker memory on a Samsung Galaxy A16.
- **Refs:** plan `docs/superpowers/plans/2026-07-07-analyze-ondevice-timeline-parity.md` (Task 12);
  spec `docs/superpowers/specs/2026-07-07-analyze-ondevice-timeline-parity-design.md` §3 "Budgets".

### T-review. Final whole-branch review (Opus)
Not run. **Important:** all the inline UI work this session (renderers, `analyze.js`, hover/ticks/scale,
the hand-off) landed OUTSIDE the per-task SDD review loop, so the final review is where it gets
scrutinized.
- **How:** SDD final review = `superpowers:requesting-code-review` on `cb61137..HEAD` (or `8389e58..HEAD`
  for just this plan's work), most-capable model. Package via
  `.claude/plugins/.../subagent-driven-development/scripts/review-package <BASE> HEAD`.
- **Feed it:** the D3 Minor list + the two "known gaps" below (CSP/eval, single-pass baseline).

### T-device. On-device capture verification
The record → Stop → (Analyze upon stopping) → analyze flow needs a real mic recording on the target
phone; can't be automated. Hand-off round-trip IS verified in-browser (stash → reload → auto-score).
- **Refs:** `capture.html`/`capture.js` (checkboxes + `finalizeAndExport`), `recorder/capture-handoff.js`,
  `analyze.js` (the `takeHandoff()` block at the end of the IIFE). On-device checklist pattern:
  `docs/superpowers/plans/2026-06-25-sensorynav-capture-page.md` (Task 7).

## Known validation gaps (open, documented)
- **Worker `new Function` / eval** — loads our own first-party modules in isolated scopes to avoid the
  shared-`importScripts`-scope collisions (`CONSTANTS`/`BANDS`/`median` …). Fine on GitHub Pages (no
  CSP). If a strict `unsafe-eval`-blocking CSP is ever added, switch to ES-module workers. Rationale in
  the header comment of `analyze-worker.js` and in `.superpowers/sdd/progress.md`.
- **Single-pass baseline stability (N2)** — `OVERLAP_TIERS` was tuned for pooled multi-pass fits;
  single-pass floor stability on an arbitrary drop is asserted, not validated. (spec §3/§9)
- **Low-band chaos folding** — chaos is validated only in sub-bass; folding it into the low timeline
  panel is gated on the incoming highway/rough-road/cargo captures. (spec §9; spectral-chaos spec)

## Reference index
- **SDD ledger (per-task record + minor findings + carried items):** `.superpowers/sdd/progress.md`
- **UI changelog (items 1–7):** `docs/changelog-2026-07-08-analyze-ui-and-handoff.md`
- **This plan's spec:** `docs/superpowers/specs/2026-07-07-analyze-ondevice-timeline-parity-design.md`
- **This plan's plan:** `docs/superpowers/plans/2026-07-07-analyze-ondevice-timeline-parity.md`
- **Reuse inventory (regenerate — D1):** `docs/viz-architecture.md` ← `scripts/generate-viz-inventory.js`
- **Shared browser modules:** `timeline-render.js` (`SensoryNavTimeline`), `ribbon-render.js`
  (`SensoryNavRibbon`), `pipeline.js` (`SensoryNavPipeline`), `recorder/capture-handoff.js`
  (`SensoryNavHandoff`); scorer chain in `harness/**` (`SensoryNavScore` / `SensoryNavCore`).
- **Worker + page:** `analyze-worker.js`, `analyze.html`, `analyze.js`, `analyze.css`, `timeline.css`.
- **Deploy (D2):** `.github/workflows/deploy-pages.yml`.
- **Prior/related specs:** SP1 `2026-06-27-…-sp1-…`, SP2 `2026-06-27-…-sp2-…`, SP3 `2026-06-29-…-sp3-…`,
  spectral-chaos-tags `2026-07-05-…` (all under `docs/superpowers/specs/`).
