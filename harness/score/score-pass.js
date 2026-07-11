// harness/score/score-pass.js
// Per-pass fusion: joins SP1 windows with the SP2 motion track, scores roughness against a
// (pre-fit) baseline, computes reliability, and attaches felt ground-truth if provided.
// @unit-begin
// unit:        score-pass
// causality:   acausal
// state:       none
// mutates:     none
// contract:    scorePass(sp1windows,sp2track,baseline,felt,params) -> scored[]
// deps:        score/roughness, score/reliability, score/felt
// realtime:    batch-only
// tested-by:   tests/score-pass.test.js
// @unit-end
"use strict";
const { scoreWindowRoughness } = require("./roughness");
const { windowReliability } = require("./reliability");
const { mapFeltToWindows } = require("./felt");

function scorePass(sp1windows, sp2track, baseline, felt, params) {
  const sp2By = new Map();
  for (const r of sp2track) sp2By.set(r.window_id, r);
  const feltMap = felt ? mapFeltToWindows(felt, sp1windows) : null;

  return sp1windows.map((w, i) => {
    const sp2 = sp2By.get(w.window_id);
    if (!sp2) throw new Error("scorePass: window_id " + w.window_id + " missing in SP2 track");
    const speed = sp2.speed_mps;
    const rough = scoreWindowRoughness(w, speed, baseline, params);
    const roughNull = scoreWindowRoughness(w, speed, baseline, Object.assign({}, params, { useNullFloor: true })).roughness_raw;
    const rel = windowReliability(w, sp2, params);
    return {
      window_id: w.window_id,
      started_at_ms: w.started_at_ms,
      lat: sp2.lat,
      lon: sp2.lon,
      speed_mps: speed,
      heading_deg: sp2.heading_deg,
      roughness_raw: rough.roughness_raw,
      roughness: rough.roughness,
      detected: rough.detected,
      magnitude: rough.magnitude,
      roughness_null: roughNull,
      reliability: rel.reliability,
      reliability_flags: rel.flags,
      speed_source: sp2.speed_source,
      sp2_flags: sp2.flags,
      felt_present: feltMap ? feltMap[i].felt_present : false,
      felt_magnitude: feltMap ? feltMap[i].felt_magnitude : null
    };
  });
}

module.exports = { scorePass };
