// harness/score/research-scorer.js
// Pure, worker-callable RESEARCH scorer: flag talking windows (mid+high co-spike, via the
// shared speech-detect.js), EXCLUDE them from the speed-conditioned baseline, then score every
// window with the canonical band weights (low 0.6 / mid 0.3 / high 0.1 — CONSTANTS.WEIGHTS;
// there is no separate "research" reweight, the product weights were removed so this scorer,
// the SP3 scorer, and the app can never diverge). Produces the exact `scored` array and `hires`
// trace object that scripts/score-research.js writes to scored-clean.json / highres-clean.json.
// Extracted verbatim from scripts/score-research.js (Task 8) so the derivation is reusable from
// a Worker; the script itself is now a thin I/O wrapper around scoreResearch().
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
// is the dB delta via the shared roughness-db module.
function roughLinear(en, floorFn, RW, SCORE_SCALE) {
  let raw = 0;
  BANDS.forEach((b) => { raw += RW[b] * Math.max(0, en[b] / floorFn(b) - 1); });
  return Math.min(100, Math.max(0, raw * SCORE_SCALE));
}
// Delta-dB roughness via the shared module: build this window's floors from THIS run's baseline.
function roughDbCalc(en, floorFn, RW) {
  return D.roughnessDb(en, { low: floorFn("low"), mid: floorFn("mid"), high: floorFn("high") }, RW);
}

function scoreWindow(front, baseline, RW, SCORE_SCALE, DETECT_TAU) {
  const { sp1, sp2By, speech } = front;
  return sp1.map((w, i) => {
    const rec = sp2By.get(w.window_id);
    const speed = rec.speed_mps;
    const en = { low: w.low_energy, mid: w.mid_energy, high: w.high_energy };
    const scFloor = (b) => D.floorAt(baseline, b, speed);
    const glFloor = (b) => D.globalFloorAt(baseline, b);
    const rraw = roughLinear(en, scFloor, RW, SCORE_SCALE);
    const relObj = D.windowReliability(w, rec, {});
    let reliability = relObj.reliability;
    const flags = relObj.flags.slice();
    if (speech.isTalking(i)) { reliability = 0; flags.push("talking"); }
    return {
      window_id: w.window_id, started_at_ms: w.started_at_ms, lat: rec.lat, lon: rec.lon,
      speed_mps: speed, heading_deg: rec.heading_deg,
      roughness_raw: rraw, roughness: Math.round(rraw), detected: rraw > DETECT_TAU,
      magnitude: rraw, roughness_null: roughLinear(en, glFloor, RW, SCORE_SCALE), roughness_db: +roughDbCalc(en, scFloor, RW).toFixed(2),
      reliability, reliability_flags: flags, speed_source: rec.speed_source, sp2_flags: rec.flags,
      felt_present: false, felt_magnitude: null
    };
  });
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
    const scFloor = (b) => D.floorAt(baseline, b, speed);
    r.push(+roughLinear(f.energies, scFloor, RW, SCORE_SCALE).toFixed(1));
    rdb.push(+roughDbCalc(f.energies, scFloor, RW).toFixed(2));
    lo.push(+dB(f.energies.low).toFixed(1));
    mi.push(+dB(f.energies.mid).toFixed(1));
    hi.push(+dB(f.energies.high).toFixed(1));
    floLo.push(+dB(scFloor("low")).toFixed(1));
    floMi.push(+dB(scFloor("mid")).toFixed(1));
    floHi.push(+dB(scFloor("high")).toFixed(1));
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

  const scored = scoreWindow(front, baseline, RW, SCORE_SCALE, DETECT_TAU);
  const hires = hiresTrace(front, baseline, RW, SCORE_SCALE);

  // baseline_meta: not part of scored-clean/highres-clean, but exposed alongside them so a
  // caller (e.g. the wrapper's console summary) can report baseline diagnostics without
  // re-fitting the baseline itself.
  return { scored, hires, baseline_meta: D.baselineMeta(baseline) };
}

// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { scoreResearch };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
