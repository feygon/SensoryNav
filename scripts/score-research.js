// scripts/score-research.js
// Generalized research scorer for the timeline tool. For one capture: run SP1+SP2,
// flag talking windows (mid+high co-spike), EXCLUDE them from the speed-conditioned
// baseline, then score every window with a RESEARCH band reweight (high de-emphasized:
// cargo rattle + speech consonants, not road). Emits scored-clean.json + highres-clean.json
// (per-band dB, per-band speed-conditioned FLOOR dB, dB-above-floor roughness, speech
// ranges) for plot-timeline.js. The floor arrays let the timeline draw the car's
// smooth-pavement baseline under the live noise, so the gap reads as the delta-dB.
// Usage: node scripts/score-research.js <sidecar.json> <outDir>
"use strict";
const fs = require("fs");
const path = require("path");
const { decodeWav } = require("../harness/audio/wav-decoder");
const { framesToWindows, stft } = require("../harness/audio/audio-windows");
const { buildMotionTrack } = require("../harness/motion/motion-track");
const { fitBaseline, baselineMeta, floorAt, globalFloorAt } = require("../harness/score/baseline");
const { windowReliability } = require("../harness/score/reliability");
const { validateBatch } = require("../harness/score/validate");
const { roughnessDb, toDb } = require("../harness/score/roughness-db");
const { CONSTANTS } = require("../recorder/constants");

const SCORE_SCALE = CONSTANTS.SCORE_SCALE, DETECT_TAU = 12;
// Research reweight (tool override, NOT product CONSTANTS.WEIGHTS): sums to 1 for
// comparability. high (1-4 kHz) is a small situational slice (cargo rattle + speech).
const RW = { low: 0.6, mid: 0.3, high: 0.1 };
const BANDS = ["low", "mid", "high"];
// Talking signature (tuned on the seat run): mid+high co-elevated for >= SPEECH_FRAMES frames/sec.
const HI = -40, MID = -35, SPEECH_FRAMES = 3;

const sc = process.argv[2];
const outDir = process.argv[3];
if (!sc || !outDir) { console.error("usage: node scripts/score-research.js <sidecar.json> <outDir>"); process.exit(1); }

const sidecar = JSON.parse(fs.readFileSync(sc, "utf8"));
const dec = decodeWav(fs.readFileSync(path.join(path.dirname(sc), sidecar.audio.wav_filename)));
const sr = dec.sampleRate;
const sp1 = framesToWindows(dec.samples, sr, sidecar.audio_first_frame_ms);
const sp2 = buildMotionTrack(sidecar.gps_samples, sp1.map((w) => ({ window_id: w.window_id, started_at_ms: w.started_at_ms })), {});
const sp2By = new Map(); sp2.forEach((r) => sp2By.set(r.window_id, r));

const frames = stft(dec.samples, sr);
const dB = toDb; // shared power->dB (same 1e-12 floor); used for the speech-flag test + band display
const speechCount = {};
for (const f of frames) {
  const w = Math.floor(f.centerSample / sr);
  if (!speechCount[w]) speechCount[w] = 0;
  if (dB(f.energies.high) > HI && dB(f.energies.mid) > MID) speechCount[w]++;
}
const isTalking = (i) => (speechCount[i] || 0) >= SPEECH_FRAMES;

// Baseline samples EXCLUDING talking windows (reliability forced to 0 -> fitBaseline drops them).
const samples = sp1.map((w, i) => {
  const rec = sp2By.get(w.window_id);
  let rel = windowReliability(w, rec, {}).reliability;
  if (isTalking(i)) rel = 0;
  return { speed: rec.speed_mps, low: w.low_energy, mid: w.mid_energy, high: w.high_energy, reliability: rel };
});
// Tiered bin overlap: wide (sparse, mostly low-speed) bins borrow neighbour samples to
// stabilise their floor. >10 m/s span -> 25%, >5 -> 50%, else hard bin.
const baseline = fitBaseline(samples, { OVERLAP_TIERS: [[10, 0.25], [5, 0.50]] });

// Legacy linear (0-100) residual — kept for reference/back-compat; the aggregatable measure
// is the dB delta below via the shared roughness-db module.
function roughLinear(en, floorFn) {
  let raw = 0;
  BANDS.forEach((b) => { raw += RW[b] * Math.max(0, en[b] / floorFn(b) - 1); });
  return Math.min(100, Math.max(0, raw * SCORE_SCALE));
}
// Delta-dB roughness via the shared module: build this window's floors from THIS run's baseline.
function roughDbCalc(en, floorFn) {
  return roughnessDb(en, { low: floorFn("low"), mid: floorFn("mid"), high: floorFn("high") }, RW);
}

const scored = sp1.map((w, i) => {
  const rec = sp2By.get(w.window_id);
  const speed = rec.speed_mps;
  const en = { low: w.low_energy, mid: w.mid_energy, high: w.high_energy };
  const scFloor = (b) => floorAt(baseline, b, speed);
  const glFloor = (b) => globalFloorAt(baseline, b);
  const rraw = roughLinear(en, scFloor);
  const relObj = windowReliability(w, rec, {});
  let reliability = relObj.reliability;
  const flags = relObj.flags.slice();
  if (isTalking(i)) { reliability = 0; flags.push("talking"); }
  return {
    window_id: w.window_id, started_at_ms: w.started_at_ms, lat: rec.lat, lon: rec.lon,
    speed_mps: speed, heading_deg: rec.heading_deg,
    roughness_raw: rraw, roughness: Math.round(rraw), detected: rraw > DETECT_TAU,
    magnitude: rraw, roughness_null: roughLinear(en, glFloor), roughness_db: +roughDbCalc(en, scFloor).toFixed(2),
    reliability, reliability_flags: flags, speed_source: rec.speed_source, sp2_flags: rec.flags,
    felt_present: false, felt_magnitude: null
  };
});

const batch = validateBatch([scored], {});
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "scored-clean.json"), JSON.stringify(scored, null, 2));

// High-res trace against the SAME clean baseline (so the 1 Hz and 47 Hz lines align).
// floLo/floMi/floHi are the per-band floor (this run's smooth-pavement baseline) in dB at
// the frame's speed — the same floorAt() the roughness is measured against, so the timeline
// can draw the baseline directly under the noise and the gap reads as the delta-dB.
const r = [], rdb = [], lo = [], mi = [], hi = [], floLo = [], floMi = [], floHi = [];
for (const f of frames) {
  const t = f.centerSample / sr;
  const wi = Math.min(Math.floor(t), sp2.length - 1);
  const speed = sp2[wi] ? sp2[wi].speed_mps : 0;
  const scFloor = (b) => floorAt(baseline, b, speed);
  r.push(+roughLinear(f.energies, scFloor).toFixed(1));
  rdb.push(+roughDbCalc(f.energies, scFloor).toFixed(2));
  lo.push(+dB(f.energies.low).toFixed(1));
  mi.push(+dB(f.energies.mid).toFixed(1));
  hi.push(+dB(f.energies.high).toFixed(1));
  floLo.push(+dB(scFloor("low")).toFixed(1));
  floMi.push(+dB(scFloor("mid")).toFixed(1));
  floHi.push(+dB(scFloor("high")).toFixed(1));
}
const t0 = frames.length ? +(frames[0].centerSample / sr).toFixed(4) : 0;
const dt = +((CONSTANTS.FFT_SIZE / 2) / sr).toFixed(5);
const flagged = Object.keys(speechCount).map(Number).filter(isTalking).sort((a, b) => a - b);
const speech = [];
for (const w of flagged) {
  if (speech.length && w === speech[speech.length - 1][1]) speech[speech.length - 1][1] = w + 1;
  else speech.push([w, w + 1]);
}
fs.writeFileSync(path.join(outDir, "highres-clean.json"), JSON.stringify({ t0, dt, r, rdb, lo, mi, hi, floLo, floMi, floHi, speech }));

const agg = batch.aggregate;
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };
console.log(path.basename(sc), "->", outDir);
console.log("  windows:", scored.length, "| talking-excluded:", flagged.length, "(" + (100 * flagged.length / scored.length).toFixed(0) + "%) | baseline_meta.low:", JSON.stringify(baselineMeta(baseline).low));
console.log("  roughness_db p50/p90/p99/max:", q(rdb, .5).toFixed(1), q(rdb, .9).toFixed(1), q(rdb, .99).toFixed(1), q(rdb, 1).toFixed(1));
