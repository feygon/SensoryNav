"use strict";

// Adversarial privacy test: actively try to smuggle raw audio and tracking
// PII into the export, and prove the whitelist projection (buildSession) plus
// the recursive detector (validateSession) prevent it.
const assert = require("assert");
const { buildSession, validateSession } = require("../recorder/session-export");

// A distinctive sentinel value so we can detect the "audio payload" even if it
// is smuggled under a renamed field.
const RAW_PCM = [13371337.5, -13371337.5];

const dirtyInput = {
  session_id: "attack",
  created_at_ms: 1000,
  calibration_status: "complete",
  baseline: {
    moving_duration_seconds: 30,
    low_median: 1, mid_median: 1, high_median: 1,
    energy_floor_min: 1e-6,
    effective_floor: { low: 1, mid: 1, high: 1, raw_audio: RAW_PCM },
    raw_audio: RAW_PCM,
    upload_url: "https://evil.example/exfil"
  },
  audio_windows: [
    {
      window_id: "w1", started_at_ms: 1000, duration_ms: 1000,
      low_energy: 1, mid_energy: 1, high_energy: 1,
      low_delta: 0, mid_delta: 0, high_delta: 0,
      auditory_roughness_score: 10,
      // raw audio smuggled under five different names + nested
      raw_audio: RAW_PCM, raw_pcm: RAW_PCM, audioBuffer: RAW_PCM,
      pcmSamples: RAW_PCM, nested: { raw_audio: RAW_PCM }
    }
  ],
  gps_samples: [
    {
      sample_id: "g1", captured_at_ms: 1000, latitude: 37.77, longitude: -122.41,
      accuracy_meters: 5, speed_mps: 10,
      // device-tracking PII
      device_id: "imei-123456789", mac_address: "00:11:22:33:44:55",
      raw_audio: RAW_PCM
    }
  ],
  located_samples: [
    {
      window_id: "w1", gps_sample_id: "g1", gps_captured_at_ms: 1000,
      location_status: "paired", latitude: 37.77, longitude: -122.41,
      auditory_roughness_score: 10, color: "#00224e",
      device_id: "imei-123456789", raw_audio: RAW_PCM
    }
  ]
};

const session = buildSession(dirtyInput);
const serialized = JSON.stringify(session);

// 1. No raw audio leaks — not the payload, nor any of the field names it was
//    smuggled under, nor a nested copy.
const bannedAudio = ["raw_audio", "raw_pcm", "audioBuffer", "pcmSamples", "13371337"];
for (const banned of bannedAudio) {
  assert.ok(!serialized.includes(banned), `export leaked raw audio via "${banned}"`);
}

// 2. No device-tracking / exfil PII leaks.
const bannedPii = ["device_id", "mac_address", "imei-123456789", "00:11:22:33:44:55", "upload_url", "evil.example"];
for (const banned of bannedPii) {
  assert.ok(!serialized.includes(banned), `export leaked PII via "${banned}"`);
}

// 3. The cleaned session still validates.
const result = validateSession(session);
assert.strictEqual(result.valid, true, JSON.stringify(result.errors));

// 4. GPS coordinates ARE intentionally present in the local export (the v0
//    privacy model is local-only / no upload; coordinates are the product).
//    This documents that "no GPS leak" is a network-layer (Plan B) guarantee,
//    not something the export schema strips.
assert.strictEqual(session.gps_samples[0].latitude, 37.77);
assert.strictEqual(session.located_samples[0].longitude, -122.41);

// 5. Defense in depth: a session loaded from disk that BYPASSES buildSession
//    and carries a literal raw_audio key is still caught by validateSession.
const loadedFromDisk = JSON.parse(serialized);
loadedFromDisk.audio_windows[0].raw_audio = RAW_PCM; // tamper after projection
const tampered = validateSession(loadedFromDisk);
assert.strictEqual(tampered.valid, false);
assert.ok(tampered.errors.some((e) => e.includes("raw_audio")), "detector missed a tampered raw_audio key");

console.log("privacy-leak tests passed");
