// harness/score/score-frontend.js
// Shared "front-end" for on-device / research scoring: decode WAV -> SP1 windows
// (framesToWindows) -> STFT frames -> SP2 Kalman motion track, indexed by window_id.
// Both scripts/score-research.js and scripts/squelch-extract.js compute this identical
// prelude today; this module lifts it so it is computed once per capture and reused by
// both the Node scorer scripts and the on-device Worker (dual Node/self import guard below).
// The causal windowing+STFT front-end (buildWindows) is carved out from the acausal motion
// smoothing, so the per-window front-end is reusable on its own.
// @unit-begin
// unit:        score-frontend
// causality:   compose
// state:       none
// mutates:     none
// contract:    buildFrontEnd(input{wavBytes|samples+sampleRate,audioFirstFrameMs,gpsSamples}) -> {samples,sr,sp1,frames,sp2,sp2By}
//              buildWindows(wavBytes,audioFirstFrameMs) -> {samples,sr,sp1,frames}
//              (causal core: decode -> framesToWindows -> stft; mutates:none)
// deps:        audio/wav-decoder, audio/audio-windows, motion/motion-track
// realtime:    needs-streaming-variant
// tested-by:   tests/score-frontend.test.js, tests/score-frontend-core.test.js
// @unit-end
"use strict";
var S = (typeof require !== "undefined") ? {
  decodeWav: require("../audio/wav-decoder").decodeWav,
  framesToWindows: require("../audio/audio-windows").framesToWindows,
  stft: require("../audio/audio-windows").stft,
  buildMotionTrack: require("../motion/motion-track").buildMotionTrack
} : self.SensoryNavScore;

// windowsFromDecoded(samples, sr, audioFirstFrameMs) -> { samples, sr, sp1, frames }
// Shared causal core: already-decoded samples -> SP1 windows + STFT frames. Both buildWindows
// (decodes from wavBytes first) and buildFrontEnd's pre-decoded-samples input path call this,
// so decode and windowing never fork into two copies.
function windowsFromDecoded(samples, sr, audioFirstFrameMs) {
  var sp1 = S.framesToWindows(samples, sr, audioFirstFrameMs);
  var frames = S.stft(samples, sr);
  return { samples: samples, sr: sr, sp1: sp1, frames: frames };
}

// buildWindows(wavBytes, audioFirstFrameMs) -> { samples, sr, sp1, frames }
// CAUSAL core of the front-end: decode WAV -> SP1 windows (framesToWindows) -> STFT frames.
// No GPS/motion dependency, so it is reusable wherever only the audio side is needed.
function buildWindows(wavBytes, audioFirstFrameMs) {
  var dec = S.decodeWav(wavBytes);
  return windowsFromDecoded(dec.samples, dec.sampleRate, audioFirstFrameMs);
}

// buildFrontEnd(input) -> { samples, sr, sp1, frames, sp2, sp2By }
// input.wavBytes: raw WAV bytes (Uint8Array/ArrayBuffer) -> decoded via buildWindows.
// input.samples + input.sampleRate: pre-decoded audio (skips decodeWav).
// input.audioFirstFrameMs: passed through to framesToWindows.
// input.gpsSamples: passed through to buildMotionTrack (ACAUSAL: needs the whole GPS track).
function buildFrontEnd(input) {
  var win = input.samples != null
    ? windowsFromDecoded(input.samples, input.sampleRate, input.audioFirstFrameMs)
    : buildWindows(input.wavBytes, input.audioFirstFrameMs);
  var sp2 = S.buildMotionTrack(input.gpsSamples, win.sp1.map(function (w) { return { window_id: w.window_id, started_at_ms: w.started_at_ms }; }), {});
  var sp2By = new Map(); sp2.forEach(function (r) { sp2By.set(r.window_id, r); });
  return { samples: win.samples, sr: win.sr, sp1: win.sp1, frames: win.frames, sp2: sp2, sp2By: sp2By };
}

// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{ const exported = { buildFrontEnd, buildWindows };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); } }
