// scripts/make-fixture-pass.js — one-off. Trims a real pass down to a small, committable clip and
// regenerates its golden. Run: node scripts/make-fixture-pass.js <src-sidecar.json> [keepSec]
"use strict";
const fs = require("fs");
const path = require("path");
const { decodeWav } = require("../harness/audio/wav-decoder.js");
const { encodeWav } = require("../recorder/wav-encoder.js");
const { trimCapture } = require("../recorder/trim-capture.js");

const srcJson = process.argv[2];
const keepSec = Number(process.argv[3] || 5);
if (!srcJson) { console.error("usage: make-fixture-pass.js <sidecar.json> [keepSec]"); process.exit(1); }

const sidecar = JSON.parse(fs.readFileSync(srcJson, "utf8"));
const srcWav = path.join(path.dirname(srcJson), sidecar.audio.wav_filename);
const { samples, sampleRate } = decodeWav(fs.readFileSync(srcWav));
const total = samples.length;
const dropLastSec = Math.max(0, total / sampleRate - keepSec);

const trimmed = trimCapture(
  { frames: [samples], totalSamples: total, sampleRate,
    recordingStartMs: sidecar.recording_start_ms, audioFirstFrameMs: sidecar.audio_first_frame_ms,
    gpsSamples: sidecar.gps_samples },
  { dropLastSec });
if (!trimmed) { console.error("keepSec too small — nothing remains"); process.exit(1); }

const outDir = path.join(__dirname, "..", "data", "fixtures");
fs.mkdirSync(outDir, { recursive: true });
// encodeWav consumes+nulls trimmed.frames[*] as it writes (throwaway-buffer optimization),
// so it can only be called once — capture the encoded bytes and reuse them for the size log.
const wavBytes = Buffer.from(encodeWav(trimmed.frames, trimmed.totalSamples, sampleRate));
fs.writeFileSync(path.join(outDir, "test-pass-1.wav"), wavBytes);
const newSidecar = Object.assign({}, sidecar, {
  pass_label: "test-pass-1",
  duration_ms: (trimmed.totalSamples / sampleRate) * 1000,
  audio: Object.assign({}, sidecar.audio, { wav_filename: "test-pass-1.wav" }),
  gps_samples: trimmed.gpsSamples
});
fs.writeFileSync(path.join(outDir, "test-pass-1.json"), JSON.stringify(newSidecar, null, 2));
console.log("wrote data/fixtures/test-pass-1.{wav,json} —", (trimmed.totalSamples / sampleRate).toFixed(1), "s,",
  (wavBytes.length / 1e6).toFixed(2), "MB");
