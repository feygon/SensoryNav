"use strict";
const assert = require("assert");
const { framesToWindows, windowIndexFor } = require("../harness/audio/audio-windows");

const SR = 48000;
function tone(freq, durationS) {
  const n = Math.round(durationS * SR);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.sin((2 * Math.PI * freq * i) / SR);
  return s;
}

// windowIndexFor is parameterized by samplesPerWindow (not hardcoded to seconds).
assert.strictEqual(windowIndexFor(0, 100), 0);
assert.strictEqual(windowIndexFor(99, 100), 0);
assert.strictEqual(windowIndexFor(100, 100), 1);
assert.strictEqual(windowIndexFor(250, 100), 2);

// 2 s mid-tone -> exactly 2 windows, mid dominates, timestamps anchored, frames present.
const w = framesToWindows(tone(500, 2), SR, 1000);
assert.strictEqual(w.length, 2);
assert.strictEqual(w[0].window_id, "w0");
assert.strictEqual(w[1].window_id, "w1");
assert.strictEqual(w[0].started_at_ms, 1000);
assert.strictEqual(w[1].started_at_ms, 2000);
assert.strictEqual(w[0].duration_ms, 1000);
assert.ok(w[0].frame_count > 0 && w[1].frame_count > 0);
assert.ok(w[0].mid_energy > w[0].low_energy * 10 && w[0].mid_energy > w[0].high_energy * 10);

// Silence -> near_floor, rms 0.
const sil = framesToWindows(new Float32Array(2 * SR), SR, 0);
assert.strictEqual(sil.length, 2);
assert.strictEqual(sil[0].near_floor, true);
assert.strictEqual(sil[0].rms, 0);

// Full-scale constant -> clip_fraction 1, rms 1.
const clip = framesToWindows(new Float32Array(2 * SR).fill(1), SR, 0);
assert.strictEqual(clip[0].clip_fraction, 1);
assert.ok(Math.abs(clip[0].rms - 1) < 1e-9);

// 2.4 s -> trailing 0.4 s dropped (< 0.5 s) -> 2 windows.
assert.strictEqual(framesToWindows(tone(500, 2.4), SR, 0).length, 2);

// 2.6 s -> 2 full + 1 kept partial, duration_ms exactly 600.
const part = framesToWindows(tone(500, 2.6), SR, 0);
assert.strictEqual(part.length, 3);
assert.strictEqual(part[2].duration_ms, 600);
assert.ok(part[2].frame_count > 0);

// Sub-frame audio -> empty array.
assert.strictEqual(framesToWindows(new Float32Array(1000), SR, 0).length, 0);

// Contiguity: window_id sequence is w0,w1,... with no gaps.
for (let i = 0; i < part.length; i++) assert.strictEqual(part[i].window_id, "w" + i);

console.log("audio-windows tests passed");
