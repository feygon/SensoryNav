// harness/score/run-scorer.js
"use strict";
const fs = require("fs");
const path = require("path");
const { loadPass } = require("../audio/load-pass");
const { buildMotionTrack } = require("../motion/motion-track");
const { fitBaseline, baselineMeta } = require("./baseline");
const { windowReliability } = require("./reliability");
const { scorePass } = require("./score-pass");
const { validateBatch } = require("./validate");
const { scoredWindowsJson, sessionSummaryJson, scoredWindowsCsv, inspectionHtml } = require("./report");

// Pure core: passes = [{ sp1windows, sp2track, felt }].
function scorePasses(passes, params) {
  // First pass: pool (speed, band energies, reliability) samples across all passes.
  const samples = [];
  for (const pass of passes) {
    const sp2By = new Map();
    for (const r of pass.sp2track) sp2By.set(r.window_id, r);
    for (const w of pass.sp1windows) {
      const sp2 = sp2By.get(w.window_id);
      if (!sp2) throw new Error("scorePasses: window_id " + w.window_id + " missing in SP2 track");
      const { reliability } = windowReliability(w, sp2, params);
      samples.push({ speed: sp2.speed_mps, low: w.low_energy, mid: w.mid_energy, high: w.high_energy, reliability });
    }
  }
  const baseline = fitBaseline(samples, params);
  const per_pass_scored = passes.map((pass) => scorePass(pass.sp1windows, pass.sp2track, baseline, pass.felt, params));
  const batch = validateBatch(per_pass_scored, params);
  return { baseline, baseline_meta: baselineMeta(baseline), per_pass_scored, batch };
}

function loadPassToWindows(passFile, params) {
  // passFile is the sidecar JSON path; the WAV path is derived from sidecar.audio.wav_filename
  // (resolved relative to the sidecar's own directory). loadPass reads BOTH and returns
  // { windows, sampleRate, warnings } — its `.windows` are the SP1 windows (framesToWindows runs inside).
  const sidecar = JSON.parse(fs.readFileSync(passFile, "utf8"));
  const wavPath = path.join(path.dirname(passFile), sidecar.audio.wav_filename);
  const loaded = loadPass(wavPath, passFile);
  const sp1windows = loaded.windows;
  const sp2track = buildMotionTrack(sidecar.gps_samples, sp1windows.map((w) => ({ window_id: w.window_id, started_at_ms: w.started_at_ms })), params);
  const felt = sidecar.felt || null; // optional inline felt; file-based felt can be wired by the caller
  return { sp1windows, sp2track, felt };
}

// IO driver.
function runScorer(opts) {
  const params = opts.params || {};
  const passes = opts.passFiles.map((f) => loadPassToWindows(f, params));
  const res = scorePasses(passes, params);
  fs.mkdirSync(opts.outDir, { recursive: true });
  const summary = Object.assign({}, res.batch, { baseline_meta: res.baseline_meta });
  fs.writeFileSync(path.join(opts.outDir, "summary.json"), sessionSummaryJson(summary));
  res.per_pass_scored.forEach((scored, i) => {
    fs.writeFileSync(path.join(opts.outDir, "scored-" + i + ".json"), scoredWindowsJson(scored));
    fs.writeFileSync(path.join(opts.outDir, "scored-" + i + ".csv"), scoredWindowsCsv(scored));
    fs.writeFileSync(path.join(opts.outDir, "inspection-" + i + ".html"), inspectionHtml(scored, summary));
  });
  return summary;
}

module.exports = { scorePasses, runScorer };
