// recorder/capture-manifest.js
"use strict";

const SCHEMA = "sensorynav-capture-v1";

function buildManifest(input) {
  return {
    schema: SCHEMA,
    pass_label: input.pass_label,
    recording_start_ms: input.recording_start_ms,
    audio_first_frame_ms: input.audio_first_frame_ms,
    duration_ms: Math.round((input.total_samples / input.sample_rate) * 1000),
    partial: input.partial || false,
    truncation_reason: input.truncation_reason || null,
    notes: input.notes || "",
    audio: {
      wav_filename: input.wav_filename,
      sample_rate: input.sample_rate,
      channels: 1,
      bit_depth: 16
    },
    audio_settings_requested: input.audio_settings_requested,
    audio_settings_applied: input.audio_settings_applied,
    device: { user_agent: input.user_agent || null },
    gps: {
      enable_high_accuracy: true,
      fix_count: input.gps_samples.length,
      observed_fix_hz: input.observed_fix_hz === undefined ? null : input.observed_fix_hz
    },
    gps_samples: input.gps_samples
  };
}

const exported = { buildManifest, SCHEMA };
if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
if (typeof window !== "undefined") { window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported); }
