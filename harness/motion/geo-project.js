// harness/motion/geo-project.js
"use strict";

const R_EARTH = 6371000;
const DEG = Math.PI / 180;

function projectFixes(gpsSamples) {
  const n = gpsSamples.length;
  let sumLat = 0, sumLon = 0;
  for (const g of gpsSamples) { sumLat += g.latitude; sumLon += g.longitude; }
  const lat0 = n ? sumLat / n : 0;
  const lon0 = n ? sumLon / n : 0;
  const cosLat0 = Math.cos(lat0 * DEG);
  const points = gpsSamples.map((g) => ({
    t: g.captured_at_ms,
    x: R_EARTH * (g.longitude - lon0) * DEG * cosLat0,
    y: R_EARTH * (g.latitude - lat0) * DEG,
    acc: g.accuracy_meters,
    speedNative: (g.speed_mps === null || g.speed_mps === undefined) ? null : g.speed_mps
  }));
  return { points, lat0, lon0 };
}

function bearingDeg(vEast, vNorth) {
  return ((Math.atan2(vEast, vNorth) * 180 / Math.PI) + 360) % 360;
}

module.exports = { projectFixes, bearingDeg, R_EARTH };
