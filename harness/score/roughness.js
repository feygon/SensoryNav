// harness/score/roughness.js
"use strict";
const { roughnessScoreRaw } = require("../../recorder/audio-scoring");
const { floorAt, globalFloorAt } = require("./baseline");

const DEFAULTS = { DETECT_TAU: 12 };

function scoreWindowRoughness(sp1win, speed, baseline, params) {
  const p = Object.assign({}, DEFAULTS, params || {});
  const floorFor = p.useNullFloor
    ? (band) => globalFloorAt(baseline, band)
    : (band) => floorAt(baseline, band, speed);
  const floor = { low: floorFor("low"), mid: floorFor("mid"), high: floorFor("high") };
  const energies = { low: sp1win.low_energy, mid: sp1win.mid_energy, high: sp1win.high_energy };
  const raw = roughnessScoreRaw(energies, { effective_floor: floor });
  return { roughness_raw: raw, roughness: Math.round(raw), detected: raw > p.DETECT_TAU, magnitude: raw };
}

module.exports = { scoreWindowRoughness };
