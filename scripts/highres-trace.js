// scripts/highres-trace.js
// Emit the ~47 Hz per-frame trace SP1 computes internally and averages away to 1 Hz.
// Uses the same baseline as run-scorer (pooled over the given passes) and the per-window
// speed, so the high-res roughness is directly comparable to the 1 Hz line. Also emits
// per-band energy in dB (log scale) so the low/mid/high shapes are legible.
// Output (compact, uniform frame spacing): { t0, dt, r:[...], lo:[...], mi:[...], hi:[...] }
//   r  = per-frame roughness_raw (0-100)
//   lo/mi/hi = per-frame band energy in dB (10*log10 power)
// Usage: node scripts/highres-trace.js [displaySidecar] [outPath] [poolSidecar...]
//   no args -> defaults to the Johnson Creek dashboard batch (131504+134511, display 134511)
//   with a displaySidecar and no explicit pool -> single-pass baseline (that pass alone)
"use strict";
const fs = require("fs");
const path = require("path");
const { decodeWav } = require("../harness/audio/wav-decoder");
const { framesToWindows, stft } = require("../harness/audio/audio-windows");
const { buildMotionTrack } = require("../harness/motion/motion-track");
const { scorePasses } = require("../harness/score/run-scorer");
const { floorAt } = require("../harness/score/baseline");
const { CONSTANTS } = require("../recorder/constants");

const FFT_SIZE = CONSTANTS.FFT_SIZE, HOP = FFT_SIZE / 2;
const { WEIGHTS, SCORE_SCALE } = CONSTANTS;

const displayFile = process.argv[2] || "data/johnson-creek-pass-1-134511.json";
const outPath = process.argv[3] || "out/score/highres-1.json";
let poolFiles;
if (process.argv.length > 4) poolFiles = process.argv.slice(4);        // explicit pool
else if (process.argv[2]) poolFiles = [displayFile];                   // single-pass baseline
else poolFiles = ["data/johnson-creek-pass-1-131504.json", "data/johnson-creek-pass-1-134511.json"]; // default batch

function loadPassData(sidecarPath) {
  const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
  const wavPath = path.join(path.dirname(sidecarPath), sidecar.audio.wav_filename);
  const decoded = decodeWav(fs.readFileSync(wavPath));
  const sp1windows = framesToWindows(decoded.samples, decoded.sampleRate, sidecar.audio_first_frame_ms);
  const sp2track = buildMotionTrack(
    sidecar.gps_samples,
    sp1windows.map((w) => ({ window_id: w.window_id, started_at_ms: w.started_at_ms })),
    {}
  );
  return { sidecarPath, decoded, sp1windows, sp2track };
}

const passes = poolFiles.map(loadPassData);
const res = scorePasses(passes.map((p) => ({ sp1windows: p.sp1windows, sp2track: p.sp2track, felt: null })), {});
const baseline = res.baseline;

let disp = passes[poolFiles.indexOf(displayFile)];
if (!disp) disp = loadPassData(displayFile);
const sr = disp.decoded.sampleRate;
const frames = stft(disp.decoded.samples, sr);

function frameRoughness(energies, speed) {
  let raw = 0;
  ["low", "mid", "high"].forEach((b) => {
    const floor = floorAt(baseline, b, speed);
    raw += WEIGHTS[b] * Math.max(0, energies[b] / floor - 1);
  });
  return Math.min(100, Math.max(0, raw * SCORE_SCALE));
}
function dB(e) { return +(10 * Math.log10(Math.max(e, 1e-12))).toFixed(1); }

const r = [], lo = [], mi = [], hi = [];
for (const f of frames) {
  const tRel = f.centerSample / sr;
  const wi = Math.min(Math.floor(tRel), disp.sp2track.length - 1);
  const speed = disp.sp2track[wi] ? disp.sp2track[wi].speed_mps : 0;
  r.push(+frameRoughness(f.energies, speed).toFixed(1));
  lo.push(dB(f.energies.low));
  mi.push(dB(f.energies.mid));
  hi.push(dB(f.energies.high));
}
const t0 = frames.length ? +(frames[0].centerSample / sr).toFixed(4) : 0;
const dt = +(HOP / sr).toFixed(5);

// Talking-contamination flag: a 1 s window is flagged when >= SPEECH_FRAMES frames show the
// speech signature (high band AND mid band co-elevated). Derived from the seat-vs-dashboard
// analysis: speech is broadband mid+high, road/mount transients are not. Emitted as merged
// [start,end) second ranges so the chart can ribbon them.
const HI_DB = -40, MID_DB = -35, SPEECH_FRAMES = 3;
const wc = {};
for (let i = 0; i < r.length; i++) {
  const w = Math.floor(t0 + i * dt);
  if (!wc[w]) wc[w] = { n: 0, s: 0 };
  wc[w].n++;
  if (hi[i] > HI_DB && mi[i] > MID_DB) wc[w].s++;
}
const flagged = Object.keys(wc).map(Number).filter((w) => wc[w].s >= SPEECH_FRAMES).sort((a, b) => a - b);
const speech = [];
for (const w of flagged) {
  if (speech.length && w === speech[speech.length - 1][1]) speech[speech.length - 1][1] = w + 1;
  else speech.push([w, w + 1]);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ t0, dt, r, lo, mi, hi, speech }));
const flaggedSec = flagged.length, totalSec = Object.keys(wc).length;
console.log("wrote", outPath, "-", r.length, "frames at ~" + (dt ? (1 / dt).toFixed(0) : "0") + " Hz; display=" + path.basename(displayFile) + " pool=" + poolFiles.length);
console.log("talking-flagged windows:", flaggedSec, "of", totalSec, "(" + (100 * flaggedSec / totalSec).toFixed(0) + "%), in", speech.length, "ranges");
