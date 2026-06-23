const assert = require("assert");
const { pairWindowsWithGps } = require("../recorder/sample-pairing");

const gps = [
  { sample_id: "g1", captured_at_ms: 1000, latitude: 1, longitude: 1 },
  { sample_id: "g2", captured_at_ms: 5000, latitude: 2, longitude: 2 },
  { sample_id: "g3", captured_at_ms: 5000, latitude: 3, longitude: 3 } // tie with g2
];

const windows = [
  { window_id: "w1", started_at_ms: 1200, auditory_roughness_score: 10 }, // -> g1
  { window_id: "w2", started_at_ms: 5000, auditory_roughness_score: 80 }, // tie -> earlier g2
  { window_id: "w3", started_at_ms: 20000, auditory_roughness_score: 50 } // no GPS within 5s
];

const located = pairWindowsWithGps(windows, gps, 5);

assert.strictEqual(located[0].gps_sample_id, "g1");
assert.strictEqual(located[0].location_status, "paired");
assert.strictEqual(located[0].gps_captured_at_ms, 1000);
assert.ok(/^#[0-9a-f]{6}$/.test(located[0].color));

assert.strictEqual(located[1].gps_sample_id, "g2"); // earlier of the tie
assert.strictEqual(located[1].latitude, 2);

assert.strictEqual(located[2].location_status, "missing");
assert.strictEqual(located[2].gps_sample_id, null);
assert.strictEqual(located[2].latitude, null);

// One GPS sample can pair with multiple windows.
const reuse = pairWindowsWithGps(
  [
    { window_id: "a", started_at_ms: 1000, auditory_roughness_score: 0 },
    { window_id: "b", started_at_ms: 1100, auditory_roughness_score: 0 }
  ],
  [{ sample_id: "only", captured_at_ms: 1050, latitude: 9, longitude: 9 }],
  5
);
assert.strictEqual(reuse[0].gps_sample_id, "only");
assert.strictEqual(reuse[1].gps_sample_id, "only");

console.log("sample-pairing tests passed");
