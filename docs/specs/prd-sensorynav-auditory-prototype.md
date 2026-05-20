# PRD: SensoryNav Auditory Road Comfort Prototype

## TLDR

Build the smallest demoable SensoryNav prototype around road sound only.

The prototype records microphone energy and GPS samples during a drive, converts one-second audio windows into a rough auditory comfort score, pairs those scores with location, and renders a colored route trace. It stores and exports data locally only. It does not upload raw audio or location data.

## Contents

1. Version
2. Introduction / Overview
3. Goals
4. Non-Goals
5. Target Users
6. User Stories
7. Functional Requirements
8. Data Model
9. Scoring Formula
10. Design & Technical Considerations
11. Safety, Consent, And Privacy
12. Success Metrics
13. Open Questions

## Version

- PRD version: 0.3
- Status: Ready for decomposition after human approval
- Product build target: prototype, not production
- First supported recording target: Chrome or Edge on Android
- Secondary target: desktop browser using fixture/imported data
- Stretch target: iOS Safari

## Introduction / Overview

SensoryNav is a sensory accommodation layer for maps.

Most maps optimize for time, traffic, or distance. SensoryNav explores a different routing quality: how a route sounds and feels to a sensory-sensitive person.

This prototype focuses only on the auditory part: recording road noise during a drive, pairing that audio with location samples, computing simple frequency-band energy, and showing a route trace where segments are scored by auditory comfort.

The purpose is to prove one narrow claim:

> A user can record a drive and see where the road sounded smoother or harsher.

## Goals

1. Let a tester record road-noise samples and GPS positions during a drive.
2. Convert short audio windows into frequency-band energy scores.
3. Pair each audio score with the nearest available GPS sample.
4. Display a map-like trace colored by auditory roughness.
5. Export the recorded trace as local JSON for manual inspection.
6. Keep the prototype privacy-preserving: no server upload, no raw audio storage by default.

## Non-Goals

This prototype will not:

- Provide turn-by-turn navigation.
- Optimize routes automatically.
- Use gyroscope or accelerometer data.
- Import construction data.
- Detect potholes specifically.
- Claim medical, accessibility, or safety-grade accuracy.
- Support background recording when the browser is closed.
- Store data on a backend.
- Support multiple users or accounts.

## Target Users

Primary early testers:

- Neurodivergent and sensory-sensitive drivers or passengers.
- People who immediately understand that route quality is more than speed.
- Accessibility-minded technologists willing to test a rough prototype.

Secondary testers:

- People interested in quantified self, civic mapping, or road-quality data.

## User Stories

### US-001: Start A Drive Recording

Priority: P0

As a tester, I want to start a drive recording from my phone browser so that SensoryNav can collect road-noise and GPS samples.

Acceptance criteria:

- The page has a clear `Start recording` control.
- The browser asks for microphone and location permissions.
- If either permission is denied, the page shows a specific error.
- Recording does not begin until both permissions are granted.
- The UI states that the tester should start recording before driving or have a passenger operate the controls.
- Verification: browser test confirms permission-error UI can render using mocked failures or manual test notes.

### US-002: Stop A Drive Recording

Priority: P0

As a tester, I want to stop recording so that I can review the captured trace.

Acceptance criteria:

- The page has a `Stop recording` control while recording is active.
- Stopping recording halts microphone analysis and geolocation watch.
- The UI shows the number of captured audio windows and GPS samples.
- Verification: browser or manual test confirms sample counts stop changing after stop.

### US-003: Compute Auditory Roughness

Priority: P0

As a tester, I want road noise converted into simple scores so that I can see relative quiet versus harsh sections.

Acceptance criteria:

- Audio is analyzed in one-second windows.
- Each window stores RMS energy for three bands:
  - low: 80-250 Hz
  - mid: 250-1000 Hz
  - high: 1000-4000 Hz
- Each window stores `auditory_roughness_score` from 0-100.
- The score uses the provisional formula in the Scoring Formula section.
- Raw audio is not persisted by default.
- Verification: unit or script test confirms known synthetic tones produce higher energy in the expected band.

### US-004: Pair Audio Windows With Location

Priority: P0

As a tester, I want each audio score connected to a location so that the route can be mapped.

Acceptance criteria:

- Each audio window is paired with the nearest GPS sample by timestamp.
- If no GPS sample is within five seconds, the audio window is marked `location_status: "missing"`.
- Missing-location windows are excluded from the visual trace but remain in exported JSON.
- Verification: data test confirms nearest-sample pairing and missing-location behavior.

### US-005: Display A Colored Route Trace

Priority: P0

As a tester, I want to see my drive trace colored by auditory roughness so that I can identify harsh and smoother areas.

Acceptance criteria:

- The first prototype may use a simple SVG/canvas GPS trace. Real map tiles are not required.
- The trace displays located audio windows as points or connected segments.
- Trace colors:
  - green: score 0-33
  - yellow: score 34-66
  - red: score 67-100
- The UI includes a simple legend.
- Selecting a point or segment shows timestamp, roughness score, and band values.
- Verification: browser test confirms sample fixture data renders green, yellow, and red trace elements.

### US-006: Export Local JSON

Priority: P1

As a tester or developer, I want to export a recording as JSON so that we can inspect the data and improve the model.

Acceptance criteria:

- The export includes:
  - session id
  - created timestamp
  - browser/user-agent summary
  - calibration baseline summary
  - audio window scores
  - GPS samples
  - paired located samples
- The export does not include raw audio.
- The export is a user-initiated local download only.
- Verification: JSON schema test validates a sample export.

### US-007: Calibrate A Trip Baseline

Priority: P0

As a tester, I want the prototype to establish a per-trip baseline so that scores are relative to my phone/car setup.

Acceptance criteria:

- The first 30 seconds of valid recording are used as the baseline window.
- The UI shows when baseline capture is in progress and when it is complete.
- Roughness scores after baseline are normalized relative to the baseline median.
- If the trip ends before baseline completion, the recording is marked `calibration_status: "incomplete"`.
- Verification: data test confirms baseline median affects normalized scores.

### US-008: Load Fixture Data

Priority: P1

As a developer or tester, I want to load sample data without driving so that the trace UI can be tested repeatedly.

Acceptance criteria:

- The app includes a fixture mode or sample JSON import.
- Fixture data contains at least 30 located audio windows.
- Fixture data includes green, yellow, and red score examples.
- Verification: browser test confirms fixture mode renders without microphone or GPS permissions.

## Functional Requirements

### FR-001: Recording State

Priority: P0

The app must implement explicit recording states:

1. `idle`
2. `requesting_permissions`
3. `recording_baseline`
4. `recording`
5. `stopped`
6. `error`

### FR-002: Audio Capture

Priority: P0

The app must use browser microphone APIs to capture live audio for analysis.

### FR-003: Audio Analysis

Priority: P0

The app must calculate frequency-band energy locally in the browser and discard raw audio buffers after analysis.

### FR-004: Location Capture

Priority: P0

The app must use browser geolocation APIs to collect timestamped latitude/longitude samples.

### FR-005: Data Pairing

Priority: P0

The app must pair audio windows and GPS samples by nearest timestamp.

### FR-006: Trace Display

Priority: P0

The app must display located samples on a map-like trace.

Implementation may use a simple SVG/canvas trace for the first prototype. Full map tiles are deferred.

### FR-007: Local Data Export

Priority: P1

The app must support local JSON export of the current recording session.

### FR-008: Privacy Defaults

Priority: P0

The app must not upload microphone, location, or trace data to any backend in this prototype.

### FR-009: Error Handling

Priority: P0

The app must show clear errors for:

- microphone permission denied
- location permission denied
- unsupported browser APIs
- no GPS samples received
- recording shorter than the baseline period

### FR-010: Test Fixture Mode

Priority: P1

The app must include fixture mode or sample JSON import so the trace UI can be tested without driving.

### FR-011: Safety Copy

Priority: P0

The app must state that recording should be started before driving or operated by a passenger. The app must not require interaction while driving.

### FR-012: Local Retention

Priority: P1

The app may keep the active session in browser memory or localStorage, but it must provide a clear way to clear local session data.

## Data Model

### Recording Session

```json
{
  "session_id": "uuid",
  "created_at": "ISO-8601 timestamp",
  "calibration_status": "complete | incomplete",
  "score_formula_version": "auditory-roughness-v0",
  "baseline": {
    "duration_seconds": 30,
    "low_median": 0,
    "mid_median": 0,
    "high_median": 0
  },
  "audio_windows": [],
  "gps_samples": [],
  "located_samples": []
}
```

### Audio Window

```json
{
  "window_id": "string",
  "started_at": "ISO-8601 timestamp",
  "duration_ms": 1000,
  "low_energy": 0,
  "mid_energy": 0,
  "high_energy": 0,
  "low_delta": 0,
  "mid_delta": 0,
  "high_delta": 0,
  "auditory_roughness_score": 0
}
```

### GPS Sample

```json
{
  "sample_id": "string",
  "captured_at": "ISO-8601 timestamp",
  "latitude": 0,
  "longitude": 0,
  "accuracy_meters": 0,
  "speed_mps": null
}
```

### Located Sample

```json
{
  "window_id": "string",
  "gps_sample_id": "string",
  "location_status": "paired | missing",
  "latitude": 0,
  "longitude": 0,
  "auditory_roughness_score": 0,
  "color": "green | yellow | red"
}
```

## Scoring Formula

Formula version: `auditory-roughness-v0`

The first formula is intentionally simple. It is a prototype scoring function, not a validated sensory model.

Steps:

1. Analyze audio in one-second windows.
2. Calculate RMS energy for low, mid, and high bands.
3. Use the first 30 seconds of valid recording as the trip baseline.
4. Calculate per-band deltas:

```text
low_delta = max(0, low_energy / baseline_low_median - 1)
mid_delta = max(0, mid_energy / baseline_mid_median - 1)
high_delta = max(0, high_energy / baseline_high_median - 1)
```

5. Calculate roughness:

```text
raw_score = (0.45 * low_delta) + (0.40 * mid_delta) + (0.15 * high_delta)
auditory_roughness_score = clamp(round(raw_score * 50), 0, 100)
```

Rationale:

- Low and mid bands are weighted highest because road rumble and coarse surface noise are likely to appear there.
- High band is included because hiss, tire noise, and sharp surface sounds may matter, but it is weighted lower for the first pass.
- Speed normalization is deferred until after sample data shows whether it is needed.

## Design & Technical Considerations

### Architecture

Prototype modules should stay separated:

- `audio-capture`: microphone stream and analysis windows
- `audio-scoring`: band energy and roughness score calculation
- `location-capture`: geolocation watch
- `sample-pairing`: timestamp pairing
- `trace-rendering`: map-like visualization
- `session-export`: JSON export

### Build / Buy Choices

Use existing browser APIs and libraries for:

- microphone capture
- geolocation
- FFT or audio analysis primitives
- trace rendering primitives

Custom-build only:

- band choices
- baseline normalization
- roughness score
- sensory interpretation labels

### Accessibility

The prototype must:

- provide clear text status for recording state
- avoid auto-playing sound
- avoid flashing or rapid animation
- support keyboard use for primary controls
- keep light/dark mode available

## Safety, Consent, And Privacy

Safety requirements:

- The app must not require interaction while driving.
- The app must instruct testers to start recording before driving or have a passenger operate the controls.
- The app must avoid gamified prompts that encourage risky use.

Privacy requirements:

- Audio analysis happens locally.
- Raw audio is not persisted by default.
- Location and trace data are not uploaded in this prototype.
- Export is local and user-initiated.
- Local session data can be cleared.

Consent copy must be short and visible near recording controls.

## Success Metrics

Prototype success:

- A tester can complete one recording session without developer assistance.
- At least 30 located audio windows can be collected in a short drive.
- The exported JSON validates against the expected schema.
- The trace shows visible variation between smoother and harsher sections.
- At least 3 testers can explain what the colors mean after using the prototype.

Product-learning success:

- At least 3 testers say the concept reflects a real route-quality concern.
- At least 2 testers are willing to record another drive.
- At least 1 tester identifies a road segment where the score matches their felt experience.

## Open Questions

These questions do not block the first prototype:

1. Which frequency bands best match lived sensory discomfort after real sample review?
2. Should speed normalization be added in prototype v2?
3. When should real map tiles replace the trace-only view?
4. What privacy explanation belongs on the public landing page versus inside the prototype?
5. How should known smooth/rough roads be used for future calibration?

