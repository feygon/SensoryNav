# Change log — 2026-07-09 · ribbon hover parity + chaos statistics

Lightweight fix-list (same pattern as the 2026-07-08 changelog — not the full brainstorm→plan
cycle). Each item is self-contained; check off as landed. Touches the shared ribbon renderer
(`ribbon-render.js`) and, for cross-panel hover, the timeline renderer (`timeline-render.js`) +
`analyze.js` glue.

## Items

- [ ] **R1. Ribbon hover must also snap to the base tick marks — not only spectral-line peaks.**
  In the per-band spectral-chaos ribbon, hovering currently snaps the guide line to the nearest
  point on the chaos/level **data line**. It must ALSO snap to the **event tick marks at the base**
  of each band (same tick-snap behavior the timeline already has). Near a tick → snap to the tick's
  time and surface that event; otherwise snap to the nearest data sample.
  - **Where:** `ribbon-render.js` hover handler (the `sources.tags` event ticks + guide-line logic).
  - **Ref parity:** the timeline's tick-snap from the 2026-07-08 batch (ticks + hover).

- [ ] **R2. Synchronized cross-panel hover.** Hovering/snapping to a time in ONE section must render
  the hover result on **every** section at that same time: guide line, band-edge dots, and tooltip.
  Hovering the sub-bass shows the vertical segment + dots + tooltip on sub-bass, low, and mid/high
  **and** the roughness panel (if roughness applies at that time) — spanning **both** the roughness
  area (timeline) and the spectral-chaos area (ribbon).
  - **Scope note:** this crosses the two SVG renderers (`timeline-render.js` roughness panel +
    `ribbon-render.js` bands). Needs a shared "hovered time" signal so both draw a crosshair at the
    same x. Likely a small hover-sync bus in `analyze.js` (or a shared module) that each renderer
    subscribes to — do NOT fork the hover logic into a third copy.
  - **Open decision:** does this sync apply only inside the analyze page (both charts present), or
    also on the standalone `out/score/*.html` pages (which render one chart at a time)? Default:
    analyze page first; standalone pages keep their existing per-chart hover.

- [ ] **R3. Chaos statistics under an info icon (top-right of the spectral-chaos region).** Show
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

## Notes
- R1/R2 touch the SHARED renderers → the standalone `out/score/*.html` pages inherit R1 (fine);
  R2's cross-panel sync is analyze-page-scoped by default (see R2 open decision).
- R3 is additive UI; the underlying per-band chaos series already exists in `squelch-clean.json`.
