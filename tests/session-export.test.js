const assert = require("assert");
const { buildSession, validateSession } = require("../recorder/session-export");

const session = buildSession({
  session_id: "s1",
  created_at_ms: 1000,
  calibration_status: "complete",
  baseline: {
    moving_duration_seconds: 30,
    low_median: 1, mid_median: 1, high_median: 1,
    energy_floor_min: 1e-6,
    effective_floor: { low: 1, mid: 1, high: 1 }
  },
  audio_windows: [
    { window_id: "w1", started_at_ms: 1000, duration_ms: 1000, low_energy: 1, mid_energy: 1, high_energy: 1, low_delta: 0, mid_delta: 0, high_delta: 0, auditory_roughness_score: 0 }
  ],
  gps_samples: [
    { sample_id: "g1", captured_at_ms: 1000, latitude: 1, longitude: 1, accuracy_meters: 5, speed_mps: 10 }
  ],
  located_samples: [
    { window_id: "w1", gps_sample_id: "g1", gps_captured_at_ms: 1000, location_status: "paired", latitude: 1, longitude: 1, auditory_roughness_score: 0, color: "#00224e" }
  ],
  user_agent: "test-agent"
});

assert.strictEqual(session.score_formula_version, "auditory-roughness-v0");
assert.strictEqual(session.created_at, new Date(1000).toISOString());
assert.ok(!JSON.stringify(session).includes("raw_audio"));

const ok = validateSession(session);
assert.strictEqual(ok.valid, true, JSON.stringify(ok.errors));

// Missing required field is rejected.
const broken = JSON.parse(JSON.stringify(session));
delete broken.session_id;
const bad = validateSession(broken);
assert.strictEqual(bad.valid, false);
assert.ok(bad.errors.some((e) => e.includes("session_id")));

// A stray raw_audio key is rejected.
const leaked = JSON.parse(JSON.stringify(session));
leaked.audio_windows[0].raw_audio = [0.1, 0.2];
const leak = validateSession(leaked);
assert.strictEqual(leak.valid, false);
assert.ok(leak.errors.some((e) => e.includes("raw_audio")));

console.log("session-export tests passed");
