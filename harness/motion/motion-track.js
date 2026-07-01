// harness/motion/motion-track.js
"use strict";
const { CONSTANTS } = require("../../recorder/constants");
const { projectFixes, bearingDeg, R_EARTH } = require("./geo-project");
const DEG = Math.PI / 180;
const { smooth, evaluateAt } = require("./kalman-smoother");

const WINDOW_DURATION_MS = CONSTANTS.WINDOW_DURATION_MS;

const DEFAULTS = {
  SIGMA_A: 2.0, STATIONARY_SPEED: 0.5, GAP_INTERP_S: 3.0, GAP_MAX_S: 10.0,
  INTERP_CAP: 0.5, ACC_FLAG_M: 50, DOPPLER_TOL: 0.25, DOPPLER_PENALTY: 0.5, VAR_SCALE: 1.0
};

function confidenceFromCov(velTraceVar, params) {
  return 1 / (1 + velTraceVar / params.VAR_SCALE);
}

function sortDedupFixes(gpsSamples) {
  const sorted = gpsSamples.slice().sort((a, b) => a.captured_at_ms - b.captured_at_ms);
  const out = [];
  for (const g of sorted) {
    if (out.length && g.captured_at_ms <= out[out.length - 1].captured_at_ms) continue;
    out.push(g);
  }
  return out;
}

function inWindowDoppler(startedAtMs, fixes) {
  for (const f of fixes) {
    if (f.speedNative !== null && f.t >= startedAtMs && f.t < startedAtMs + WINDOW_DURATION_MS) {
      return f.speedNative;
    }
  }
  return null;
}

// Canonical classification pipeline (spec §6.2).
function classifyWindow(t, startedAtMs, speed, vEast, vNorth, velTraceVar, fixes, params) {
  let confidence = confidenceFromCov(velTraceVar, params);
  let source = null;
  const flags = [];
  let heading = bearingDeg(vEast, vNorth);

  let nearest = null, nearestGapS = Infinity;
  for (const f of fixes) {
    const g = Math.abs(f.t - t) / 1000;
    if (g < nearestGapS) { nearestGapS = g; nearest = f; }
  }

  let gapUnscored = false;
  if (nearestGapS > params.GAP_MAX_S) {
    confidence = 0; source = "interpolated"; flags.push("gap_unscored"); gapUnscored = true;
  } else if (nearestGapS > params.GAP_INTERP_S) {
    confidence = Math.min(confidence, params.INTERP_CAP); source = "interpolated"; flags.push("interpolated");
  }

  if (!gapUnscored && nearest && nearest.acc > params.ACC_FLAG_M) flags.push("low_accuracy");

  if (speed < params.STATIONARY_SPEED) { heading = null; flags.push("stationary"); }

  if (source === null) {
    const dop = inWindowDoppler(startedAtMs, fixes);
    if (dop !== null) {
      const relErr = Math.abs(dop - speed) / Math.max(dop, speed, 0.1);
      if (relErr <= params.DOPPLER_TOL) {
        source = "native_crosschecked";
      } else {
        source = "derived"; flags.push("doppler_mismatch"); confidence *= params.DOPPLER_PENALTY;
      }
    } else {
      source = "derived";
    }
  }

  confidence = Math.max(0, Math.min(1, confidence));
  return { confidence, source, flags, heading };
}

function windowMotion(w, smoothed, fixes, params, lat0, lon0) {
  const t = w.started_at_ms + WINDOW_DURATION_MS / 2;
  const { s, P } = evaluateAt(smoothed, t, params.SIGMA_A);
  const vEast = s[2], vNorth = s[3];
  const speed = Math.sqrt(vEast * vEast + vNorth * vNorth);
  const velTraceVar = P[2][2] + P[3][3];
  const c = classifyWindow(t, w.started_at_ms, speed, vEast, vNorth, velTraceVar, fixes, params);
  return {
    window_id: w.window_id,
    started_at_ms: w.started_at_ms,
    // inverse equirectangular projection: north axis s[1] -> lat, east axis s[0] -> lon (do not swap)
    lat: lat0 + s[1] / (R_EARTH * DEG),
    lon: lon0 + s[0] / (R_EARTH * DEG * Math.cos(lat0 * DEG)),
    speed_mps: speed,
    heading_deg: c.heading,
    speed_confidence: c.confidence,
    speed_source: c.source,
    flags: c.flags
  };
}

function buildMotionTrack(gpsSamples, windows, params) {
  const p = Object.assign({}, DEFAULTS, params || {});
  const fixesRaw = sortDedupFixes(gpsSamples);
  if (fixesRaw.length < 2) {
    return windows.map((w) => ({
      window_id: w.window_id,
      started_at_ms: w.started_at_ms,
      lat: null,
      lon: null,
      speed_mps: 0,
      heading_deg: null,
      speed_confidence: 0,
      speed_source: "insufficient_fixes",
      flags: ["gap_unscored"]
    }));
  }
  const { points, lat0, lon0 } = projectFixes(fixesRaw);
  const smoothed = smooth(points, p.SIGMA_A);
  return windows.map((w) => windowMotion(w, smoothed, points, p, lat0, lon0));
}

module.exports = { buildMotionTrack, classifyWindow, confidenceFromCov, sortDedupFixes };
