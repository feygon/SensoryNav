// tests/motion-track-latlon.test.js
"use strict";
const assert = require("assert");
const { buildMotionTrack } = require("../harness/motion/motion-track");
const { projectFixes, R_EARTH } = require("../harness/motion/geo-project");

const DEG = Math.PI / 180;
const BASE = 1000000;
function windows(n, t0) { const w = []; for (let i = 0; i < n; i++) w.push({ window_id: "w" + i, started_at_ms: t0 + i * 1000 }); return w; }
function fix(t, lat, lon, speed, acc) { return { sample_id: "g", captured_at_ms: t, latitude: lat, longitude: lon, speed_mps: speed, accuracy_meters: acc }; }
const MPD_LON = R_EARTH * Math.cos(45 * DEG) * DEG;
const DLON = 12 / MPD_LON;
function cvFix(i) { return fix(BASE + i * 1000, 45.0, -122.0 + DLON * i, 12, 3); }

// (a) projection inverse identity: project then invert ≈ original lat/lon.
const fixes = [fix(0, 45.0, -122.0, 12, 3), fix(1000, 45.002, -121.997, 12, 3)];
const { points, lat0, lon0 } = projectFixes(fixes);
points.forEach((p, i) => {
  const lat = lat0 + p.y / (R_EARTH * DEG);
  const lon = lon0 + p.x / (R_EARTH * DEG * Math.cos(lat0 * DEG));
  assert.ok(Math.abs(lat - fixes[i].latitude) < 1e-9, `lat ${lat}`);
  assert.ok(Math.abs(lon - fixes[i].longitude) < 1e-9, `lon ${lon}`);
});

// (b) buildMotionTrack emits numeric lat/lon: lat≈45, lon increases eastward.
const cv = []; for (let i = 0; i < 20; i++) cv.push(cvFix(i));
const track = buildMotionTrack(cv, windows(18, BASE));
assert.ok(Number.isFinite(track[5].lat) && Number.isFinite(track[5].lon));
assert.ok(Math.abs(track[5].lat - 45.0) < 1e-4, `lat=${track[5].lat}`);
assert.ok(track[10].lon > track[5].lon, "lon should increase eastward");

// (c) < 2 fixes → lat/lon null.
const few = buildMotionTrack([cvFix(0)], windows(3, BASE));
assert.strictEqual(few[0].lat, null);
assert.strictEqual(few[0].lon, null);

console.log("motion-track-latlon tests passed");
