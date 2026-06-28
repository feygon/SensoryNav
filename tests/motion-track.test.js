// tests/motion-track.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildMotionTrack } = require("../harness/motion/motion-track");

const BASE = 1000000;
function windows(n, t0) {
  const w = [];
  for (let i = 0; i < n; i++) w.push({ window_id: "w" + i, started_at_ms: t0 + i * 1000 });
  return w;
}
function fix(t, lat, lon, speed, acc) {
  return { sample_id: "g", captured_at_ms: t, latitude: lat, longitude: lon, speed_mps: speed, accuracy_meters: acc };
}
// 12 m/s eastward → lon step per second at lat 45.
const MPD_LON = 6371000 * Math.cos(45 * Math.PI / 180) * Math.PI / 180; // meters per degree lon
const DLON = 12 / MPD_LON;
function cvFix(i, speed, acc) { return fix(BASE + i * 1000, 45.0, -122.0 + DLON * i, speed, acc); }

// --- CV track: speed ~12, heading ~East, Doppler agrees ---
const cv = []; for (let i = 0; i < 30; i++) cv.push(cvFix(i, 12, 5));
const track = buildMotionTrack(cv, windows(28, BASE));
assert.strictEqual(track.length, 28);
assert.strictEqual(track[0].window_id, "w0");
for (let i = 5; i < 20; i++) {
  assert.ok(Math.abs(track[i].speed_mps - 12) < 0.1, `speed@${i}=${track[i].speed_mps}`);
  assert.ok(Math.abs(track[i].heading_deg - 90) < 2, `heading@${i}=${track[i].heading_deg}`);
}
assert.strictEqual(track[10].speed_source, "native_crosschecked");

// --- Gap test: long hole → gap_unscored; moderate distance → interpolated ---
const gapFixes = [];
for (let i = 0; i < 5; i++) gapFixes.push(cvFix(i, 12, 5));    // BASE..BASE+4000
for (let i = 30; i < 35; i++) gapFixes.push(cvFix(i, 12, 5));  // BASE+30000..+34000 (26 s hole)
const gt = buildMotionTrack(gapFixes, windows(35, BASE));
const w17 = gt[17]; // center BASE+17500 → 12.5 s from nearest fix → gap_unscored
assert.strictEqual(w17.speed_confidence, 0);
assert.ok(w17.flags.includes("gap_unscored"));
assert.ok(!w17.flags.includes("low_accuracy")); // suppressed on gap_unscored
const w7 = gt[7]; // center BASE+7500 → ~3.5 s from fix BASE+4000 → interpolated
assert.ok(w7.flags.includes("interpolated"));
assert.ok(w7.speed_confidence <= 0.5 + 1e-9);
assert.strictEqual(w7.speed_source, "interpolated"); // Doppler does not relabel it

// --- Stationary: same location → heading null + flag; Doppler 0 vs derived 0 → native_crosschecked ---
const stat = []; for (let i = 0; i < 10; i++) stat.push(fix(BASE + i * 1000, 45.0, -122.0, 0, 5));
const st = buildMotionTrack(stat, windows(8, BASE));
assert.strictEqual(st[3].heading_deg, null);
assert.ok(st[3].flags.includes("stationary"));
assert.strictEqual(st[3].speed_source, "native_crosschecked");

// --- Confidence monotonicity: dense/accurate > sparse/inaccurate ---
const dense = []; for (let i = 0; i < 20; i++) dense.push(cvFix(i, 12, 5));
const sparse = []; for (let i = 0; i < 20; i += 4) sparse.push(cvFix(i, 12, 100));
const denseT = buildMotionTrack(dense, windows(18, BASE));
const sparseT = buildMotionTrack(sparse, windows(18, BASE));
assert.ok(denseT[10].speed_confidence > sparseT[10].speed_confidence);

// --- Doppler mismatch: native says 50, positions imply 12 ---
const dis = []; for (let i = 0; i < 20; i++) dis.push(cvFix(i, 50, 5));
const disT = buildMotionTrack(dis, windows(18, BASE));
assert.ok(disT[10].flags.includes("doppler_mismatch"));
assert.strictEqual(disT[10].speed_source, "derived");

// --- Dedup/sort: out-of-order fixes + a duplicate timestamp → no throw, sane track ---
const unsorted = [cvFix(2, 12, 5), cvFix(0, 12, 5), cvFix(1, 12, 5), cvFix(1, 12, 5)];
const dt = buildMotionTrack(unsorted, windows(3, BASE));
assert.strictEqual(dt.length, 3);
assert.ok(Number.isFinite(dt[1].speed_mps));

// --- < 2 fixes → all insufficient_fixes ---
const few = buildMotionTrack([cvFix(0, 12, 5)], windows(5, BASE));
assert.strictEqual(few.length, 5);
assert.strictEqual(few[0].speed_source, "insufficient_fixes");
assert.strictEqual(few[0].speed_confidence, 0);
assert.strictEqual(few[0].heading_deg, null);

// --- Real-pass smoke test (mechanics + trust model, not real motion) ---
const sidecar = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "johnson-creek-pass-1-163508.json"), "utf8"));
const realTrack = buildMotionTrack(sidecar.gps_samples, windows(25, sidecar.audio_first_frame_ms));
assert.strictEqual(realTrack.length, 25);
for (let i = 0; i < 25; i++) assert.strictEqual(realTrack[i].window_id, "w" + i);
const lowTrust = realTrack.filter((r) => r.flags.includes("interpolated") || r.flags.includes("gap_unscored")).length;
assert.ok(lowTrust >= 10, `expected many low-trust windows, got ${lowTrust}`);

console.log("motion-track tests passed");
