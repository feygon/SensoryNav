"use strict";
function pct(arr, p) { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(p * (s.length - 1))] : 0; }
function detectEvents(series, opts) {
  const o = Object.assign({ pctile: 0.90, mergeGapS: 0.5, maxLenS: 2.0, minLenS: 0.1, hopS: 0.25 }, opts || {});
  const thr = pct(series.map((p) => p.chaos), o.pctile);
  const gap = Math.round(o.mergeGapS / o.hopS), maxN = Math.round(o.maxLenS / o.hopS);
  const raw = [];
  let s = -1;
  for (let i = 0; i <= series.length; i++) {
    // A near-silence point (low_conf) must never seed or extend an event: the Global
    // Constraints spec says a near-silence window emits confidence 0 and cannot seed an
    // event, but tonality->0 in near-silence drives chaos->1 (max), so without this guard
    // it would be the MOST likely point to seed. Existing {t,chaos}-only test fixtures have
    // `low_conf` undefined, and `!undefined === true`, so this is backward-compatible.
    const on = i < series.length && series[i].chaos > thr && !series[i].low_conf;
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
      if ((y - x + 1) * o.hopS >= o.minLenS) out.push({ i_start: x, i_end: y, t_start: series[x].t, t_end: series[y].t });
    }
  }
  return out;
}
// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { detectEvents };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
