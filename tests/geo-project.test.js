// tests/geo-project.test.js
"use strict";
const assert = require("assert");
const { projectFixes, bearingDeg } = require("../harness/motion/geo-project");

function fix(t, lat, lon, speed, acc) {
  return { sample_id: "g", captured_at_ms: t, latitude: lat, longitude: lon, speed_mps: speed, accuracy_meters: acc };
}

// Single fix → projects to ~(0,0) at the mean; fields carried.
const one = projectFixes([fix(1000, 45.5, -122.6, 10, 5)]);
assert.ok(Math.abs(one.points[0].x) < 1e-6 && Math.abs(one.points[0].y) < 1e-6);
assert.strictEqual(one.points[0].acc, 5);
assert.strictEqual(one.points[0].speedNative, 10);
assert.strictEqual(one.points[0].t, 1000);

// 0.002° north between two fixes ≈ 222 m in y.
const two = projectFixes([fix(0, 45.000, -122.0, null, 5), fix(1000, 45.002, -122.0, null, 5)]);
const dy = two.points[1].y - two.points[0].y;
const expected = 6371000 * 0.002 * Math.PI / 180;
assert.ok(Math.abs(dy - expected) / expected < 0.01);
assert.strictEqual(two.points[0].speedNative, null); // null preserved

// Eastward offset → +x.
const east = projectFixes([fix(0, 45.0, -122.000, null, 5), fix(1000, 45.0, -121.998, null, 5)]);
assert.ok(east.points[1].x > east.points[0].x);

// Bearing convention: 0=N, 90=E, 180=S, 270=W.
assert.ok(Math.abs(bearingDeg(0, 1) - 0) < 1e-9);
assert.ok(Math.abs(bearingDeg(1, 0) - 90) < 1e-9);
assert.ok(Math.abs(bearingDeg(0, -1) - 180) < 1e-9);
assert.ok(Math.abs(bearingDeg(-1, 0) - 270) < 1e-9);

console.log("geo-project tests passed");
