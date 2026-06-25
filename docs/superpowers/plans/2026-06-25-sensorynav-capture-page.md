# SensoryNav Capture Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone browser page that records lossless raw audio + high-accuracy GPS during a drive and exports two files per pass (`.wav` + `.json` sidecar) for the offline scoring harness.

**Architecture:** Four pure, node-tested modules (WAV encoder, GPS normalizer, state machine, manifest builder) plus three browser-glue files (an AudioWorklet processor, an orchestrator, and the page). The pure modules use the repo's dual CommonJS/`window.SensoryNavCore` export pattern; the glue is verified by an on-device manual checklist. Recording uses AudioWorklet → raw Float32 PCM → 16-bit WAV (never MediaRecorder).

**Tech Stack:** Vanilla JS, no build, no dependencies. Node `assert` test scripts. Web Audio (AudioWorklet), Geolocation, Screen Wake Lock, Page Visibility.

**Spec:** `docs/superpowers/specs/2026-06-24-sensorynav-capture-page-design.md` (READY, 40/45).

## Global Constraints

Copied verbatim from the spec; every task implicitly includes these.

- **No dependencies.** Vanilla JS only. Web Audio / Geolocation / Wake Lock / Page Visibility are built-in.
- **Lossless audio.** Raw PCM → 16-bit PCM WAV. MediaRecorder (compressed) is forbidden.
- **Mic processing OFF.** `getUserMedia` audio constraints: `autoGainControl:false, noiseSuppression:false, echoCancellation:false`. Read the *actual* applied settings via `MediaStreamTrack.getSettings()` and record them in the sidecar; warn visibly if the device ignored the request.
- **One clock.** All timestamps are epoch milliseconds (`Date.now()` / `Position.timestamp`). `recording_start_ms` is stamped at start; `audio_first_frame_ms` at the first worklet frame; each GPS sample carries `captured_at_ms`.
- **WAV header** (little-endian; `dataSize = totalSamples*2`, mono): `RIFF`/`ChunkSize=36+dataSize`/`WAVE`/`fmt `/`Subchunk1Size=16`/`AudioFormat=1`/`NumChannels=1`/`SampleRate`/`ByteRate=SampleRate*2`/`BlockAlign=2`/`BitsPerSample=16`/`data`/`Subchunk2Size=dataSize`/payload. Total length `44 + dataSize`.
- **Float32→int16:** `s = max(-1,min(1,x)); int16 = round(s < 0 ? s*0x8000 : s*0x7FFF)`. So `1.0→32767, -1.0→-32768, 0.5→16384, -0.5→-16384, 0→0`.
- **`duration_ms` = `round(totalSamples / sample_rate * 1000)`** (audio-derived; excludes the spin-up offset, which lives in `audio_first_frame_ms`).
- **`observed_fix_hz` = `(n-1) / ((last_ms - first_ms)/1000)`** for `n≥2` samples, else `null`.
- **Filenames:** `pass_label = <base>-<HHMMSS>` (local time at start), shared by both files; `audio.wav_filename` matches the WAV name exactly.
- **`schema: "sensorynav-capture-v1"`.** GPS sample shape matches the scoring core exactly: `sample_id, captured_at_ms, latitude, longitude, speed_mps, accuracy_meters`.
- **Foreground-only.** Acquire Screen Wake Lock while recording; warn on Page Visibility hidden.
- **Secure context.** getUserMedia/geolocation require HTTPS (GitHub Pages) or localhost.
- **Function size:** ~100 lines/function target, 300 hard limit.
- **Module export pattern (pure modules):**

```javascript
const exported = { /* names */ };
if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
if (typeof window !== "undefined") { window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported); }
```

- **Dark theme.** Reuse `theme.js`; large glanceable one-handed Start/Stop targets.

---

## File Structure

- Create: `recorder/wav-encoder.js` — Float32 frames → 16-bit WAV `Uint8Array`.
- Create: `recorder/gps-track.js` — normalize a `GeolocationPosition`; compute `observed_fix_hz`.
- Create: `recorder/capture-state.js` — pure recording state machine (`nextState`).
- Create: `recorder/capture-manifest.js` — build the JSON sidecar object.
- Create: `capture-worklet.js` — AudioWorklet processor (forwards PCM frames + RMS).
- Create: `capture.js` — orchestrator (permissions, capture, GPS, Wake Lock, visibility, state, export).
- Create: `capture.html` — the page; wires `theme.js` + the pure modules + `capture.js`.
- Test: `tests/wav-encoder.test.js`, `tests/gps-track.test.js`, `tests/capture-state.test.js`, `tests/capture-manifest.test.js`.
- Modify: `package.json` — append each test to the `test` script.

## Orchestration (static delegation calculus — Planner Pass 2)

| Tasks | Delegation | Model | Bloat | Must-inline | Tier-2 |
|---|---|---|---|---|---|
| 1-4 (pure modules) | `subagent` | `sonnet` (user rule: never haiku for code) | low | no | no |
| 5-7 (browser glue) | `subagent` | `sonnet` | low | no | no |

Sequential (each task appends to `package.json`; glue tasks share/serialize). **Verification differs:** tasks 1-4 end with green node tests; tasks 5-7 produce code reviewed for correctness, then the **user runs the on-device manual checklist on the A16** (a subagent cannot drive the phone). Checkpoint: after Task 4 (`npm test`) and after Task 7 (user device test).

---

### Task 1: WAV encoder

**Files:**
- Create: `recorder/wav-encoder.js`
- Test: `tests/wav-encoder.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `floatTo16BitPCM(sample)` → integer in [-32768, 32767].
  - `encodeWav(frames, totalSamples, sampleRate)` → `Uint8Array` (full WAV). `frames` is an array of `Float32Array`; the encoder nulls each slot after consuming it (documented in-place release; output is a pure function of the input samples).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/wav-encoder.test.js
const assert = require("assert");
const { encodeWav, floatTo16BitPCM } = require("../recorder/wav-encoder");

// Conversion rule (exact, asymmetric).
assert.strictEqual(floatTo16BitPCM(1.0), 32767);
assert.strictEqual(floatTo16BitPCM(-1.0), -32768);
assert.strictEqual(floatTo16BitPCM(0.5), 16384);
assert.strictEqual(floatTo16BitPCM(-0.5), -16384);
assert.strictEqual(floatTo16BitPCM(0), 0);
assert.strictEqual(floatTo16BitPCM(1.5), 32767);   // clamp
assert.strictEqual(floatTo16BitPCM(-1.5), -32768); // clamp

function check(sampleRate) {
  const frames = [Float32Array.from([0, 0.5]), Float32Array.from([-0.5, -1.0])];
  const totalSamples = 4;
  const wav = encodeWav(frames, totalSamples, sampleRate);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (off) => String.fromCharCode(wav[off], wav[off + 1], wav[off + 2], wav[off + 3]);
  const dataSize = totalSamples * 2;

  assert.strictEqual(ascii(0), "RIFF");
  assert.strictEqual(view.getUint32(4, true), 36 + dataSize); // ChunkSize
  assert.strictEqual(ascii(8), "WAVE");
  assert.strictEqual(ascii(12), "fmt ");
  assert.strictEqual(view.getUint32(16, true), 16);           // Subchunk1Size
  assert.strictEqual(view.getUint16(20, true), 1);            // AudioFormat PCM
  assert.strictEqual(view.getUint16(22, true), 1);            // NumChannels
  assert.strictEqual(view.getUint32(24, true), sampleRate);   // SampleRate
  assert.strictEqual(view.getUint32(28, true), sampleRate * 2); // ByteRate
  assert.strictEqual(view.getUint16(32, true), 2);            // BlockAlign
  assert.strictEqual(view.getUint16(34, true), 16);           // BitsPerSample
  assert.strictEqual(ascii(36), "data");
  assert.strictEqual(view.getUint32(40, true), dataSize);     // Subchunk2Size
  assert.strictEqual(wav.byteLength, 44 + dataSize);
  // Payload values (LE int16) for samples [0, 0.5, -0.5, -1.0].
  assert.strictEqual(view.getInt16(44, true), 0);
  assert.strictEqual(view.getInt16(46, true), 16384);
  assert.strictEqual(view.getInt16(48, true), -16384);
  assert.strictEqual(view.getInt16(50, true), -32768);
}
check(48000);
check(44100); // parametrized over sample rates

console.log("wav-encoder tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/wav-encoder.test.js`
Expected: FAIL with "Cannot find module '../recorder/wav-encoder'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// recorder/wav-encoder.js
"use strict";

function floatTo16BitPCM(sample) {
  const s = Math.max(-1, Math.min(1, sample));
  return Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function encodeWav(frames, totalSamples, sampleRate) {
  const numChannels = 1;
  const bytesPerSample = 2;
  const dataSize = totalSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let f = 0; f < frames.length; f++) {
    const frame = frames[f];
    for (let i = 0; i < frame.length; i++) {
      view.setInt16(offset, floatTo16BitPCM(frame[i]), true);
      offset += 2;
    }
    frames[f] = null; // release as consumed (frames array is throwaway)
  }

  return new Uint8Array(buffer);
}

const exported = { encodeWav, floatTo16BitPCM };
if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
if (typeof window !== "undefined") { window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/wav-encoder.test.js`
Expected: PASS, prints "wav-encoder tests passed".

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/wav-encoder.test.js` to the `test` script.

- [ ] **Step 6: Commit**

```bash
git add recorder/wav-encoder.js tests/wav-encoder.test.js package.json
git commit -m "feat(capture): add WAV encoder"
```

---

### Task 2: GPS track normalizer

**Files:**
- Create: `recorder/gps-track.js`
- Test: `tests/gps-track.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `normalizeFix(position, sampleId)` → `{ sample_id, captured_at_ms, latitude, longitude, speed_mps, accuracy_meters }`. `position` is a `GeolocationPosition`. `speed` null/undefined → `speed_mps: null`.
  - `observedFixHz(samples)` → number, or `null` when fewer than 2 samples or non-positive span.

- [ ] **Step 1: Write the failing test**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/gps-track.test.js`
Expected: FAIL with "Cannot find module '../recorder/gps-track'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// recorder/gps-track.js
"use strict";

function normalizeFix(position, sampleId) {
  const c = position.coords;
  return {
    sample_id: sampleId,
    captured_at_ms: position.timestamp,
    latitude: c.latitude,
    longitude: c.longitude,
    speed_mps: (c.speed === null || c.speed === undefined) ? null : c.speed,
    accuracy_meters: c.accuracy
  };
}

function observedFixHz(samples) {
  if (samples.length < 2) {
    return null;
  }
  const first = samples[0].captured_at_ms;
  const last = samples[samples.length - 1].captured_at_ms;
  const seconds = (last - first) / 1000;
  if (seconds <= 0) {
    return null;
  }
  return (samples.length - 1) / seconds;
}

const exported = { normalizeFix, observedFixHz };
if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
if (typeof window !== "undefined") { window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/gps-track.test.js`
Expected: PASS, prints "gps-track tests passed".

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/gps-track.test.js` to the `test` script.

- [ ] **Step 6: Commit**

```bash
git add recorder/gps-track.js tests/gps-track.test.js package.json
git commit -m "feat(capture): add GPS track normalizer"
```

---

### Task 3: Recording state machine

**Files:**
- Create: `recorder/capture-state.js`
- Test: `tests/capture-state.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `nextState(current, event)` → next state string, or `null` for an illegal transition. States: `idle`, `requesting_permissions`, `recording`, `stopped`, `error`. Events: `start`, `granted`, `denied`, `foreground_lost`, `stream_lost`, `stop`, `reset`. `foreground_lost` from `recording` returns `recording` (unchanged — the warning is a glue side effect).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/capture-state.test.js
const assert = require("assert");
const { nextState } = require("../recorder/capture-state");

assert.strictEqual(nextState("idle", "start"), "requesting_permissions");
assert.strictEqual(nextState("requesting_permissions", "granted"), "recording");
assert.strictEqual(nextState("requesting_permissions", "denied"), "error");
assert.strictEqual(nextState("recording", "stop"), "stopped");
assert.strictEqual(nextState("recording", "stream_lost"), "error");
assert.strictEqual(nextState("recording", "foreground_lost"), "recording");
assert.strictEqual(nextState("stopped", "reset"), "idle");
assert.strictEqual(nextState("error", "reset"), "idle");

// Illegal transitions return null.
assert.strictEqual(nextState("idle", "stop"), null);
assert.strictEqual(nextState("recording", "start"), null);
assert.strictEqual(nextState("stopped", "stream_lost"), null);

console.log("capture-state tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/capture-state.test.js`
Expected: FAIL with "Cannot find module '../recorder/capture-state'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// recorder/capture-state.js
"use strict";

const TRANSITIONS = {
  idle: { start: "requesting_permissions" },
  requesting_permissions: { granted: "recording", denied: "error" },
  recording: { foreground_lost: "recording", stream_lost: "error", stop: "stopped" },
  stopped: { reset: "idle" },
  error: { reset: "idle" }
};

function nextState(current, event) {
  const row = TRANSITIONS[current];
  if (!row || !(event in row)) {
    return null;
  }
  return row[event];
}

const exported = { nextState };
if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
if (typeof window !== "undefined") { window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/capture-state.test.js`
Expected: PASS, prints "capture-state tests passed".

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/capture-state.test.js` to the `test` script.

- [ ] **Step 6: Commit**

```bash
git add recorder/capture-state.js tests/capture-state.test.js package.json
git commit -m "feat(capture): add recording state machine"
```

---

### Task 4: Manifest builder

**Files:**
- Create: `recorder/capture-manifest.js`
- Test: `tests/capture-manifest.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `observedFixHz` (Task 2) — but to stay browser-safe and decoupled, the **caller passes `observed_fix_hz` in**; this module does not require gps-track.
- Produces: `buildManifest(input)` → the sidecar object. `input`: `{ pass_label, wav_filename, recording_start_ms, audio_first_frame_ms, total_samples, sample_rate, partial, truncation_reason, notes, audio_settings_requested, audio_settings_applied, user_agent, gps_samples, observed_fix_hz }`. `duration_ms = round(total_samples / sample_rate * 1000)`; `gps.fix_count = gps_samples.length`.

- [ ] **Step 1: Write the failing test**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/capture-manifest.test.js`
Expected: FAIL with "Cannot find module '../recorder/capture-manifest'".

- [ ] **Step 3: Write minimal implementation**

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/capture-manifest.test.js`
Expected: PASS, prints "capture-manifest tests passed".

- [ ] **Step 5: Wire into package.json and run the full suite**

Append ` && node tests/capture-manifest.test.js` to the `test` script, then run `npm test`. Expected: every prior "… passed" line prints, no error.

- [ ] **Step 6: Commit**

```bash
git add recorder/capture-manifest.js tests/capture-manifest.test.js package.json
git commit -m "feat(capture): add manifest builder"
```

---

### Task 5: AudioWorklet processor

**Files:**
- Create: `capture-worklet.js`

**Interfaces:**
- Produces: a registered AudioWorklet processor named `capture-processor` that, per render quantum, copies the mono input frame and posts `{ frame: Float32Array, rms: number }` to the main thread, transferring the frame's buffer.

This is browser-only (no node test). Verification is on-device (Task 7 checklist: the level bar moves and audio records).

- [ ] **Step 1: Write the processor**

```javascript
// capture-worklet.js
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channel = input[0]; // Float32Array, engine-owned (reused) — copy it
      const frame = new Float32Array(channel.length);
      frame.set(channel);
      let sumSquares = 0;
      for (let i = 0; i < frame.length; i++) {
        sumSquares += frame[i] * frame[i];
      }
      const rms = Math.sqrt(sumSquares / frame.length);
      this.port.postMessage({ frame, rms }, [frame.buffer]);
    }
    return true; // keep processor alive
  }
}
registerProcessor("capture-processor", CaptureProcessor);
```

- [ ] **Step 2: Commit**

```bash
git add capture-worklet.js
git commit -m "feat(capture): add AudioWorklet PCM processor"
```

---

### Task 6: Orchestrator

**Files:**
- Create: `capture.js`

**Interfaces:**
- Consumes (via `window.SensoryNavCore`, loaded by `capture.html` before this file): `encodeWav`, `normalizeFix`, `observedFixHz`, `nextState`, `buildManifest`.
- Produces: `window.SensoryNavCapture.init()` — wires DOM controls; owns the state machine and all Web-API lifecycles. Decomposed into the named functions from the spec.

Browser-only; verified on-device (Task 7). Reviewers check correctness against the spec's data flow, constraints, and state machine.

- [ ] **Step 1: Write the orchestrator**

```javascript
// capture.js
(function () {
  "use strict";
  const core = window.SensoryNavCore;

  const state = {
    name: "idle",
    frames: [],
    totalSamples: 0,
    sampleRate: 0,
    gpsSamples: [],
    gpsCounter: 0,
    recordingStartMs: 0,
    audioFirstFrameMs: 0,
    audioContext: null,
    workletNode: null,
    mediaStream: null,
    geoWatchId: null,
    wakeLock: null,
    appliedSettings: null,
    baseLabel: "johnson-creek-pass-1"
  };

  let ui = {};

  function init() {
    ui = {
      start: document.getElementById("start"),
      stop: document.getElementById("stop"),
      status: document.getElementById("status"),
      level: document.getElementById("level"),
      gps: document.getElementById("gps"),
      notes: document.getElementById("notes"),
      label: document.getElementById("label"),
      warning: document.getElementById("warning")
    };
    ui.start.addEventListener("click", onStart);
    ui.stop.addEventListener("click", onStop);
    document.addEventListener("visibilitychange", onVisibility);
    render();
  }

  function transition(event) {
    const next = core.nextState(state.name, event);
    if (next === null) {
      return false;
    }
    state.name = next;
    render();
    return true;
  }

  async function onStart() {
    if (!transition("start")) { return; }
    try {
      await requestStreams();
      transition("granted");
      await startRecording();
    } catch (err) {
      showError(err);
      transition("denied");
    }
  }

  async function requestStreams() {
    if (!window.isSecureContext) {
      throw new Error("Insecure context — open over HTTPS.");
    }
    const constraints = { audio: { autoGainControl: false, noiseSuppression: false, echoCancellation: false } };
    state.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    state.appliedSettings = state.mediaStream.getAudioTracks()[0].getSettings();
    warnIfProcessingOn(state.appliedSettings);
  }

  function warnIfProcessingOn(applied) {
    const on = applied.autoGainControl || applied.noiseSuppression || applied.echoCancellation;
    ui.warning.textContent = on
      ? "Warning: this device did not honor processing-off. Captures may be gain-normalized."
      : "";
  }

  async function startRecording() {
    state.recordingStartMs = Date.now();
    state.frames = [];
    state.totalSamples = 0;
    state.gpsSamples = [];
    state.audioFirstFrameMs = 0;

    state.audioContext = new AudioContext();
    state.sampleRate = state.audioContext.sampleRate;
    await state.audioContext.audioWorklet.addModule("capture-worklet.js");
    const source = state.audioContext.createMediaStreamSource(state.mediaStream);
    state.workletNode = new AudioWorkletNode(state.audioContext, "capture-processor");
    state.workletNode.port.onmessage = onAudioFrame;
    source.connect(state.workletNode);
    // Do not connect to destination — we are not monitoring playback.

    startGpsWatch();
    await acquireWakeLock();
    render();
  }

  function onAudioFrame(event) {
    if (state.name !== "recording") { return; }
    const { frame, rms } = event.data;
    if (state.audioFirstFrameMs === 0) {
      state.audioFirstFrameMs = Date.now();
    }
    state.frames.push(frame);
    state.totalSamples += frame.length;
    ui.level.value = Math.min(1, rms * 4); // simple VU scaling
  }

  function startGpsWatch() {
    state.geoWatchId = navigator.geolocation.watchPosition(
      (position) => {
        state.gpsCounter += 1;
        state.gpsSamples.push(core.normalizeFix(position, "g" + state.gpsCounter));
        ui.gps.textContent = "GPS locked — " + state.gpsSamples.length + " fixes, " +
          (position.coords.speed == null ? "?" : position.coords.speed.toFixed(1)) + " m/s";
      },
      (err) => { ui.gps.textContent = "GPS error: " + err.message; },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  }

  async function acquireWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        state.wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch (err) {
      // Non-fatal; screen may dim.
    }
  }

  function releaseWakeLock() {
    if (state.wakeLock) { state.wakeLock.release(); state.wakeLock = null; }
  }

  function onVisibility() {
    if (document.hidden && state.name === "recording") {
      transition("foreground_lost");
      ui.warning.textContent = "Warning: app backgrounded — capture is paused/at risk. Return to the page.";
    }
  }

  function onStop() {
    if (state.name !== "recording") { return; }
    transition("stop");
    finalizeAndExport(null);
  }

  function finalizeAndExport(reason) {
    stopStreams();
    const label = (ui.label.value || state.baseLabel) + "-" + hhmmss(new Date());
    const wavName = label + ".wav";
    const wav = core.encodeWav(state.frames, state.totalSamples, state.sampleRate);
    const manifest = core.buildManifest({
      pass_label: label,
      wav_filename: wavName,
      recording_start_ms: state.recordingStartMs,
      audio_first_frame_ms: state.audioFirstFrameMs,
      total_samples: state.totalSamples,
      sample_rate: state.sampleRate,
      partial: reason !== null,
      truncation_reason: reason,
      notes: ui.notes.value,
      audio_settings_requested: { autoGainControl: false, noiseSuppression: false, echoCancellation: false },
      audio_settings_applied: state.appliedSettings,
      user_agent: navigator.userAgent,
      gps_samples: state.gpsSamples,
      observed_fix_hz: core.observedFixHz(state.gpsSamples)
    });
    if (state.gpsSamples.length === 0) {
      ui.warning.textContent = "Warning: this pass captured no GPS fixes.";
    }
    downloadBlob(new Blob([wav], { type: "audio/wav" }), wavName);
    downloadBlob(new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }), label + ".json");
  }

  function streamLost(reason) {
    if (state.name === "recording" && transition("stream_lost")) {
      finalizeAndExport(reason);
    }
  }

  function stopStreams() {
    if (state.workletNode) { state.workletNode.disconnect(); state.workletNode = null; }
    if (state.audioContext) { state.audioContext.close(); state.audioContext = null; }
    if (state.mediaStream) { state.mediaStream.getTracks().forEach((t) => t.stop()); state.mediaStream = null; }
    if (state.geoWatchId !== null) { navigator.geolocation.clearWatch(state.geoWatchId); state.geoWatchId = null; }
    releaseWakeLock();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function hhmmss(date) {
    const p = (n) => String(n).padStart(2, "0");
    return p(date.getHours()) + p(date.getMinutes()) + p(date.getSeconds());
  }

  function showError(err) { ui.status.textContent = "Error: " + err.message; }

  function render() {
    ui.status.textContent = "State: " + state.name;
    ui.start.disabled = state.name === "recording" || state.name === "requesting_permissions";
    ui.stop.disabled = state.name !== "recording";
  }

  window.SensoryNavCapture = { init, streamLost };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
```

Note on the mic-loss path: the `MediaStreamTrack` `ended` event calls `streamLost("mic_lost")`; wire it in `requestStreams` after obtaining the track: `state.mediaStream.getAudioTracks()[0].addEventListener("ended", () => streamLost("mic_lost"));`. Include that line.

- [ ] **Step 2: Commit**

```bash
git add capture.js
git commit -m "feat(capture): add recorder orchestrator"
```

---

### Task 7: Capture page + on-device verification

**Files:**
- Create: `capture.html`

**Interfaces:**
- Consumes: `theme.js` and the five pure modules (loaded in dependency order), then `capture.js`.

- [ ] **Step 1: Write the page**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SensoryNav Capture</title>
  <link rel="stylesheet" href="styles.css?v=0.2.5">
  <script src="theme.js?v=0.2.5"></script>
</head>
<body>
  <nav class="site-nav" aria-label="Site"><a href="index.html">Home</a></nav>
  <h1>Capture</h1>
  <p id="status" aria-live="polite">State: idle</p>
  <p id="warning" class="warning" aria-live="assertive"></p>

  <label for="label">Pass base name</label>
  <input id="label" type="text" value="johnson-creek-pass-1">
  <label for="notes">Pre-drive notes</label>
  <input id="notes" type="text" placeholder="dry, ~35mph">

  <div class="controls">
    <button id="start" type="button">Start recording</button>
    <button id="stop" type="button" disabled>Stop recording</button>
  </div>

  <p>Audio level</p>
  <progress id="level" max="1" value="0"></progress>
  <p id="gps" aria-live="polite">GPS: acquiring…</p>

  <!-- Pure modules first (attach to window.SensoryNavCore), then the orchestrator. -->
  <script src="recorder/wav-encoder.js"></script>
  <script src="recorder/gps-track.js"></script>
  <script src="recorder/capture-state.js"></script>
  <script src="recorder/capture-manifest.js"></script>
  <script src="capture.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add capture.html
git commit -m "feat(capture): add capture page"
```

- [ ] **Step 3: On-device manual verification (USER runs on the Samsung Galaxy A16, current Chrome, over HTTPS)**

Execute the spec's checklist; each step has an explicit PASS condition:

1. Open the page; Start; grant mic + location → state shows "Recording" within 2 s.
2. Speak/tap near the mic → the audio level bar moves.
3. Wait for GPS → indicator shows locked; speed + fix count increment.
4. Read the warning area → PASS if no warning (applied settings all false); if the device ignored processing-off, the warning banner shows (a real finding).
5. Record 30 s, Stop → exactly two files download, same base, `.wav` + `.json`.
6. Open the WAV in a player → it plays; its sample rate equals the sidecar `sample_rate`.
7. New pass; switch apps 10 s; return → foreground-loss warning appeared.
8. Idle 90 s while recording → screen does not dim (Wake Lock).
9. (Optional) Drop GPS via airplane mode mid-pass → state `error`, a partial pair still downloads with `partial:true`, `truncation_reason:"gps_lost"`.

Record results in the task report.

---

## Self-Review

**1. Spec coverage:**
- Lossless WAV + exact header/conversion → Task 1. ✓
- GPS normalize to scoring-core shape + `observed_fix_hz` → Task 2. ✓
- State machine (full transition table) → Task 3. ✓
- Sidecar schema (partial/truncation/duration_ms/settings/gps) → Task 4. ✓
- AudioWorklet raw capture + RMS → Task 5. ✓
- getUserMedia AGC-off + getSettings, GPS watch (high accuracy), Wake Lock, Page-Visibility warning, state machine, filename HHMMSS, partial-export shared path, downloads → Task 6. ✓
- Page, dark theme, controls, status, notes/label, script load order → Task 7. ✓
- On-device manual checklist → Task 7 Step 3. ✓
- No new dependencies → all tasks. ✓

**2. Placeholder scan:** No TBD/TODO; every code step is complete. The mic-`ended` wiring is given as an explicit line in Task 6.

**3. Type consistency:** `core` member names (`encodeWav`, `normalizeFix`, `observedFixHz`, `nextState`, `buildManifest`) match their producing tasks; `buildManifest` input keys match what Task 6 passes; the GPS sample shape is identical across Tasks 2, 4, 6 and the scoring core.

---

## Execution

Use **superpowers:subagent-driven-development**, Sonnet per task (user rule), sequential. Tasks 1-4 gate on green node tests; Tasks 5-7 gate on code review, then the **user** runs the Task 7 on-device checklist (a subagent cannot drive the phone).
