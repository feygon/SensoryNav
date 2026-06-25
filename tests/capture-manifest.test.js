// tests/capture-manifest.test.js
const assert = require("assert");
const { buildManifest } = require("../recorder/capture-manifest");

const base = {
  pass_label: "johnson-creek-pass-1-153007",
  wav_filename: "johnson-creek-pass-1-153007.wav",
  recording_start_ms: 1000,
  audio_first_frame_ms: 1080,
  total_samples: 96000,
  sample_rate: 48000,
  notes: "dry, ~35mph",
  audio_settings_requested: { autoGainControl: false, noiseSuppression: false, echoCancellation: false },
  audio_settings_applied: { autoGainControl: false, noiseSuppression: false, echoCancellation: false },
  user_agent: "test-agent",
  gps_samples: [
    { sample_id: "g1", captured_at_ms: 1000, latitude: 1, longitude: 2, speed_mps: 10, accuracy_meters: 5 },
    { sample_id: "g2", captured_at_ms: 3000, latitude: 1, longitude: 2, speed_mps: 11, accuracy_meters: 5 }
  ],
  observed_fix_hz: 0.5
};

const clean = buildManifest(base);
assert.strictEqual(clean.schema, "sensorynav-capture-v1");
assert.strictEqual(clean.duration_ms, 2000); // 96000/48000*1000
assert.strictEqual(clean.partial, false);
assert.strictEqual(clean.truncation_reason, null);
assert.strictEqual(clean.audio.wav_filename, "johnson-creek-pass-1-153007.wav");
assert.strictEqual(clean.audio.sample_rate, 48000);
assert.strictEqual(clean.audio.channels, 1);
assert.strictEqual(clean.audio.bit_depth, 16);
assert.deepStrictEqual(clean.audio_settings_applied, base.audio_settings_applied);
assert.strictEqual(clean.gps.fix_count, 2);
assert.strictEqual(clean.gps.observed_fix_hz, 0.5);
assert.strictEqual(clean.gps.enable_high_accuracy, true);
assert.deepStrictEqual(clean.gps_samples, base.gps_samples); // embedded unchanged

// Truncated pass carries the flags.
const truncated = buildManifest(Object.assign({}, base, { partial: true, truncation_reason: "gps_lost" }));
assert.strictEqual(truncated.partial, true);
assert.strictEqual(truncated.truncation_reason, "gps_lost");

console.log("capture-manifest tests passed");
