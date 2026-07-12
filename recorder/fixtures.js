"use strict";

const { pairWindowsWithGps } = require("./sample-pairing");
const { buildSession } = require("./session-export");

function buildFixtureSession() {
  const startMs = Date.UTC(2026, 0, 1, 12, 0, 0);
  const windowCount = 36;
  const audioWindows = [];
  const gpsSamples = [];

  for (let i = 0; i < windowCount; i++) {
    const startedAtMs = startMs + i * 1000;
    // Sweep scores 0..99 across the trip so all three tiers appear.
    const score = Math.round((i / (windowCount - 1)) * 99);
    audioWindows.push({
      window_id: `w${i}`,
      started_at_ms: startedAtMs,
      duration_ms: 1000,
      low_energy: 1 + i,
      mid_energy: 1 + i,
      high_energy: 1 + i,
      low_delta: i / windowCount,
      mid_delta: i / windowCount,
      high_delta: i / windowCount,
      auditory_roughness_score: score
    });
    gpsSamples.push({
      sample_id: `g${i}`,
      captured_at_ms: startedAtMs,
      latitude: 37.7749 + i * 0.0005,
      longitude: -122.4194 + i * 0.0005,
      accuracy_meters: 5,
      speed_mps: 12
    });
  }

  const locatedSamples = pairWindowsWithGps(audioWindows, gpsSamples, 5);

  return buildSession({
    session_id: "fixture-session",
    created_at_ms: startMs,
    calibration_status: "complete",
    baseline: {
      moving_duration_seconds: 30,
      low_median: 5, mid_median: 5, high_median: 5,
      energy_floor_min: 1e-6,
      effective_floor: { low: 5, mid: 5, high: 5 }
    },
    audio_windows: audioWindows,
    gps_samples: gpsSamples,
    located_samples: locatedSamples,
    user_agent: "fixture"
  });
}

const exported = { buildFixtureSession };

if (typeof module !== "undefined" && module.exports) {
  module.exports = exported;
}
if (typeof window !== "undefined") {
  window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported);
}
