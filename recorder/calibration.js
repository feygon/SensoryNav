"use strict";

const { CONSTANTS } = require("./constants");

function median(values) {
  if (!values.length) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function computeBaseline(windowEnergies, energyFloorMin) {
  const floor = energyFloorMin === undefined ? CONSTANTS.ENERGY_FLOOR_MIN : energyFloorMin;
  const lowMedian = median(windowEnergies.map((w) => w.low));
  const midMedian = median(windowEnergies.map((w) => w.mid));
  const highMedian = median(windowEnergies.map((w) => w.high));
  return {
    low_median: lowMedian,
    mid_median: midMedian,
    high_median: highMedian,
    energy_floor_min: floor,
    effective_floor: {
      low: Math.max(lowMedian, floor),
      mid: Math.max(midMedian, floor),
      high: Math.max(highMedian, floor)
    }
  };
}

const exported = { computeBaseline, median };

if (typeof module !== "undefined" && module.exports) {
  module.exports = exported;
}
if (typeof window !== "undefined") {
  window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported);
}
