// harness/score/reliability.js
// Per-window reliability weight: multiplies speed-confidence, clip, frame-coverage, and
// near-floor gates into one [0,1] factor plus the flags that drove it down.
// @unit-begin
// unit:        reliability
// causality:   pure
// state:       none
// mutates:     none
// contract:    windowReliability(sp1win,sp2rec,params) -> {reliability,flags}
// deps:        —
// realtime:    reuse-as-is
// tested-by:   tests/score-reliability.test.js
// @unit-end
"use strict";

const DEFAULTS = { CLIP_TOL: 0.02, FULL_FRAMES: 45 };
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function windowReliability(sp1win, sp2rec, params) {
  const p = Object.assign({}, DEFAULTS, params || {});
  const speedFactor = sp2rec.speed_confidence;
  const clipFactor = clamp01(1 - sp1win.clip_fraction / p.CLIP_TOL);
  const frameFactor = clamp01(sp1win.frame_count / p.FULL_FRAMES);
  const floorGate = sp1win.near_floor ? 0 : 1;
  const reliability = speedFactor * clipFactor * frameFactor * floorGate;

  const flags = [];
  if (speedFactor < 1) flags.push("low_speed_confidence");
  if (clipFactor < 1) flags.push("clipped");
  if (frameFactor < 1) flags.push("partial_window");
  if (floorGate === 0) flags.push("near_floor");
  for (const f of (sp2rec.flags || [])) flags.push(f);

  return { reliability, flags };
}

// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { windowReliability };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
