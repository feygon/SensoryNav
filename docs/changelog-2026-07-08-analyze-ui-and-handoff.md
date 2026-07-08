# Change log — 2026-07-08 · analyze/timeline UI + capture→analyze hand-off

Lightweight spec + checklist (not the full brainstorm→plan cycle — session is deep in context).
Each item is a self-contained change; checked off as landed.

## Items

- [x] **1. Snap all dB y-scales to multiples of 5/10.** Every data region with a decibel y-axis —
  the timeline's sub-bass / low / mid-high panels, the roughness-dB axis, and the ribbon's shared
  axis — must have its min/max snapped to a multiple of 5 (or 10), padding the data by no more than
  10 dB in either direction. (Fixes ugly ticks like `-62 / -48 / -36`.)

- [x] **2. Tooltips on panel labels.** Each panel's header label (timeline main / sub-bass / low /
  mid-high, and the ribbon rows) gets a hover tooltip explaining that panel in more detail than the
  one-line label. Use the SVG-native `<title>` child on the label `<text>` (browser tooltip).

- [x] **3. Expand the glossary.** Walk the whole analyze page for scientific terms and add a
  glossary entry for each (spectral flatness, tonality, chaos, delta-dB, speed-conditioned baseline,
  floor, sub-bass fold, reliability, envelope, saturation, Kalman/SP2, ICC, etc.).

- [x] **4. Sticky timeline controls.** When scrolled down through the (tall) scored timeline, freeze
  the Play / Reset-zoom / Rough dB / Bands toolbar to the top of the viewport (`position: sticky`),
  with a readable background, so the controls stay usable while looking at lower panels.

- [ ] **5. Capture: "Analyze upon stopping" checkbox (default CHECKED).** On Stop, instead of
  downloading, hand the just-recorded WAV + sidecar to the analyze page (IndexedDB one-shot stash),
  navigate there, load them into the drop slots, and analyze automatically.

- [ ] **6. Capture: "Also download files" checkbox (default UNCHECKED).** When checked, also download
  the files on Stop (in addition to whatever "Analyze upon stopping" does).

- [ ] **7. Capture: unchecked "Analyze upon stopping" ⇒ always download.** When "Analyze upon
  stopping" is off, Stop downloads the files as today (regardless of checkbox 6).

## Notes
- Items 1–2 touch the SHARED renderers (`timeline-render.js`, `ribbon-render.js`) → the standalone
  `out/score/*.html` pages inherit the improvements (fine).
- Item 5 hand-off = the deferred Stop→Analyze follow-up, now being built. New module
  `recorder/capture-handoff.js` (IndexedDB put/take), consumed by `capture.js` + `analyze.js`.
