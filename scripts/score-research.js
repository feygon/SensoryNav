// scripts/score-research.js
// Generalized research scorer for the timeline tool. For one capture: run SP1+SP2,
// flag talking windows (mid+high co-spike), EXCLUDE them from the speed-conditioned
// baseline, then score every window with a RESEARCH band reweight (high de-emphasized:
// cargo rattle + speech consonants, not road). Emits scored-clean.json + highres-clean.json
// (per-band dB, per-band speed-conditioned FLOOR dB, dB-above-floor roughness, speech
// ranges) for plot-timeline.js. The floor arrays let the timeline draw the car's
// smooth-pavement baseline under the live noise, so the gap reads as the delta-dB.
// This is a thin I/O wrapper: the derivation lives in harness/score/research-scorer.js
// (pure, worker-callable) so it can be reused by the on-device Worker.
// Usage: node scripts/score-research.js <sidecar.json> <outDir>
"use strict";
const fs = require("fs");
const path = require("path");
const { buildFrontEnd } = require("../harness/score/score-frontend");
const { detectSpeech } = require("../harness/score/speech-detect");
const { scoreResearch } = require("../harness/score/research-scorer");

const sc = process.argv[2];
const outDir = process.argv[3];
if (!sc || !outDir) { console.error("usage: node scripts/score-research.js <sidecar.json> <outDir>"); process.exit(1); }

const sidecar = JSON.parse(fs.readFileSync(sc, "utf8"));
const wavBytes = fs.readFileSync(path.join(path.dirname(sc), sidecar.audio.wav_filename));
const front = buildFrontEnd({ wavBytes, audioFirstFrameMs: sidecar.audio_first_frame_ms, gpsSamples: sidecar.gps_samples });
const speech = detectSpeech(front.frames, front.sr);
const { scored, hires, baseline_meta } = scoreResearch(Object.assign({}, front, { speech }), {});

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "scored-clean.json"), JSON.stringify(scored, null, 2));
fs.writeFileSync(path.join(outDir, "highres-clean.json"), JSON.stringify(hires));

const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };
const flaggedCount = speech.speechRanges.reduce((n, [s, e]) => n + (e - s), 0);
console.log(path.basename(sc), "->", outDir);
console.log("  windows:", scored.length, "| talking-excluded:", flaggedCount, "(" + (100 * flaggedCount / scored.length).toFixed(0) + "%) | baseline_meta.low:", JSON.stringify(baseline_meta.low));
console.log("  roughness_db p50/p90/p99/max:", q(hires.rdb, .5).toFixed(1), q(hires.rdb, .9).toFixed(1), q(hires.rdb, .99).toFixed(1), q(hires.rdb, 1).toFixed(1));
