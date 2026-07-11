// harness/audio/load-pass.js
// Batch driver: reads a pass's WAV + sidecar JSON from disk and turns them into SP1 windows.
// @unit-begin
// unit:        load-pass
// causality:   acausal
// state:       none
// mutates:     io:fs
// contract:    loadPass(wavPath,sidecarPath) -> {windows,sampleRate,warnings}
//              windowsFromSamples(samples,sampleRate,audioFirstFrameMs) -> windows[]
// deps:        audio/wav-decoder, audio/audio-windows
// realtime:    batch-only
// tested-by:   tests/load-pass.test.js
// @unit-end
"use strict";
const fs = require("fs");
const { decodeWav } = require("./wav-decoder");
const { framesToWindows } = require("./audio-windows");

// Pure: turns decoded samples into scored windows. No file I/O, so a Worker
// (fed samples decoded via Web Audio) can call this directly.
function windowsFromSamples(samples, sampleRate, audioFirstFrameMs) {
  return framesToWindows(samples, sampleRate, audioFirstFrameMs);
}

function loadPass(wavPath, sidecarPath) {
  const bytes = fs.readFileSync(wavPath);
  const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
  const decoded = decodeWav(bytes);
  const warnings = [];
  const sidecarRate = sidecar.audio && sidecar.audio.sample_rate !== undefined
    ? sidecar.audio.sample_rate
    : sidecar.sample_rate;
  if (sidecarRate !== undefined && sidecarRate !== decoded.sampleRate) {
    warnings.push(`sample_rate mismatch: WAV ${decoded.sampleRate} vs sidecar ${sidecarRate}`);
  }
  const windows = windowsFromSamples(decoded.samples, decoded.sampleRate, sidecar.audio_first_frame_ms);
  return { windows, sampleRate: decoded.sampleRate, warnings };
}

// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { loadPass, windowsFromSamples };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
