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
  if (sidecar.sample_rate !== undefined && sidecar.sample_rate !== decoded.sampleRate) {
    warnings.push(
      `sample_rate mismatch: WAV ${decoded.sampleRate} vs sidecar ${sidecar.sample_rate}`
    );
  }
  const windows = framesToWindows(decoded.samples, decoded.sampleRate, sidecar.audio_first_frame_ms);
  return { windows, sampleRate: decoded.sampleRate, warnings };
}

module.exports = { loadPass };
