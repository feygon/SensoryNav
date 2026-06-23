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
10. Tunable Constants (v0 Defaults)
11. Design & Technical Considerations
12. Safety, Consent, And Privacy
13. Success Metrics
14. Deferred Goals
15. Open Questions

## Version

- PRD version: 0.6
- Status: Ready for decomposition after human approval
- v0.4 changelog: independent technical-design pass added the following — disable mic AGC/noise-suppression, define band energy as summed FFT magnitude, add a baseline epsilon floor, fix a single epoch-ms clock base for pairing, a CVD-safe color scale, and a motion-gated pause/resume lifecycle with a manual deactivate control.
- v0.5 changelog: passed the Requirements Rubric gate (37 → 45). Added the Tunable Constants block (motion thresholds, FFT params, energy floor), reconciled timestamps to a single epoch-ms base, added a state-transition table with mid-trip failure modes, a function-size constraint, and deterministic pairing rules. See `docs/requirements-review-sensorynav-auditory-prototype-v0.5.md`.
- v0.6 changelog: platform decision — the first pass is a **browser foreground MVP** (not native). Added explicit Platform Constraints (foreground-only, screen wake lock, no concurrent navigation audio), right-sized success metrics to a 1–2 tester / single-road scope, and recorded the native overlay app as a deferred goal.
- Product build target: prototype, not production
- First supported recording target: Chrome or Edge on Android (browser foreground app)
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
- Use gyroscope or accelerometer data. (This also defers phone-pickup detection as a trip-end signal to a later version; MVP trip-end is a manual deactivate control. See FR-013.)
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

- The page has a `Stop recording` (deactivate) control while recording is active.
- Activating it ends the trip; it is the only MVP trip-end signal.
- Stopping recording halts microphone analysis and geolocation watch.
- The UI shows the number of captured audio windows and GPS samples.
- Verification: browser or manual test confirms sample counts stop changing after stop.

### US-002b: Pause And Resume On Motion

Priority: P0

As a tester, I want recording to pause automatically when the car is stopped so that idling at lights and stop signs does not poison the baseline or the trace.

Acceptance criteria:

- When GPS speed stays at or below the stopped threshold (`PAUSE_STOPPED_THRESHOLD_MPS`, default 0.5 m/s) continuously for the pause hold (`PAUSE_HOLD_SECONDS`, default 3 s), the app enters `paused`: it stops accumulating audio windows but keeps the microphone and geolocation streams open.
- When GPS speed rises above the moving threshold (`PAUSE_MOVING_THRESHOLD_MPS`, default 1.5 m/s), the app resumes `recording` (or `recording_baseline` if the baseline is not yet complete). The gap between the stopped and moving thresholds is intentional hysteresis to prevent flapping at a single cutoff.
- If `speed_mps` is `null` (unknown), the app does not pause; it holds the current recording state.
- Pause/resume uses GPS speed only. No accelerometer or gyroscope is used (see Non-Goals).
- The UI clearly shows when the app is paused.
- Verification: data test confirms windows are not accumulated after speed stays ≤ 0.5 m/s for 3 s, that resume occurs once speed exceeds 1.5 m/s, and that a `null` speed does not trigger pause.

### US-003: Compute Auditory Roughness

Priority: P0

As a tester, I want road noise converted into simple scores so that I can see relative quiet versus harsh sections.

Acceptance criteria:

- Audio is analyzed in one-second windows.
- Each window stores band energy for three bands:
  - low: 80-250 Hz
  - mid: 250-1000 Hz
  - high: 1000-4000 Hz
- Band energy is defined precisely: using `AnalyserNode.getFloatFrequencyData` (float, not byte, to preserve dynamic range), convert each FFT bin whose center frequency falls in the band from dB to linear power, sum those bins, and average that sum across the analysis frames captured during the one-second window. This is the single definition of `low_energy` / `mid_energy` / `high_energy`. FFT size, analyser smoothing (off), band-edge convention, and sample-rate handling are fixed in Tunable Constants (v0 Defaults).
- Each window stores `auditory_roughness_score` from 0-100.
- The score uses the provisional formula in the Scoring Formula section.
- Raw audio is not persisted by default.
- Verification: unit or script test confirms known synthetic tones produce higher energy in the expected band.

### US-004: Pair Audio Windows With Location

Priority: P0

As a tester, I want each audio score connected to a location so that the route can be mapped.

Acceptance criteria:

- All timestamps (audio windows and GPS samples) are recorded as epoch milliseconds. Any monotonic clock source (e.g. `performance.now()`) is converted to epoch ms at record time so both streams share one clock base.
- Each audio window is paired with the nearest GPS sample by timestamp, within ±`PAIR_MAX_SKEW_SECONDS` (see Tunable Constants).
- One GPS sample may pair with multiple audio windows; on an exact-distance tie, the earlier GPS timestamp wins.
- The paired GPS timestamp is carried onto the located sample so the US-005 detail view can show it.
- If no GPS sample is within the skew window, the audio window is marked `location_status: "missing"`.
- Missing-location windows are excluded from the visual trace but remain in exported JSON.
- Verification: data test confirms nearest-sample pairing and missing-location behavior.

### US-005: Display A Colored Route Trace

Priority: P0

As a tester, I want to see my drive trace colored by auditory roughness so that I can identify harsh and smoother areas.

Acceptance criteria:

- The first prototype may use a simple SVG/canvas GPS trace. Real map tiles are not required.
- The trace displays located audio windows as points or connected segments.
- Trace color uses a perceptually-uniform, colorblind-safe (CVD-safe) sequential scale rather than green/yellow/red, because red-green color vision deficiency affects roughly 8% of men and the target audience is accessibility-first. Use a cividis- or viridis-style scale (low intensity at smooth, high intensity at rough). Reference buckets:
  - smooth: score 0-33 → low end of the scale (e.g. cividis dark blue `#00204D`)
  - moderate: score 34-66 → mid scale (e.g. `#7C7B78`)
  - rough: score 67-100 → high end (e.g. cividis muted yellow `#FFE945`)
- A continuous scale across 0-100 is preferred over hard buckets; the buckets above are only reference anchors and the legend.
- The UI includes a simple legend keyed to the scale.
- Selecting a point or segment shows timestamp, roughness score, and band values (the numeric score is the non-color redundant cue).
- Verification: browser test confirms sample fixture data renders trace elements across the low, mid, and high ends of the CVD-safe scale.

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

- The first 30 seconds of valid **moving** recording are used as the baseline window. Time spent in `paused` (stopped at lights/stop signs) does not count toward the baseline, so idling cannot poison it.
- The UI shows when baseline capture is in progress and when it is complete.
- Roughness scores after baseline are normalized relative to the baseline median.
- If the tester deactivates before the moving baseline completes, the recording is marked `calibration_status: "incomplete"`. In that case the app shows no colored roughness scores (they are meaningless without a baseline), renders the GPS trace in a single neutral color, notifies the tester that the trip was incomplete, and still retains raw per-band energies in the export.
- Verification: data test confirms baseline median affects normalized scores, and that an incomplete-calibration session yields a neutral trace plus retained raw energies.

### US-008: Load Fixture Data

Priority: P1

As a developer or tester, I want to load sample data without driving so that the trace UI can be tested repeatedly.

Acceptance criteria:

- The app includes a fixture mode or sample JSON import.
- Fixture data contains at least 30 located audio windows.
- Fixture data includes low (smooth), mid (moderate), and high (rough) score examples that exercise the full CVD-safe scale.
- Verification: browser test confirms fixture mode renders without microphone or GPS permissions.

## Functional Requirements

### FR-001: Recording State

Priority: P0

The app must implement explicit recording states:

1. `idle`
2. `requesting_permissions`
3. `recording_baseline`
4. `recording`
5. `paused` (entered automatically on GPS non-motion; returns to `recording` or `recording_baseline` on motion)
6. `stopped`
7. `error`

A single session-controller module owns all transitions; no other module may mutate recording state. Legal transitions:

| From | Event | To |
|---|---|---|
| `idle` | Start pressed | `requesting_permissions` |
| `requesting_permissions` | both permissions granted | `recording_baseline` |
| `requesting_permissions` | either permission denied / unsupported API | `error` |
| `recording_baseline` | moving baseline reaches `WINDOW`-count for 30 s moving | `recording` |
| `recording_baseline` | speed ≤ stopped threshold for hold | `paused` |
| `recording` | speed ≤ stopped threshold for hold | `paused` |
| `paused` | speed > moving threshold, baseline complete | `recording` |
| `paused` | speed > moving threshold, baseline incomplete | `recording_baseline` |
| `recording_baseline` / `recording` | foreground lost (Page Visibility hidden) | `paused` (foreground-loss warning) |
| `paused` | foreground lost (Page Visibility hidden) | `paused` (foreground-loss warning added; no state change) |
| `paused` | foreground regained, streams still live | `recording` if baseline complete, else `recording_baseline` |
| `recording_baseline` / `recording` / `paused` | Deactivate pressed | `stopped` |
| `recording_baseline` / `recording` / `paused` | mic or GPS stream lost, or permission revoked mid-trip | `error` |
| `error` / `stopped` | Reset / clear | `idle` |

### FR-002: Audio Capture

Priority: P0

The app must use browser microphone APIs to capture live audio for analysis. The `getUserMedia` audio constraints must disable browser audio processing that would distort loudness measurement: `autoGainControl: false`, `noiseSuppression: false`, and `echoCancellation: false`. Automatic Gain Control in particular flattens the loudness differences the prototype is trying to measure, so leaving it on would corrupt every score.

### FR-003: Audio Analysis

Priority: P0

The app must calculate frequency-band energy locally in the browser using the band-energy definition in US-003 and the Scoring Formula, and discard raw audio buffers after analysis.

### FR-004: Location Capture

Priority: P0

The app must use browser geolocation APIs to collect timestamped latitude/longitude samples.

### FR-005: Data Pairing

Priority: P0

The app must pair audio windows and GPS samples by nearest timestamp, using a single epoch-millisecond clock base for both streams (see US-004).

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
- microphone or geolocation stream lost mid-trip
- microphone or location permission revoked by the OS mid-trip

For mid-trip stream loss or permission revocation, the app transitions to `error`, stops capture, preserves all audio windows and GPS samples captured so far, and still allows export of the partial session.

A recording shorter than the moving baseline period is not a hard error: it is handled as the incomplete-calibration flow in US-007 (neutral trace, tester notification, raw energies retained).

### FR-010: Test Fixture Mode

Priority: P1

The app must include fixture mode or sample JSON import so the trace UI can be tested without driving.

### FR-011: Safety Copy

Priority: P0

The app must state that recording should be started before driving or operated by a passenger. The app must not require interaction while driving.

### FR-012: Local Retention

Priority: P1

The app keeps the active session in browser memory during recording. Persisting a finished session to localStorage is optional and off by default for this prototype; when persistence is enabled and the storage quota is exceeded, the app must surface a non-fatal warning and keep the in-memory session intact. A clear control to delete any locally stored session data must always be available.

### FR-013: Trip Lifecycle

Priority: P0

The app must implement trip lifecycle using only the microphone and GPS:

- A manual deactivate (`Stop recording`) control is the only MVP trip-end signal.
- The app must automatically pause analysis when GPS speed indicates the vehicle is stopped, and resume when motion resumes (see US-002b).
- Phone-pickup detection as a trip-end signal is explicitly out of scope for the MVP and deferred (see Deferred Goals), because it requires accelerometer/DeviceMotion data that Non-Goals exclude.

## Data Model

Timestamp convention: every field used for pairing or ordering is stored as an integer of **epoch milliseconds** (suffix `_ms`), on the single clock base defined in US-004 / FR-005. Human-readable ISO-8601 fields, where present (e.g. `created_at`), are derived display copies and must not be used for pairing.

### Recording Session

```json
{
  "session_id": "uuid",
  "created_at_ms": 0,
  "created_at": "ISO-8601 display copy, derived from created_at_ms",
  "calibration_status": "complete | incomplete",
  "score_formula_version": "auditory-roughness-v0",
  "baseline": {
    "moving_duration_seconds": 30,
    "low_median": 0,
    "mid_median": 0,
    "high_median": 0,
    "energy_floor_min": 0,
    "effective_floor": { "low": 0, "mid": 0, "high": 0 }
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
  "started_at_ms": 0,
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
  "captured_at_ms": 0,
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
  "gps_captured_at_ms": 0,
  "location_status": "paired | missing",
  "latitude": 0,
  "longitude": 0,
  "auditory_roughness_score": 0,
  "color": "CVD-safe scale value mapped from auditory_roughness_score (e.g. cividis hex); neutral when calibration_status is incomplete"
}
```

## Scoring Formula

Formula version: `auditory-roughness-v0`

The first formula is intentionally simple. It is a prototype scoring function, not a validated sensory model.

Steps:

1. Analyze audio in one-second windows.
2. Calculate band energy for low, mid, and high bands using the definition in US-003.
3. Use the first 30 seconds of valid **moving** recording as the trip baseline (paused/stopped time excluded).
4. Apply an energy floor to each baseline median to prevent division by zero or score blow-ups when calibration happens in a near-silent car: `baseline_<band>_median = max(measured_median, ENERGY_FLOOR_MIN)`. `ENERGY_FLOOR_MIN` and the effective floor are defined and recorded per Tunable Constants → Scoring.
5. Calculate per-band deltas:

```text
low_delta = max(0, low_energy / baseline_low_median - 1)
mid_delta = max(0, mid_energy / baseline_mid_median - 1)
high_delta = max(0, high_energy / baseline_high_median - 1)
```

6. Calculate roughness:

```text
raw_score = (0.45 * low_delta) + (0.40 * mid_delta) + (0.15 * high_delta)
auditory_roughness_score = clamp(round(raw_score * 50), 0, 100)
```

Rationale:

- Low and mid bands are weighted highest because road rumble and coarse surface noise are likely to appear there.
- High band is included because hiss, tire noise, and sharp surface sounds may matter, but it is weighted lower for the first pass.
- Speed normalization is deferred until after sample data shows whether it is needed.

### Speed As A Measured Covariate

Speed is not unknown noise. `speed_mps` is captured on every GPS sample, so speed is a measured covariate, not a confounder to fear.

For v0:

- The baseline is time-based (the first 30 seconds of valid recording), not speed-conditioned. If the baseline is captured at a different speed than a scored segment, the band ratios carry a residual speed term.
- This is bounded and recoverable, not a dead end. A spike relative to a speed-conditioned expectation remains statistically meaningful, and aggregating across users at the same segment and speed bin separates the surface term from the speed term.

Deferred cheap fix (v2): condition the baseline on speed — bin baseline medians by speed band, or regress energy on `speed_mps` and score against the residual — so scores reflect surface harshness rather than how fast the trip was.

## Tunable Constants (v0 Defaults)

All load-bearing constants are defined here as the single source of truth. They are provisional v0 defaults, expected to be tuned after real sample review (see Open Questions); they must be named constants in code, not inline literals.

### Audio Analysis

- `FFT_SIZE` = 2048.
- `SMOOTHING_TIME_CONSTANT` = 0. Analyser smoothing must be off; like AGC, it averages across windows and corrupts per-window energy.
- `ASSUMED_SAMPLE_RATE_HZ` = 48000. The app must read the actual `AudioContext.sampleRate` and use it for bin→frequency mapping; if it differs from the assumed rate, the bands are computed from the actual rate (no hard failure).
- Band edges are lower-inclusive, upper-exclusive: low = [80, 250) Hz, mid = [250, 1000) Hz, high = [1000, 4000) Hz. A bin is assigned to the band containing its center frequency; an edge bin belongs to the higher band.
- `WINDOW_DURATION_MS` = 1000 (one analysis window). The window energy is the mean of per-frame band sums over all analyser frames captured in that interval.

### Scoring

- `ENERGY_FLOOR` is not a fixed literal: it is measured per session as the median band energy over the baseline window for each band, then a hard minimum `ENERGY_FLOOR_MIN` = 1e-6 (linear power, matching the US-003 sum) is applied so a silent baseline cannot produce a zero or near-zero denominator. The effective floor and `ENERGY_FLOOR_MIN` are both recorded in the session baseline.
- Score weights and scaling (`0.45 / 0.40 / 0.15`, `* 50`) are defined in the Scoring Formula and versioned by `score_formula_version`.

### Motion / Lifecycle

- `PAUSE_STOPPED_THRESHOLD_MPS` = 0.5 m/s — at or below this, the stop timer runs.
- `PAUSE_MOVING_THRESHOLD_MPS` = 1.5 m/s — above this, recording resumes. The gap from the stopped threshold is hysteresis.
- `PAUSE_HOLD_SECONDS` = 3 s — continuous sub-threshold speed required before entering `paused`.
- `null` `speed_mps` is treated as unknown: it never triggers pause.

### Pairing

- `PAIR_MAX_SKEW_SECONDS` = 5 s — an audio window pairs with the nearest GPS sample within ±5 s, else `location_status: "missing"`.
- One GPS sample may be reused by multiple audio windows. On an exact tie, the earlier GPS timestamp wins.

## Design & Technical Considerations

### Architecture

Prototype modules should stay separated:

- `audio-capture`: microphone stream and analysis windows
- `audio-scoring`: band energy and roughness score calculation
- `location-capture`: geolocation watch
- `sample-pairing`: timestamp pairing
- `trace-rendering`: map-like visualization
- `session-export`: JSON export
- `session-controller`: owns the FR-001 state machine and transitions

Each module exposes pure, independently testable functions where possible. Target ~100 lines per function with a hard limit of 300; decompose audio analysis, scoring, and pairing into separate functions rather than monoliths.

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

### Platform Constraints (v0)

The first pass is a browser foreground app. These constraints follow from what a mobile browser tab can and cannot do, and must be stated to testers:

- **Foreground-only.** Capture runs only while the SensoryNav tab is the foreground, visible tab. Backgrounding the tab or locking the screen suspends the microphone and geolocation streams; the browser cannot record in the background. The app must keep the screen awake with the Screen Wake Lock API while recording, and detect foreground loss via the Page Visibility API. On foreground loss the app enters `paused` with a visible foreground-loss warning (distinct from a motion pause); on return to foreground it auto-resumes if the streams are still live (to `recording` if the baseline is complete, else `recording_baseline`), and escalates to `error` per FR-009 only if a stream is confirmed lost. The foreground-loss warning clears on resume or on Deactivate. The tester must not switch to another app or tab mid-drive.
- **No concurrent turn-by-turn navigation.** The tester drives a route they already know; running a maps app's voice navigation at the same time both backgrounds the SensoryNav tab and contaminates the microphone with navigation audio. This is why concurrent-with-Maps use is out of scope for v0 (see Deferred Goals).
- **Mounted and charging.** Continuous microphone, geolocation, and screen-on use drains battery quickly; recommend a mounted, charging phone.
- **No basemap.** The trace is the GPS path on a blank canvas with no streets; testers orient by driving a known road (see Open Questions on map tiles).

### Accessibility

The prototype must:

- provide clear text status for recording state
- avoid auto-playing sound
- avoid flashing or rapid animation
- use semantic, screen-reader-reachable controls (real buttons with TalkBack/VoiceOver labels) for all primary controls
- present large, glanceable touch targets for the primary recording controls, suitable for one-handed use at a stop
- keep light/dark mode available

Primary controls are `Start recording` and `Stop recording`.

Should-have (preferred, not required for v0):

- offer a hands-free or voice-triggered start as the safer in-car interaction, complementing the no-interaction-while-driving safety rule

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

Scope note: this MVP is deliberately tiny — 1–2 testers driving a single known road with a clear rough/smooth contrast. The metrics below are sized to that reality, not to a public launch.

Prototype success:

- A tester can complete one recording session on a single known road without developer assistance.
- At least 30 located audio windows can be collected in a short drive.
- The exported JSON validates against the expected schema.
- The trace shows visible variation between smoother and harsher sections (qualitative product signal; treat a located-window score range of ≥ 30 points across a trip as the rough measurable proxy).
- The 1–2 testers can explain what the colors mean after using the prototype.

Product-learning success (the core signal this MVP exists to test):

- At least 1 tester says the concept reflects a real route-quality concern.
- At least 1 tester is willing to record another drive.
- At least 1 tester identifies a road segment where the score matches their felt experience — this is the make-or-break signal.

## Deferred Goals

These are intended for a later version, not the MVP. They are recorded here so the intent is not lost.

- **Phone-pickup trip-end detection.** Use accelerometer/DeviceMotion to detect that the user has picked up the phone, end the trip, and notify the tester that it ended because the phone was picked up (discouraging texting and driving). Deferred because it requires accelerometer data, which the MVP Non-Goals exclude. MVP trip-end is the manual deactivate control plus GPS-motion pause/resume (FR-013).
- **Speed-conditioned baseline.** Bin baseline medians by speed band, or regress energy on `speed_mps` and score against the residual, so scores reflect surface harshness rather than trip speed (see Scoring Formula → Speed As A Measured Covariate).
- **Native Android app with overlay-over-Maps.** A native app that records in the background via a foreground service (microphone service type) and surfaces a comfort HUD as a floating overlay (`SYSTEM_ALERT_WINDOW`) on top of a navigation app like Google Maps. This is the bridge from the browser concept-validation prototype to the "sensory accommodation layer *for maps*" product vision. Browsers cannot draw system overlays over other apps or sustain background capture, so this is a deliberate post-MVP platform step, gated on the browser MVP validating the core signal first.

## Open Questions

These questions do not block the first prototype:

1. Which frequency bands best match lived sensory discomfort after real sample review?
2. Should speed normalization be added in prototype v2?
3. When should real map tiles replace the trace-only view?
4. What privacy explanation belongs on the public landing page versus inside the prototype?
5. How should known smooth/rough roads be used for future calibration?

