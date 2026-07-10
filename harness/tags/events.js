// harness/tags/events.js
// Detects sub-bass chaos events: a pass-wide 90th-percentile chaos threshold seeds/extends a
// run wherever chaos exceeds it (and the point isn't near-silence), then merges close runs and
// splits/filters by length. Task C5 carved this into three composable cores: chaosThreshold
// (acausal, the pass-wide percentile), seedWindow (pure, the per-row seed predicate), and
// segmentEvents (causal:carried, the run-length/merge/split/min-len assembly) — detectEvents is
// now a thin composition of the three.
// @unit-begin
// unit:        events
// causality:   compose
// state:       none
// mutates:     none
// contract:    detectEvents(series,opts) -> events[{i_start,i_end,t_start,t_end}]
//              chaosThreshold(series,opts) -> number — acausal (pass-wide percentile)
//              seedWindow(row,thr) -> boolean — pure (row.chaos > thr && !row.low_conf)
//              segmentEvents(rows,seedFn,opts) -> events[{i_start,i_end,t_start,t_end}] — causal:carried
// deps:        —
// realtime:    needs-streaming-variant
// tested-by:   tests/tags-events.test.js, tests/event-carve.test.js
// @unit-end
"use strict";
function pct(arr, p) { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(p * (s.length - 1))] : 0; }
// chaosThreshold: acausal — the pass-wide pctile-th percentile of chaos over the whole series.
function chaosThreshold(series, opts) {
  const o = Object.assign({ pctile: 0.90 }, opts || {});
  return pct(series.map((p) => p.chaos), o.pctile);
}
// seedWindow: pure per-row seed predicate. A near-silence point (low_conf) must never seed or
// extend an event: the Global Constraints spec says a near-silence window emits confidence 0 and
// cannot seed an event, but tonality->0 in near-silence drives chaos->1 (max), so without this
// guard it would be the MOST likely point to seed. Existing {t,chaos}-only test fixtures have
// `low_conf` undefined, and `!undefined === true`, so this is backward-compatible.
function seedWindow(row, thr) {
  return row.chaos > thr && !row.low_conf;
}
// segmentEvents: causal:carried — run-length-groups the rows where seedFn(row) is true, merges
// gaps <= mergeGapS, splits runs longer than maxLenS, and filters runs shorter than minLenS.
function segmentEvents(rows, seedFn, opts) {
  const o = Object.assign({ mergeGapS: 0.5, maxLenS: 2.0, minLenS: 0.1, hopS: 0.25 }, opts || {});
  const gap = Math.round(o.mergeGapS / o.hopS), maxN = Math.round(o.maxLenS / o.hopS);
  const raw = [];
  let s = -1;
  for (let i = 0; i <= rows.length; i++) {
    const on = i < rows.length && seedFn(rows[i]);
    if (on && s < 0) s = i;
    else if (!on && s >= 0) { raw.push([s, i - 1]); s = -1; }
  }
  const merged = [];
  for (const r of raw) {
    if (merged.length && r[0] - merged[merged.length - 1][1] <= gap) merged[merged.length - 1][1] = r[1];
    else merged.push(r.slice());
  }
  const out = [];
  for (const [a, b] of merged) {
    for (let x = a; x <= b; x += maxN) {
      const y = Math.min(b, x + maxN - 1);
      if ((y - x + 1) * o.hopS >= o.minLenS) out.push({ i_start: x, i_end: y, t_start: rows[x].t, t_end: rows[y].t });
    }
  }
  return out;
}
function detectEvents(series, opts) {
  return segmentEvents(series, (row) => seedWindow(row, chaosThreshold(series, opts)), opts);
}
// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { detectEvents, chaosThreshold, seedWindow, segmentEvents };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
