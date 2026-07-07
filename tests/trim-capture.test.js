"use strict";
const assert = require("assert");
const { trimCapture } = require("../recorder/trim-capture");

const SR = 1000; // small rate keeps the test light; trim logic is rate-agnostic
const T0 = 1_000_000; // audio_first_frame_ms (epoch ms anchor)

// one audio frame of `n` samples where sample value == its index, so trimming is detectable
function frame(n) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; }
// `count` GPS fixes, one per second, starting at T0
function gps(count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push({ sample_id: "g" + i, captured_at_ms: T0 + i * 1000, latitude: 45 + i * 1e-4, longitude: -122, speed_mps: 5, accuracy_meters: 3 });
  return out;
}
function base() {
  return { frames: [frame(100 * SR)], totalSamples: 100 * SR, sampleRate: SR, recordingStartMs: T0 - 500, audioFirstFrameMs: T0, gpsSamples: gps(100) };
}

// --- remove first 30 s ---
let r = trimCapture(base(), { dropFirstSec: 30, dropLastSec: 0 });
assert.strictEqual(r.totalSamples, 70 * SR, "first-trim: 70 s of samples remain");
assert.strictEqual(r.audioFirstFrameMs, T0 + 30000, "first-trim: audio start shifted +30 s");
assert.strictEqual(r.frames[0][0], 30 * SR, "first-trim: first kept sample is the old 30 s mark");
assert.strictEqual(r.gpsSamples.length, 70, "first-trim: fixes 0..29 dropped, 30..99 kept");
assert.strictEqual(r.gpsSamples[0].captured_at_ms, T0 + 30000, "first-trim: first kept fix at 30 s (inclusive)");

// --- remove last 30 s ---
let r2 = trimCapture(base(), { dropFirstSec: 0, dropLastSec: 30 });
assert.strictEqual(r2.totalSamples, 70 * SR, "last-trim: 70 s remain");
assert.strictEqual(r2.audioFirstFrameMs, T0, "last-trim: audio start unchanged");
assert.strictEqual(r2.frames[0][0], 0, "last-trim: keeps from the very start");
assert.strictEqual(r2.gpsSamples.length, 70, "last-trim: last 30 fixes dropped");
assert.strictEqual(r2.gpsSamples[r2.gpsSamples.length - 1].captured_at_ms, T0 + 69000, "last-trim: last kept fix at 69 s (70 s boundary exclusive)");

// --- both ---
let r3 = trimCapture(base(), { dropFirstSec: 30, dropLastSec: 30 });
assert.strictEqual(r3.totalSamples, 40 * SR, "both-trim: 40 s remain");
assert.strictEqual(r3.gpsSamples.length, 40, "both-trim: fixes 30..69 kept");
assert.strictEqual(r3.gpsSamples[0].captured_at_ms, T0 + 30000);
assert.strictEqual(r3.gpsSamples[39].captured_at_ms, T0 + 69000);

// --- too short: requested trim would leave nothing -> null (caller must warn + not save) ---
const short = { frames: [frame(20 * SR)], totalSamples: 20 * SR, sampleRate: SR, recordingStartMs: T0, audioFirstFrameMs: T0, gpsSamples: gps(20) };
assert.strictEqual(trimCapture(short, { dropFirstSec: 30, dropLastSec: 0 }), null, "shorter than trim -> null");
assert.strictEqual(trimCapture(short, { dropFirstSec: 15, dropLastSec: 15 }), null, "both trims consume everything -> null");

console.log("trim-capture tests passed");
