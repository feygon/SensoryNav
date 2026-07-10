// harness/score/score-frontend.js
// Shared "front-end" for on-device / research scoring: decode WAV -> SP1 windows
// (framesToWindows) -> STFT frames -> SP2 Kalman motion track, indexed by window_id.
// Both scripts/score-research.js and scripts/squelch-extract.js compute this identical
// prelude today; this module lifts it so it is computed once per capture and reused by
// both the Node scorer scripts and the on-device Worker (dual Node/self import guard below).
// CARVE TARGET (Phase C): split into a causal windowing+STFT front-end and the acausal motion
// smoothing it currently wires in sequence, so the per-window front-end is reusable on its own.
// This block documents the module's CURRENT (pre-carve) public contract.
// @unit-begin
// unit:        score-frontend
// causality:   compose
// state:       none
// mutates:     none
// contract:    buildFrontEnd(input{wavBytes|samples+sampleRate,audioFirstFrameMs,gpsSamples}) -> {samples,sr,sp1,frames,sp2,sp2By}
// deps:        audio/wav-decoder, audio/audio-windows, motion/motion-track
// realtime:    needs-streaming-variant
// tested-by:   tests/score-frontend.test.js
// @unit-end
"use strict";
var S = (typeof require !== "undefined") ? {
  decodeWav: require("../audio/wav-decoder").decodeWav,
  framesToWindows: require("../audio/audio-windows").framesToWindows,
  stft: require("../audio/audio-windows").stft,
  buildMotionTrack: require("../motion/motion-track").buildMotionTrack
} : self.SensoryNavScore;

// buildFrontEnd(input) -> { samples, sr, sp1, frames, sp2, sp2By }
// input.wavBytes: raw WAV bytes (Uint8Array/ArrayBuffer) -> decoded via decodeWav.
// input.samples + input.sampleRate: pre-decoded audio (skips decodeWav).
// input.audioFirstFrameMs: passed through to framesToWindows.
// input.gpsSamples: passed through to buildMotionTrack.
function buildFrontEnd(input) {
  var dec = input.samples != null
    ? { samples: input.samples, sampleRate: input.sampleRate }
    : S.decodeWav(input.wavBytes);
  var sr = dec.sampleRate;
  var sp1 = S.framesToWindows(dec.samples, sr, input.audioFirstFrameMs);
  var frames = S.stft(dec.samples, sr);
  var sp2 = S.buildMotionTrack(input.gpsSamples, sp1.map(function (w) { return { window_id: w.window_id, started_at_ms: w.started_at_ms }; }), {});
  var sp2By = new Map(); sp2.forEach(function (r) { sp2By.set(r.window_id, r); });
  return { samples: dec.samples, sr: sr, sp1: sp1, frames: frames, sp2: sp2, sp2By: sp2By };
}

// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{ const exported = { buildFrontEnd };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); } }
