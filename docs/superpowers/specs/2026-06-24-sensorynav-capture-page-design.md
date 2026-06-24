# SensoryNav Capture Page Design

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

Recording mechanism: **AudioWorklet** (raw PCM off the audio thread), not ScriptProcessorNode (deprecated, main-thread) and not MediaRecorder (lossy). The worklet posts Float32 frames; `capture.js` buffers them; `wav-encoder.js` encodes at stop.

## Data Flow

1. **Idle → Start pressed.** Request microphone (processing-off constraints) and geolocation permissions. On grant: acquire Wake Lock, create `AudioContext`, load the worklet, start `watchPosition`, stamp `recording_start_ms = Date.now()`, read back `track.getSettings()`.
2. **Recording.** Worklet streams PCM frames → buffered as Float32 chunks. `watchPosition` pushes a normalized GPS sample per fix. Status UI updates (elapsed, RMS level bar, GPS fix + speed + sample count).
3. **Stop pressed.** Stop the worklet, geolocation watch, and Wake Lock. Encode the buffered PCM to a 16-bit WAV at `AudioContext.sampleRate`. Build the JSON sidecar.
4. **Export.** Auto-download two files named for the pass: `johnson-creek-pass-N.wav` and `johnson-creek-pass-N.json`. (Pass number / base name comes from a field on the page; default increments per session.)

## Data Formats

### WAV (per pass)

- Container: RIFF/WAVE, PCM (format code 1).
- Channels: 1 (mono). Bit depth: 16. Sample rate: the actual `AudioContext.sampleRate` (e.g. 48000), written into the header and the sidecar.
- Payload: the full drive's PCM, little-endian signed 16-bit, converted from Float32 with clamping to [-1, 1].

### JSON sidecar (per pass)

```json
{
  "schema": "sensorynav-capture-v1",
  "pass_label": "johnson-creek-pass-1",
  "recording_start_ms": 0,
  "duration_ms": 0,
  "notes": "free-text entered before the drive (e.g. 'dry, ~35mph')",
  "audio": {
    "wav_filename": "johnson-creek-pass-1.wav",
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
    "observed_fix_hz": 0
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

`gps_samples` uses the same field names as the scoring core's GPS Sample model, so the harness ingests it directly. `audio_settings_applied` is read from `getSettings()`; if it differs from requested, the page surfaces a visible warning (the device ignored AGC-off).

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

Error messages must be specific: mic denied, location denied, unsupported browser/API, insecure (non-HTTPS) context, no GPS fix acquired. On mid-drive stream loss the buffered audio + GPS so far are still encodable and downloadable.

## On-Screen Feedback

Status only — no scoring, trace, color, or emoji:

- Large recording indicator + elapsed timer.
- Live audio **level bar** (RMS/peak from the worklet frames) — a VU meter to confirm the mic is live; not analysis.
- GPS fix indicator (acquiring / locked), current `speed_mps` readout, and running GPS sample count.
- A visible warning if `audio_settings_applied` shows the device did not honor AGC/NS/EC off.
- Pre-drive notes text field and a pass-label field.

## Testing

**Pure modules (Node `assert`, RED/GREEN, like the scoring core):**

- `wav-encoder`: encode a known small Float32 buffer at a known rate; assert the RIFF/`WAVE`/`fmt `/`data` chunk markers, the sample-rate and bit-depth header fields, channel count, the byte-length math (`44 + samples*2`), and that a full-scale sample clamps to `0x7FFF`/`-0x8000`.
- `gps-track`: normalize a synthetic `GeolocationPosition` → assert the epoch-ms sample shape (field names match the scoring core), `speed_mps`/`accuracy_meters` passthrough including `null` speed, and the observed-fix-cadence computation from sample timestamps.
- `capture-manifest`: assemble a sidecar from fixture inputs → assert schema/version, the audio block, that `audio_settings_applied` is carried, and that the GPS samples are embedded unchanged.

**Browser glue (on-device manual checklist):** permissions prompts; **AGC-off verified via `getSettings()`**; a short test recording; both files download; the WAV plays back and its sample rate matches the sidecar; foreground-loss warning fires when switching apps; Wake Lock keeps the screen on.

## Open Questions

Non-blocking:

1. Is `watchPosition` ~1 Hz fine enough for the speed-RMS cross-reference, or do we need a higher-cadence speed source? (The real drives will answer this; the sidecar logs the observed cadence so we can tell.)
2. Should the page offer a simple in-app playback/verify step after a pass, or is downloading + playing the WAV elsewhere enough for v1? (Default: download only.)
3. Mono is assumed; if the device exposes a usefully different mic configuration, revisit — but mono is correct for v1.
