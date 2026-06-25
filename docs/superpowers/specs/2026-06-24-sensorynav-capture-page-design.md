# SensoryNav Capture Page Design

**Status:** READY — passed the Requirements Rubric gate (36 → 40/45). Version 1.0, 2026-06-24.

## TLDR

A standalone browser page that records **lossless raw audio + GPS** during a drive and exports two files per pass (`.wav` + `.json` sidecar), so the data can be fed to the offline replay/scoring harness. It is a *pure recorder*: no scoring, no trace, no live visualization beyond "is it working" status. First use: 3-5 passes of Johnson Creek Road (~2 mi, mixed smooth-new / rough-old surface).

## Contents

1. Goal
2. Non-Goals
3. Constraints (Global)
4. Architecture & Files
5. Data Flow
6. Data Formats
7. Recording State Machine & Error Handling
8. On-Screen Feedback
9. Testing
10. Open Questions

## Goal

Let a driver capture clean, analyzable raw audio and GPS data on a known road, with the microphone's loudness-distorting processing disabled and the audio/GPS streams aligned on one clock, then download each pass as a playable WAV plus a metadata sidecar. The captures feed the offline harness that validates the scoring core against felt experience and supplies real data to the demo page.

## Non-Goals

This page will NOT:

- Score audio, compute roughness, pair samples, or render a trace/map (that is the scoring core + harness).
- Show a live color/heat trace, emoji, or any glance-magnet visualization while driving (safety; and it is a *pure recorder*).
- Persist data to a backend or upload anything (local-only; user-initiated download).
- Capture accelerometer/gyroscope data (deferred PRD goal).
- Provide in-drive annotation/marking (ground truth is positional/post-hoc from the known road; voice annotation is barred because speech contaminates the mic).
- Use lossy audio encoding (no MediaRecorder/Opus/AAC).

## Constraints (Global)

Copied as binding requirements; every implementation task includes these.

- **Lossless audio.** Capture raw PCM and encode 16-bit PCM WAV. MediaRecorder (compressed) is forbidden.
- **Microphone processing OFF.** `getUserMedia` audio constraints must set `autoGainControl: false`, `noiseSuppression: false`, `echoCancellation: false`. The *actual* applied settings must be read back via `MediaStreamTrack.getSettings()` and recorded in the sidecar, because some Android devices silently ignore the request — we must be able to tell.
- **One clock.** All timestamps are epoch milliseconds (`Date.now()` / the Geolocation `Position.timestamp`). `recording_start_ms` anchors the audio; each GPS sample carries `captured_at_ms`. This matches the scoring core's pairing model.
- **High-accuracy GPS.** `watchPosition` with `enableHighAccuracy: true`. Each sample stores `speed_mps` and `accuracy_meters`; the sidecar records the observed fix cadence (speed cadence bounds the later speed-RMS analysis resolution).
- **Foreground-only, screen awake.** Acquire a Screen Wake Lock while recording; detect foreground loss via the Page Visibility API and warn loudly (a backgrounded tab suspends capture).
- **Secure context.** `getUserMedia` and geolocation require HTTPS; deployment is GitHub Pages (HTTPS) and `localhost` for dev.
- **No new dependencies.** Web Audio, Geolocation, Wake Lock, and Page Visibility are all built-in. Nothing may trip the supply-chain gate.
- **Dual export pattern** for pure modules (`module.exports` + `window.SensoryNavCore`), matching the existing `recorder/` modules.
- **Dark theme.** Reuse the site's dark theme (`theme.js`); large, glanceable, one-handed Start/Stop targets per the accessibility standard.
- **Function size.** Target ~100 lines per function, hard limit 300. `capture.js` must be decomposed into named single-purpose functions (see Architecture), not a monolith.
- **Memory budget (NFR).** A pass holds raw PCM in memory until Stop. Peak memory for the target case (~4 min mono at 48 kHz) must stay under ~60 MB: buffer Float32 frames without per-frame concatenation, and at Stop allocate the Int16 output once and convert frame-by-frame into it (no full second Float32 copy). If a recording exceeds a soft ceiling of 12 minutes, the page shows a "long recording — consider stopping" warning (it does not auto-stop).

## Architecture & Files

New files in the existing repo, deployed via GitHub Pages, opened in Chrome on Android.

| File | Responsibility | Test |
|---|---|---|
| `capture.html` | The page: dark theme, big Start/Stop, status readouts, pre-drive notes field, download links | Manual (device) |
| `capture.js` | Orchestrator: permissions, `getUserMedia` (processing off), worklet wiring, geolocation watch, Wake Lock, Page-Visibility warning, the state machine, finalize + download | Manual (device) |
| `capture-worklet.js` | AudioWorklet processor — forwards raw Float32 PCM frames to the main thread | Manual (device) |
| `recorder/wav-encoder.js` | **Pure:** Float32 PCM chunks → 16-bit PCM mono WAV `Blob`/`Uint8Array` with a correct RIFF/WAVE header at a given sample rate | Node unit test |
| `recorder/gps-track.js` | **Pure:** normalize a `GeolocationPosition` into the epoch-ms GPS sample shape; compute observed fix cadence | Node unit test |
| `recorder/capture-manifest.js` | **Pure:** assemble the JSON sidecar object from audio metadata + GPS track + applied settings + notes | Node unit test |

Recording mechanism: **AudioWorklet** (raw PCM off the audio thread), not ScriptProcessorNode (deprecated, main-thread) and not MediaRecorder (lossy).

**Buffering & memory.** The worklet posts Float32 frames (typically 128 samples) to the main thread. `capture.js` keeps them as an array of `Float32Array` frames plus a running `totalSamples` count — never concatenating per frame. The first frame's arrival is stamped `audio_first_frame_ms = Date.now()` (the offset from `recording_start_ms` covers `AudioContext` spin-up latency, so the harness can align audio to GPS precisely). At Stop, `wav-encoder.js` allocates one `Int16Array(totalSamples)`, converts each Float32 frame directly into it — releasing each Float32 frame as it is consumed so the source frames and the Int16 output do not fully coexist — and writes the WAV. The orchestrator passes ownership of the throwaway frames array to the encoder, which nulls each slot after converting it; this is the documented mechanism that enforces the release (the encoder's WAV output remains a pure function of the input samples). This keeps peak memory within the budget NFR.

**`capture.js` decomposition** (named single-purpose functions, per the function-size constraint): `requestPermissions()`, `startAudioCapture()` (getUserMedia + worklet wiring + getSettings read-back), `startGpsWatch()`, `acquireWakeLock()` / `releaseWakeLock()`, `installVisibilityWarning()`, `transition(state, event)` (the sole state mutator), and `finalizeAndExport(reason)` (encode + sidecar + download, shared by Stop and error paths). The level-meter RMS is computed in the worklet and posted alongside frames, not recomputed on the main thread.

## Data Flow

1. **Idle → Start pressed.** Request microphone (processing-off constraints) and geolocation permissions. On grant: acquire Wake Lock, create `AudioContext`, load the worklet, start `watchPosition`, stamp `recording_start_ms = Date.now()`, read back `track.getSettings()`.
2. **Recording.** Worklet streams PCM frames → buffered as Float32 chunks. `watchPosition` pushes a normalized GPS sample per fix. Status UI updates (elapsed, RMS level bar, GPS fix + speed + sample count).
3. **Stop pressed.** Stop the worklet, geolocation watch, and Wake Lock. Encode the buffered PCM to a 16-bit WAV at `AudioContext.sampleRate`. Build the JSON sidecar.
4. **Export.** Auto-download two files named for the pass: `johnson-creek-pass-N.wav` and `johnson-creek-pass-N.json`. (Pass number / base name comes from a field on the page; default increments per session.)

## Data Formats

### WAV (per pass)

- Container: RIFF/WAVE, PCM (format code 1). Channels: 1 (mono). Bit depth: 16. Sample rate: the actual `AudioContext.sampleRate` (commonly 48000, sometimes 44100), written into both the header and the sidecar; the encoder takes the rate as a parameter and must work for any rate.

**44-byte header byte map** (all multi-byte fields little-endian; `dataSize = numSamples * 2`):

| Offset | Field | Size | Value / formula |
|---|---|---|---|
| 0 | ChunkID | 4 | ASCII `RIFF` |
| 4 | ChunkSize | 4 | `36 + dataSize` |
| 8 | Format | 4 | ASCII `WAVE` |
| 12 | Subchunk1ID | 4 | ASCII `fmt ` (trailing space) |
| 16 | Subchunk1Size | 4 | `16` |
| 20 | AudioFormat | 2 | `1` (PCM) |
| 22 | NumChannels | 2 | `1` |
| 24 | SampleRate | 4 | the sample rate |
| 28 | ByteRate | 4 | `SampleRate * NumChannels * 2` |
| 32 | BlockAlign | 2 | `NumChannels * 2` |
| 34 | BitsPerSample | 2 | `16` |
| 36 | Subchunk2ID | 4 | ASCII `data` |
| 40 | Subchunk2Size | 4 | `dataSize` |
| 44 | PCM payload | dataSize | signed 16-bit LE samples |

**Float32 → int16 conversion (exact):** for each sample `x`, clamp then scale asymmetrically and round:

```
s = Math.max(-1, Math.min(1, x))
int16 = Math.round(s < 0 ? s * 0x8000 : s * 0x7FFF)
```

So `1.0 → 32767`, `-1.0 → -32768`, `0.5 → 16384`, `-0.5 → -16384`, `0 → 0`.

### JSON sidecar (per pass)

```json
{
  "schema": "sensorynav-capture-v1",
  "pass_label": "johnson-creek-pass-1-153007",
  "recording_start_ms": 0,
  "audio_first_frame_ms": 0,
  "duration_ms": 0,
  "partial": false,
  "truncation_reason": null,
  "notes": "free-text entered before the drive (e.g. 'dry, ~35mph')",
  "audio": {
    "wav_filename": "johnson-creek-pass-1-153007.wav",
    "sample_rate": 48000,
    "channels": 1,
    "bit_depth": 16
  },
  "audio_settings_requested": { "autoGainControl": false, "noiseSuppression": false, "echoCancellation": false },
  "audio_settings_applied": { "autoGainControl": false, "noiseSuppression": false, "echoCancellation": false },
  "device": { "user_agent": "..." },
  "gps": {
    "enable_high_accuracy": true,
    "fix_count": 0,
    "observed_fix_hz": null
  },
  "gps_samples": [
    {
      "sample_id": "string",
      "captured_at_ms": 0,
      "latitude": 0,
      "longitude": 0,
      "speed_mps": null,
      "accuracy_meters": 0
    }
  ]
}
```

Field rules:

- `gps_samples` uses the same field names as the scoring core's GPS Sample model, so the harness ingests it directly.
- **Filename uniqueness.** `pass_label` is `<base>-<HHMMSS>` where `<base>` is the page's base-name field (default `johnson-creek-pass-<n>`, `n` auto-incrementing in-memory per page load) and `HHMMSS` is the local time at recording start. Both files share this exact base, guaranteeing uniqueness within a session even on a re-take or a manually duplicated label — so Android Chrome never appends `(1)` and breaks the `.wav`/`.json` pairing. `audio.wav_filename` is set to the exact downloaded WAV name. "Session" = since page load; the counter resets on reload, but the `HHMMSS` suffix keeps names distinct across reloads too.
- `audio_settings_applied` is read from `getSettings()`; if it differs from `audio_settings_requested`, the page surfaces a visible warning (the device ignored processing-off).
- `duration_ms` = `totalSamples / sample_rate * 1000` (audio-derived, not wall-clock at Stop) — correct for both clean and truncated passes. It is pure audio elapsed; the offset between `recording_start_ms` and the first audio sample is captured separately by `audio_first_frame_ms` and is NOT included here.
- `partial` is `true` and `truncation_reason` is one of `"mic_lost"`, `"gps_lost"`, `"permission_revoked"` when the pass ended via the `error` path (see State Machine); otherwise `false`/`null`.
- `gps.observed_fix_hz` = `(fix_count − 1) / ((last captured_at_ms − first captured_at_ms) / 1000)`; `null` when `fix_count < 2`.

## Recording State Machine & Error Handling

States: `idle`, `requesting_permissions`, `recording`, `stopped`, `error`. A single controller in `capture.js` owns transitions.

| From | Event | To |
|---|---|---|
| `idle` | Start | `requesting_permissions` |
| `requesting_permissions` | both granted | `recording` |
| `requesting_permissions` | mic or location denied / unsupported / insecure context | `error` |
| `recording` | foreground lost (Page Visibility hidden) | `recording` + loud foreground-loss warning (capture may be suspended by the browser) |
| `recording` | mic or geolocation stream lost mid-drive | `error` (keep buffered data; allow export of the partial pass) |
| `recording` | Stop | `stopped` (encode + download) |
| `stopped` / `error` | New pass / reset | `idle` |

Error messages must be specific: mic denied, location denied, unsupported browser/API, insecure (non-HTTPS) context. (No GPS fix is NOT a hard error: recording starts on permission grant and the status shows "acquiring GPS…". If a pass is stopped with `fix_count === 0`, the page warns that the pass captured no GPS data — the sidecar and WAV still download so the audio is not lost.)

**Partial export is an explicit, shared path.** Entering `error` *from `recording`* (mic/GPS stream loss or mid-drive permission revocation) calls the same `finalizeAndExport(reason)` used by Stop — it encodes the buffered PCM, builds the sidecar with `partial: true` and the matching `truncation_reason`, and offers the same two-file download. The only differences from a clean Stop are those two flags and that `duration_ms` reflects the audio captured before the loss. Entering `error` *from `requesting_permissions`* has no buffered data, so there is nothing to export — it only shows the specific error. Mic-loss vs GPS-loss is distinguished by `truncation_reason`; if the mic is lost, the WAV is whatever was buffered before the loss; if GPS is lost, the WAV is complete and only `gps_samples` is short.

## On-Screen Feedback

Status only — no scoring, trace, color, or emoji:

- Large recording indicator + elapsed timer.
- Live audio **level bar** (RMS/peak from the worklet frames) — a VU meter to confirm the mic is live; not analysis.
- GPS fix indicator (acquiring / locked), current `speed_mps` readout, and running GPS sample count.
- A visible warning if `audio_settings_applied` shows the device did not honor AGC/NS/EC off.
- Pre-drive notes text field and a pass-label field.

## Testing

**Pure modules (Node `assert`, RED/GREEN, like the scoring core):**

- `wav-encoder`: encode a known small Float32 buffer, **parametrized over sample rates 44100 and 48000**. Assert: the ASCII markers `RIFF`/`WAVE`/`fmt `/`data` at offsets 0/8/12/36; `Subchunk1Size=16`, `AudioFormat=1`, `NumChannels=1`, `BitsPerSample=16`; `SampleRate` matches the parameter; `ByteRate = SampleRate*2`; `BlockAlign = 2`; `ChunkSize = 36 + dataSize`; `Subchunk2Size = numSamples*2`; total length `= 44 + numSamples*2`. Conversion asserts: `1.0→32767`, `-1.0→-32768`, `0.5→16384`, `-0.5→-16384`, `0→0`, and out-of-range `1.5`/`-1.5` clamp to `32767`/`-32768`.
- `gps-track`: normalize a synthetic `GeolocationPosition` → assert the epoch-ms sample shape (field names match the scoring core), `speed_mps`/`accuracy_meters` passthrough including `null` speed, and `observed_fix_hz` from sample timestamps — including `null` when `fix_count < 2`.
- `capture-manifest`: assemble a sidecar from fixture inputs → assert schema/version, the audio block, `audio_settings_applied` carried, `partial`/`truncation_reason` set correctly for both a clean and a truncated pass, `duration_ms` derived from `totalSamples`/`sample_rate`, and that the GPS samples are embedded unchanged.

**Browser glue — on-device manual checklist.** Target: Samsung Galaxy A16, current Chrome, over HTTPS. Each step has an explicit pass condition:

1. Open the page; tap Start; grant mic + location. PASS: state shows "Recording" within 2 s.
2. Speak/tap near the mic. PASS: the audio level bar visibly moves.
3. Wait for GPS. PASS: the fix indicator shows "locked" and the speed + sample count increment.
4. Read the displayed applied audio settings. PASS: `autoGainControl`/`noiseSuppression`/`echoCancellation` all `false`; FAIL-but-recorded: if any is `true`, the warning banner is shown (this is the device ignoring the request — a real finding, not a page bug).
5. Record 30 s, tap Stop. PASS: exactly two files download, named `<label>.wav` and `<label>.json` with the same base.
6. Open the WAV in a player. PASS: it plays, and its sample rate equals the sidecar `sample_rate`.
7. Start a new pass; switch to another app for 10 s; return. PASS: the foreground-loss warning appears within ~1 s of leaving.
8. While recording, leave the phone idle 90 s. PASS: the screen does not dim/lock (Wake Lock held).
9. (Optional truncation check) Start a pass, then toggle airplane mode briefly to drop GPS. PASS: state goes to `error`, a partial file pair still downloads with `partial: true` and `truncation_reason: "gps_lost"`.

## Open Questions

Non-blocking:

1. Is `watchPosition` ~1 Hz fine enough for the speed-RMS cross-reference, or do we need a higher-cadence speed source? (The real drives will answer this; the sidecar logs the observed cadence so we can tell.)
2. Should the page offer a simple in-app playback/verify step after a pass, or is downloading + playing the WAV elsewhere enough for v1? (Default: download only.)
3. Mono is assumed; if the device exposes a usefully different mic configuration, revisit — but mono is correct for v1.
