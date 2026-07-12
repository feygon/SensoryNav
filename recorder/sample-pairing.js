"use strict";

const { CONSTANTS } = require("./constants");
const { colorForScore } = require("./cvd-scale");

function nearestGps(audioWindow, gpsSamples, maxSkewMs) {
  let best = null;
  let bestDist = Infinity;
  for (const gps of gpsSamples) {
    const dist = Math.abs(gps.captured_at_ms - audioWindow.started_at_ms);
    if (dist > maxSkewMs) {
      continue;
    }
    if (dist < bestDist || (dist === bestDist && gps.captured_at_ms < best.captured_at_ms)) {
      best = gps;
      bestDist = dist;
    }
  }
  return best;
}

function pairWindowsWithGps(windows, gpsSamples, maxSkewSeconds) {
  const seconds = maxSkewSeconds === undefined ? CONSTANTS.PAIR_MAX_SKEW_SECONDS : maxSkewSeconds;
  const maxSkewMs = seconds * 1000;
  return windows.map((audioWindow) => {
    const match = nearestGps(audioWindow, gpsSamples, maxSkewMs);
    if (!match) {
      return {
        window_id: audioWindow.window_id,
        gps_sample_id: null,
        gps_captured_at_ms: null,
        location_status: "missing",
        latitude: null,
        longitude: null,
        auditory_roughness_score: audioWindow.auditory_roughness_score,
        color: null
      };
    }
    return {
      window_id: audioWindow.window_id,
      gps_sample_id: match.sample_id,
      gps_captured_at_ms: match.captured_at_ms,
      location_status: "paired",
      latitude: match.latitude,
      longitude: match.longitude,
      auditory_roughness_score: audioWindow.auditory_roughness_score,
      color: colorForScore(audioWindow.auditory_roughness_score)
    };
  });
}

const exported = { pairWindowsWithGps, nearestGps };

if (typeof module !== "undefined" && module.exports) {
  module.exports = exported;
}
if (typeof window !== "undefined") {
  window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported);
}
