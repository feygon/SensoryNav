// harness/score/research-scorer.js
// Pure, worker-callable RESEARCH scorer: flag talking windows (mid+high co-spike, via the
// shared speech-detect.js), EXCLUDE them from the speed-conditioned baseline, then score every
// window with the canonical band weights (low 0.6 / mid 0.3 / high 0.1 — CONSTANTS.WEIGHTS;
// there is no separate "research" reweight, the product weights were removed so this scorer,
// the SP3 scorer, and the app can never diverge). Produces the exact `scored` array and `hires`
// trace object that scripts/score-research.js writes to scored-clean.json / highres-clean.json.
// Extracted verbatim from scripts/score-research.js (Task 8) so the derivation is reusable from
// a Worker; the script itself is now a thin I/O wrapper around scoreResearch().
// scoreResearch does the acausal prep (baseline fit, speech ranges, talking exclusion) and maps
// the pure scoreWindow() core over every window — the same core a future realtime path can call
// per-window without the acausal prep.
// @unit-begin
// unit:        research-scorer
// causality:   compose
// state:       none
// mutates:     none
// contract:    scoreResearch(front,opts) -> {scored[],hires,baseline_meta}
//              scoreWindow(w,rec,talking,floors,globalFloors,weights,scoreScale,detectTau) -> row
// deps:        score/baseline, score/reliability, score/roughness-db, score/score-frontend (front is its output)
// realtime:    needs-streaming-variant
// tested-by:   tests/research-scorer.test.js, tests/score-window.test.js
// @unit-end
"use strict";
var { CONSTANTS } = (typeof require !== "undefined") ? require("../../recorder/constants") : self.SensoryNavCore;
var D = (typeof require !== "undefined") ? {
  fitBaseline: require("./baseline").fitBaseline,
  floorAt: require("./baseline").floorAt,
  globalFloorAt: require("./baseline").globalFloorAt,
  baselineMeta: require("./baseline").baselineMeta,
  windowReliability: require("./reliability").windowReliability,
  roughnessDb: require("./roughness-db").roughnessDb,
  toDb: require("./roughness-db").toDb
} : self.SensoryNavScore;

const BANDS = ["low", "mid", "high"];
const DEFAULT_OVERLAP_TIERS = [[10, 0.25], [5, 0.50]];

// Baseline samples EXCLUDING talking windows (reliability forced to 0 -> fitBaseline drops them).
function baselineSamples(front) {
  const { sp1, sp2By, speech } = front;
  return sp1.map((w, i) => {
    const rec = sp2By.get(w.window_id);
    let rel = D.windowReliability(w, rec, {}).reliability;
    if (speech.isTalking(i)) rel = 0;
    return { speed: rec.speed_mps, low: w.low_energy, mid: w.mid_energy, high: w.high_energy, reliability: rel };
  });
}

// Legacy linear (0-100) residual — kept for reference/back-compat; the aggregatable measure
// is the dB delta via the shared roughness-db module. `floors` is a { low, mid, high } map
// (this window's speed-conditioned floor, or the global null-model floor).
function roughLinear(en, floors, RW, SCORE_SCALE) {
  let raw = 0;
  BANDS.forEach((b) => { raw += RW[b] * Math.max(0, en[b] / floors[b] - 1); });
  return Math.min(100, Math.max(0, raw * SCORE_SCALE));
}

// Pure per-window scoring core: no baseline, no Map lookups, no closed-over front/speech state —
// everything the row needs is an explicit argument, so a future realtime path can call this once
// per window without the acausal prep scoreResearch performs. `mutates: none` — reads w/rec, never
// writes them.
//   w:            sp1 window record (window_id, started_at_ms, low/mid/high_energy, ...)
//   rec:          this window's sp2By record (speed_mps, lat, lon, heading_deg, speed_source, flags, ...)
//   talking:      bool — speech.isTalking(i) for this window's index, resolved by the caller
//   floors:       { low, mid, high } — THIS run's speed-conditioned baseline floor at rec.speed_mps
//   globalFloors: { low, mid, high } — THIS run's global (speed-blind) null-model floor
//   weights:      { low, mid, high } — CONSTANTS.WEIGHTS, passed in (never read off the global here)
//   scoreScale, detectTau: scalars from opts/CONSTANTS
function scoreWindow(w, rec, talking, floors, globalFloors, weights, scoreScale, detectTau) {
  const en = { low: w.low_energy, mid: w.mid_energy, high: w.high_energy };
  const rraw = roughLinear(en, floors, weights, scoreScale);
  const relObj = D.windowReliability(w, rec, {});
  let reliability = relObj.reliability;
  const flags = relObj.flags.slice();
  if (talking) { reliability = 0; flags.push("talking"); }
  return {
    window_id: w.window_id, started_at_ms: w.started_at_ms, lat: rec.lat, lon: rec.lon,
    speed_mps: rec.speed_mps, heading_deg: rec.heading_deg,
    roughness_raw: rraw, roughness: Math.round(rraw), detected: rraw > detectTau,
    magnitude: rraw, roughness_null: roughLinear(en, globalFloors, weights, scoreScale), roughness_db: +D.roughnessDb(en, floors, weights).toFixed(2),
    reliability, reliability_flags: flags, speed_source: rec.speed_source, sp2_flags: rec.flags,
    felt_present: false, felt_magnitude: null
  };
}

function floorsAt(baseline, speed) {
  return { low: D.floorAt(baseline, "low", speed), mid: D.floorAt(baseline, "mid", speed), high: D.floorAt(baseline, "high", speed) };
}
function globalFloorsFor(baseline) {
  return { low: D.globalFloorAt(baseline, "low"), mid: D.globalFloorAt(baseline, "mid"), high: D.globalFloorAt(baseline, "high") };
}

// High-res trace against the SAME clean baseline (so the 1 Hz and 47 Hz lines align).
// floLo/floMi/floHi are the per-band floor (this run's smooth-pavement baseline) in dB at
// the frame's speed — the same floorAt() the roughness is measured against, so the timeline
// can draw the baseline directly under the noise and the gap reads as the delta-dB.
function hiresTrace(front, baseline, RW, SCORE_SCALE) {
  const { frames, sr, sp2, speech } = front;
  const dB = D.toDb;
  const r = [], rdb = [], lo = [], mi = [], hi = [], floLo = [], floMi = [], floHi = [];
  for (const f of frames) {
    const t = f.centerSample / sr;
    const wi = Math.min(Math.floor(t), sp2.length - 1);
    const speed = sp2[wi] ? sp2[wi].speed_mps : 0;
    const floors = floorsAt(baseline, speed);
    r.push(+roughLinear(f.energies, floors, RW, SCORE_SCALE).toFixed(1));
    rdb.push(+D.roughnessDb(f.energies, floors, RW).toFixed(2));
    lo.push(+dB(f.energies.low).toFixed(1));
    mi.push(+dB(f.energies.mid).toFixed(1));
    hi.push(+dB(f.energies.high).toFixed(1));
    floLo.push(+dB(floors.low).toFixed(1));
    floMi.push(+dB(floors.mid).toFixed(1));
    floHi.push(+dB(floors.high).toFixed(1));
  }
  const t0 = frames.length ? +(frames[0].centerSample / sr).toFixed(4) : 0;
  const dt = +((CONSTANTS.FFT_SIZE / 2) / sr).toFixed(5);
  return { t0, dt, r, rdb, lo, mi, hi, floLo, floMi, floHi, speech: speech.speechRanges };
}

// scoreResearch(front, opts) -> { scored, hires }
// front: buildFrontEnd()'s result ({ samples, sr, sp1, frames, sp2, sp2By }) PLUS
// front.speech (detectSpeech()'s result: { speechCount, isTalking, speechRanges }).
// opts: { OVERLAP_TIERS, SCORE_SCALE, DETECT_TAU } — all optional, defaulting to the
// current research-scorer behaviour.
function scoreResearch(front, opts) {
  const p = opts || {};
  const RW = CONSTANTS.WEIGHTS;
  const SCORE_SCALE = p.SCORE_SCALE != null ? p.SCORE_SCALE : CONSTANTS.SCORE_SCALE;
  const DETECT_TAU = p.DETECT_TAU != null ? p.DETECT_TAU : 12;
  const OVERLAP_TIERS = p.OVERLAP_TIERS || DEFAULT_OVERLAP_TIERS;

  const samples = baselineSamples(front);
  const baseline = D.fitBaseline(samples, { OVERLAP_TIERS });

  const { sp1, sp2By, speech } = front;
  const gFloors = globalFloorsFor(baseline);
  const scored = sp1.map((w, i) => {
    const rec = sp2By.get(w.window_id);
    const talking = speech.isTalking(i);
    return scoreWindow(w, rec, talking, floorsAt(baseline, rec.speed_mps), gFloors, RW, SCORE_SCALE, DETECT_TAU);
  });
  const hires = hiresTrace(front, baseline, RW, SCORE_SCALE);

  // baseline_meta: not part of scored-clean/highres-clean, but exposed alongside them so a
  // caller (e.g. the wrapper's console summary) can report baseline diagnostics without
  // re-fitting the baseline itself.
  return { scored, hires, baseline_meta: D.baselineMeta(baseline) };
}

// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { scoreResearch, scoreWindow };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
