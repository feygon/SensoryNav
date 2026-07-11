// tests/score-run.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { scorePasses, runScorer } = require("../harness/score/run-scorer");
const { buildMotionTrack } = require("../harness/motion/motion-track");
const { loadPass } = require("../harness/audio/load-pass");
const { have, skipped } = require("./lib/fixtures");

// --- Synthetic multi-pass: qualifies bins → speed-conditioned path + validation ---
function synthPass(passId, base, withFelt) {
  const sp1 = [], sp2 = [];
  for (let i = 0; i < 30; i++) {
    const rough = i >= 10 && i < 14; // a felt-rough stretch
    sp1.push({ window_id: "w" + i, started_at_ms: base + i * 1000, duration_ms: 1000,
      low_energy: rough ? 6 : 1, mid_energy: rough ? 6 : 1, high_energy: rough ? 6 : 1,
      clip_fraction: 0, frame_count: 45, near_floor: false });
    sp2.push({ window_id: "w" + i, started_at_ms: base + i * 1000, lat: 45, lon: -122,
      speed_mps: 5 + (i % 12), heading_deg: 90, speed_confidence: 1, speed_source: "derived", flags: [] });
  }
  const felt = withFelt ? { spans: [{ start_ms: base + 10000, end_ms: base + 14000, magnitude: 4 }], events: [] } : null;
  return { sp1windows: sp1, sp2track: sp2, felt };
}
const passes = [synthPass("p1", 1000000, true), synthPass("p2", 2000000, true), synthPass("p3", 3000000, true)];
const res = scorePasses(passes, {});
assert.strictEqual(res.per_pass_scored.length, 3);
assert.strictEqual(res.per_pass_scored[0].length, 30);
// rough windows score higher than smooth, and the felt agreement is strong.
assert.ok(res.per_pass_scored[0][11].roughness_raw > res.per_pass_scored[0][0].roughness_raw);
assert.strictEqual(res.batch.aggregate.presence.status, "ok");
assert.ok(res.batch.aggregate.presence.auc > 0.9);

// --- Real johnson-creek pass: end-to-end, asserts global-fallback + no-felt path ---
// loadPass(wavPath, sidecarPath) reads BOTH files and returns { windows, sampleRate, warnings };
// it runs framesToWindows internally, so its `.windows` ARE the SP1 windows (do not re-run framesToWindows).
const sidecarPath = path.join(__dirname, "..", "data", "johnson-creek-pass-1-163508.json");
const realWavPath = path.join(__dirname, "..", "data", "johnson-creek-pass-1-163508.wav");
if (have(sidecarPath, realWavPath)) {
  const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
  const wavPath = path.join(path.dirname(sidecarPath), sidecar.audio.wav_filename);
  const loaded = loadPass(wavPath, sidecarPath);
  const sp1real = loaded.windows;
  const sp2real = buildMotionTrack(sidecar.gps_samples, sp1real.map((w) => ({ window_id: w.window_id, started_at_ms: w.started_at_ms })), {});
  const realRes = scorePasses([{ sp1windows: sp1real, sp2track: sp2real, felt: null }], {});
  // Verified empirically: this pass yields 25 windows, only 12 reliable (GPS gaps zero the rest),
  // 12 < MIN_BIN_SAMPLES(20) → 0 qualified bins → baseline collapses to global for every band; and felt=null → no_felt.
  assert.strictEqual(realRes.baseline_meta.low.fell_back_to_global, true);
  assert.strictEqual(realRes.batch.aggregate.presence.status, "no_felt");

  // --- runScorer writes the four artifacts to a temp dir ---
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp3-"));
  const summary = runScorer({ passFiles: [sidecarPath], outDir, params: {} });
  assert.ok(fs.existsSync(path.join(outDir, "summary.json")));
  assert.ok(fs.existsSync(path.join(outDir, "scored-0.json")));
  assert.ok(fs.existsSync(path.join(outDir, "scored-0.csv")));
  assert.ok(fs.existsSync(path.join(outDir, "inspection-0.html")));
  assert.ok(summary.aggregate);
} else {
  skipped("score-run.test.js real-pass sections", sidecarPath);
}

// --- Malformed sidecar guard: missing audio.wav_filename produces a legible error ---
{
  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp3-bad-"));
  const badSidecarPath = path.join(badDir, "bad.json");
  fs.writeFileSync(badSidecarPath, JSON.stringify({ gps_samples: [] }), "utf8");
  const badOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp3-bad-out-"));
  assert.throws(
    () => runScorer({ passFiles: [badSidecarPath], outDir: badOutDir, params: {} }),
    /missing audio\.wav_filename/
  );
}

console.log("score-run tests passed");
