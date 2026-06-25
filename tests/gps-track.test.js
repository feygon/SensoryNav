// tests/gps-track.test.js
const assert = require("assert");
const { normalizeFix, observedFixHz } = require("../recorder/gps-track");

const fix = normalizeFix({
  timestamp: 1000,
  coords: { latitude: 45.5, longitude: -122.6, speed: 12.3, accuracy: 5 }
}, "g1");
assert.deepStrictEqual(fix, {
  sample_id: "g1",
  captured_at_ms: 1000,
  latitude: 45.5,
  longitude: -122.6,
  speed_mps: 12.3,
  accuracy_meters: 5
});

// null speed is preserved as null (not coerced to 0).
const noSpeed = normalizeFix({
  timestamp: 2000,
  coords: { latitude: 1, longitude: 2, speed: null, accuracy: 9 }
}, "g2");
assert.strictEqual(noSpeed.speed_mps, null);

assert.strictEqual(observedFixHz([]), null);
assert.strictEqual(observedFixHz([{ captured_at_ms: 1000 }]), null);
// 5 samples spanning 4000ms -> 4 intervals / 4s = 1 Hz
const samples = [0, 1000, 2000, 3000, 4000].map((t) => ({ captured_at_ms: t }));
assert.strictEqual(observedFixHz(samples), 1);

console.log("gps-track tests passed");
