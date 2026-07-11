# Change log — 2026-07-09 · ribbon hover parity + chaos statistics

Lightweight fix-list (same pattern as the 2026-07-08 changelog — not the full brainstorm→plan
cycle). Each item is self-contained; check off as landed. Touches the shared ribbon renderer
(`ribbon-render.js`) and, for cross-panel hover, the timeline renderer (`timeline-render.js`) +
`analyze.js` glue.

## Items

- [x] **R1. Ribbon hover must also snap to the base tick marks — not only spectral-line peaks.**
  In the per-band spectral-chaos ribbon, hovering currently snaps the guide line to the nearest
  point on the chaos/level **data line**. It must ALSO snap to the **event tick marks at the base**
  of each band (same tick-snap behavior the timeline already has). Near a tick → snap to the tick's
  time and surface that event; otherwise snap to the nearest data sample.
  - **Where:** `ribbon-render.js` hover handler (the `sources.tags` event ticks + guide-line logic).
  - **Ref parity:** the timeline's tick-snap from the 2026-07-08 batch (ticks + hover).

- [x] **R2. Synchronized hover across all sections *within a panel*.** Hovering/snapping to a time in
  ONE section must render the hover result on **every** section of that **same panel** at that same
  time: guide line, band-edge dots, and tooltip. Hovering the ribbon's sub-bass shows the vertical
  segment + dots + tooltip on sub-bass, low, and mid/high together at the same x.
  - **Scope (owner-confirmed 2026-07-09): per-panel, single renderer — does NOT cross panels.** Each
    chart syncs its own 4–5 sections internally; the ribbon and the timeline do **not** drive each
    other. Primary work is the **ribbon** (`ribbon-render.js`): one hover handler → shared crosshair
    down all 4 bands. No cross-renderer bus.
  - **Done (ribbon):** one `mousemove` handler now draws the guide segment + top/bottom/centre dots on
    every band at the same snapped time and lists all four bands (level · chaos · tonality) in one
    tooltip, hovered band highlighted. Browser-verified on jc4 (crosshair spans all bands; tooltip
    lists sub-bass/low/mid/high; base-tick snap surfaces the event's tags). Commit: see git log.
  - **Done (timeline) — owner-approved 2026-07-09:** `timeline-render.js`'s `showHover` now works the
    same way. The hovered panel picks the snapped time tS (event tick near the main/sub base, else a
    band peak-snap, else nearest sample); every shown panel then draws its guide segment + dots at one
    shared crosshair x, and the tooltip aggregates all sections (speed/roughness + composition, sub-bass,
    low, mid/high). Browser-verified on jc4: single guide x across main/sub/low/mid-high, 11 dots
    distributed across the four panels, aggregated tooltip. Event-at-base tag display preserved.

- [x] **R3. Chaos statistics under an info icon (top-right of the spectral-chaos region).** Show
  per-band **and** total: **median, mode, peak (max), and standard deviation** of **spectral chaos**
  across the whole trip. Put it behind a small ⓘ info icon in the top-right of the spectral-chaos
  region so it stays out of the way until opened (popover/panel on click; dark-mode-correct, no
  pure-white).
  - **Decisions (owner-confirmed 2026-07-09):**
    1. **Metric = chaos only** (tonality-derived, 0–1), per band (sub-bass / low / mid / high).
       Not roughness-dB.
    2. **Mode = binned modal bucket.** Bin chaos into fixed 0.05-wide buckets and report the
       most-populated bucket (e.g. label it as the bucket center or range). Keep median + peak + std-dev
       as exact (unbinned) values.
    3. **Total row = BOTH** — headline is the **weighted composite** (low0.6 / mid0.3 / high0.1, the
       "felt" aggregate the scorer already uses); show the **pooled** (all-bands-unweighted) figure
       alongside it.
  - **Where:** `ribbon-render.js` header area (add the ⓘ + popover); stats computed from the same
    squelch series the ribbon already has, so no re-derivation. Only NaN/null samples excluded
    (bands can have null gaps where SNR is too low).
  - **Done:** ⓘ button top-right of the ribbon; click toggles a dark popover (`#1b1b1b`, no pure-white)
    with a per-band table (median · binned-mode · peak · σ · n) plus `total · weighted` (low0.6/mid0.3/
    high0.1 composite, rule-separated) and `total · pooled`. Closes on ×, outside-click, or Esc.
    Browser-verified on jc4 (pooled n = 2444 + 2445×3 = 9779; weighted peak 0.926 < 1.0 as expected).

## Notes
- R1/R2 touch the SHARED renderers → the standalone `out/score/*.html` pages inherit R1 (fine);
  R2 syncs within each renderer (ribbon bands; timeline panels), not across them.
- R3 is additive UI; the underlying per-band chaos series already exists in `squelch-clean.json`.

## Post-review fixes (whole-branch review, 2026-07-09)
A Senior-reviewer pass over `8389e58..HEAD` (no Critical). Fixed:
- **Important — timeline stride-rounding OOB:** `drawLowAt`/`drawMHAt` (and the `peakSnap` centres in
  `showHover`) rounded a hires index UP to a stride multiple, which could exceed the last array index
  → `hr.lo[i]` undefined → `toFixed` throw at the plot's right edge. Now clamped with
  `Math.min(len-1, …)`. Browser-verified: far-right hover across all panels renders valid tooltips at
  t≈608–610s (maxT) with **zero exceptions**.
- **Important — deploy MODULES extraction failed OPEN:** if the `sed`/`grep` parse yielded nothing
  (e.g. the `var MODULES = [` form changed), the copy loop ran zero times and the job exited 0,
  shipping a worker that 404s. Now fails CLOSED: aborts if fewer than 20 modules parse (loosened the
  match to any `MODULES = [` declaration). Verified locally: 22 modules parsed, guard passes.
- **Minor:** ribbon R3 popover leaked a `document` click/keydown listener per re-render → now removes
  the prior render's handlers (module-scoped registry). Ribbon hover now uses ONE shared crosshair x
  across bands (was per-band). `analyze.js` revokes the previous object URL before minting a new one.
- Re-verified in-browser: ribbon single guide x + 4-band tooltip + 6-row stats; timeline right-edge
  no-throw. Full suite green (48 files).
