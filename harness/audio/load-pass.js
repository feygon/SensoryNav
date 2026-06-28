// harness/audio/load-pass.js
"use strict";
const fs = require("fs");
const { decodeWav } = require("./wav-decoder");
const { framesToWindows } = require("./audio-windows");

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
  const windows = framesToWindows(decoded.samples, decoded.sampleRate, sidecar.audio_first_frame_ms);
  return { windows, sampleRate: decoded.sampleRate, warnings };
}

module.exports = { loadPass };
