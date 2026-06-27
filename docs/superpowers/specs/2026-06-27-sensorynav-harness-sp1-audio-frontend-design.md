# SensoryNav Ingestion Harness — SP1: Audio Front-End — Design Spec

**Status:** Draft for review (brainstorming output; not yet through the Requirements Rubric gate).
**Date:** 2026-06-27
**Scope:** SP1 only. SP2 (speed/motion track) and SP3 (scorer) are deferred and described here only as context.

---

## 1. Where SP1 fits (context, not scope)

The ingestion harness turns each captured drive pass (`.wav` + `sensorynav-capture-v1` JSON sidecar) into per-second roughness scores paired to GPS position, so computed roughness can be validated against **felt** experience on a known road (Johnson Creek Rd). The full apparatus decomposes into three composable sub-projects, each with its own spec → plan → build cycle:

- **SP1 — Audio front-end** *(this spec; pure, no GPS)*: decode WAV → FFT → 1 s windows → per-window feature series.
- **SP2 — Speed & motion track** *(deferred)*: fuse native GPS `speed_mps` + inverse-accuracy-weighted positions + a bounded-acceleration prior into a smooth `speed(t)`, heading, and per-window speed confidence. A later refinement layer adds an **audio engine-RPM cue** as a *boolean accel-vs-decel onset* signal (gear changes decouple RPM from acceleration magnitude, so RPM is a sign indicator only); this layer is gas-car-specific and best designed against real captures.
- **SP3 — Scorer** *(deferred)*: fit a **per-vehicle, speed-conditioned lower-envelope baseline** (low-quantile regression of band energy vs. speed) → roughness per window as the residual above that floor → reliability model → Session output + per-window inspection table + batch over passes.

### The conceptual model (why SP1's choices are safe)

Roughness is **ratio-based**: a window's score is how far its band energy sits *above a fitted floor*, and that floor is estimated from the pass's own data (per vehicle, per speed). Because every quantity is a ratio to a self-derived floor, **any constant multiplicative scaling of the spectrum cancels.** Consequence for SP1: the FFT does **not** need bit-fidelity to the browser `AnalyserNode` that the live app used. A clean, self-consistent FFT is sufficient. This removes the one genuine unknown from SP1.

---

## 2. SP1 purpose and boundaries

**Purpose:** Given the raw audio of one pass, produce a deterministic, node-testable series of 1-second windows carrying the spectral features for roughness scoring, a broadband RMS, and the audio-quality flags that feed the reliability model.

**In scope:**
- Decode our own canonical WAV files to float PCM.
- Short-time FFT → per-band energies via the existing scoring core.
- Group frames into 1 s windows anchored to the capture's epoch clock.
- Per-window broadband RMS and audio-quality flags (clipping, near-floor, coverage).

**Out of scope (deferred to SP2/SP3 or later):** any GPS handling, speed estimation, baseline/floor fitting, roughness scoring, the audio engine-RPM cue, the live on-device HUD, and decoding arbitrary third-party WAV files.

**Non-functional:** vanilla JS, **no dependencies**, Node `assert` test scripts (consistent with the repo). Offline batch processing on a desktop — there is **no real-time/on-device budget**; a few 2-mile passes is a few MB and completes in well under a second. SP1's output is shaped so RMS/flags can be dropped trivially if a future live-HUD phase needs a leaner path.

---

## 3. Inputs

1. **The pass WAV** — produced by this project's capture page: canonical 44-byte header, PCM (`audioFormat = 1`), **mono**, **16-bit**, little-endian, `data` chunk at byte 36 / payload at byte 44.
2. **`audio_first_frame_ms`** — from the sidecar; the epoch-ms timestamp of the first audio frame. Used as `t0` so window timestamps share the GPS epoch clock.
3. **`sample_rate`** — from the sidecar; cross-checked against the WAV header (mismatch is flagged).

SP1's core units are **pure functions over bytes/samples**. Reading the two files from disk is a thin wrapper (a few lines); it is included for the smoke test but carries no logic worth isolating.

---

## 4. Architecture

New directory `harness/audio/` (keeps the offline harness separate from the in-browser `recorder/` core it reuses via `require`).

### 4.1 Modules

- **`harness/audio/wav-decoder.js`**
  - `decodeWav(bytes) → { sampleRate, channels, bitDepth, sampleCount, samples }`
  - `bytes` is a `Uint8Array`/`Buffer`; `samples` is a `Float32Array`.
  - Validates the header and **throws** a descriptive `Error` on any deviation (see §7).
  - int16 → float uses the inverse of the encoder's asymmetric rule: `sample = int16 < 0 ? int16 / 0x8000 : int16 / 0x7fff`, so `32767 → 1.0`, `-32768 → -1.0` and an encode→decode round-trip is exact to within int16 quantization.

- **`harness/audio/fft.js`**
  - `realFftDb(frame) → Float32Array(length fftSize/2)`
  - `frame` is a `Float32Array` of length `FFT_SIZE` (2048). Internally: apply a **Hann** window, run a radix-2 Cooley–Tukey FFT (2048 = 2¹¹), compute magnitude per bin, return **`20·log10(max(magnitude, EPS))`** dB for bins `0 … fftSize/2 − 1`.
  - Magnitude normalization: `magnitude_k = |X_k| / FFT_SIZE` (the `AnalyserNode` convention). `EPS = 1e-9` guards `log10(0)`.
  - **dB convention is fixed by the consumer, not by AnalyserNode fidelity.** `bandEnergiesFromSpectrum` applies `10^(dB/10)` to recover power; feeding it `20·log10(magnitude)` yields `magnitude²` (linear power), which is the intended quantity. The normalization constant and Hann scaling are global and cancel in the roughness ratio.

- **`harness/audio/audio-windows.js`** — the orchestrator.
  - `framesToWindows(samples, sampleRate, audioFirstFrameMs) → Array<Window>`
  - Consumes `realFftDb` and the existing core `bandEnergiesFromSpectrum` / `averageWindowEnergies`.

### 4.2 Reuse surface (from `recorder/`)

- `constants.js`: `FFT_SIZE` (2048), `BANDS`, `WINDOW_DURATION_MS` (1000), `ENERGY_FLOOR_MIN` (1e-6), `ASSUMED_SAMPLE_RATE_HZ` (48000).
- `audio-scoring.js`: `bandEnergiesFromSpectrum(freqDataDb, sampleRate, fftSize)`, `averageWindowEnergies(frameEnergies)`, `bandForFrequency`.

Everything else in SP1 (decoder, FFT, framing, RMS, quality flags) is net-new.

---

## 5. Data flow

```
WAV bytes
  → decodeWav → { sampleRate, samples }
  → STFT: frameSize = FFT_SIZE (2048), Hann window, hop = 1024 (50% overlap)
        per frame:
          realFftDb(frame) → dB spectrum (1024 bins)
          bandEnergiesFromSpectrum(dB, sampleRate, FFT_SIZE) → { low, mid, high }
          frame center sample = frameStart + FFT_SIZE/2
  → assign each frame to window index = floor(frameCenterSample / sampleRate)
        (i.e. by the frame's center time, in whole seconds from t0)
  → per window:
          { low, mid, high } = averageWindowEnergies(frames in this window)
          rms          = sqrt(mean(sample² over the window's raw samples))
          clip_fraction= count(|sample| ≥ 0.999) / (samples in window)
          near_floor   = max(low, mid, high) < NEAR_FLOOR_K · ENERGY_FLOOR_MIN
          frame_count  = number of frames assigned
  → Array<Window>
```

`rms`, `clip_fraction`, and the clip count are accumulated in the **same single pass** over `samples` (nearly free).

### 5.1 Window timestamp mapping

- `started_at_ms = audio_first_frame_ms + windowIndex · WINDOW_DURATION_MS`.
- A frame belongs to `windowIndex = floor(frameCenterSample / sampleRate)`.
- RMS / clip statistics for window `i` are computed over raw samples in `[i·sampleRate, (i+1)·sampleRate)` (the trailing window uses whatever samples remain).
- **Boundary handling (reviewed, negligible):** a frame straddling a one-second boundary is counted whole in the window its center falls in. With ~46 frames averaged per window this is ≤ ~2 %, and the 50 % overlap further softens it — the adjacent overlapping frame, centered just past the boundary, carries the same boundary-region energy into the next window (overlap *reduces* the edge effect rather than enlarging it). Note that band energies are partitioned by **frame center** while RMS/clip are partitioned by **exact sample range**; this is a deliberate, same-order-negligible difference — band energy is inherently frame-quantized (no sub-frame FFT), RMS is sample-exact — not an inconsistency.

---

## 6. Output — the SP1 → SP2/SP3 interface

`framesToWindows` returns an array of:

```js
{
  window_id:      "w0",      // "w" + windowIndex
  started_at_ms:  Number,    // epoch ms, anchored to audio_first_frame_ms
  duration_ms:    Number,    // 1000, or actual ms for a kept partial trailing window
  frame_count:    Number,    // FFT frames averaged into this window
  low_energy:     Number,    // linear power (mag²), averaged over frames
  mid_energy:     Number,
  high_energy:    Number,
  rms:            Number,     // time-domain RMS over the window's raw samples [0..1]
  clip_fraction:  Number,     // 0..1, fraction of full-scale samples
  near_floor:     Boolean     // window too quiet to score meaningfully
}
```

This object is intentionally a **superset** of what SP3's roughness step needs (`{low,mid,high}_energy`, `started_at_ms`, `duration_ms`), so SP3 can consume it directly while the extra fields feed RMS cross-reference (SP2/SP3) and the reliability model.

---

## 7. Validation, edges, and error handling

**Decoder (throws `Error` with a specific message):**
- Missing/!= `RIFF`, `WAVE`, `fmt `, or `data` tags at canonical offsets → throw (we decode only our own files; no chunk-scanning).
- `audioFormat != 1` → throw (`"unsupported WAV: expected PCM"`).
- `channels != 1` → throw (`"unsupported WAV: expected mono"`).
- `bitsPerSample != 16` → throw (`"unsupported WAV: expected 16-bit"`).
- Declared `data` size exceeding the byte length → throw (truncated file).

**Decoder layout — reviewed decision (fixed-offset, loud-fail).** WAV files from other encoders/OSes, or files re-saved through an audio editor, frequently insert chunks (`LIST`/`INFO`/`fact`/`JUNK`) between `fmt ` and `data`, or use an 18/40-byte `fmt ` chunk — which a fixed-offset parser cannot read. This does **not** apply to files our own capture page produces: `encodeWav` hand-builds the canonical 44-byte header and the page wraps those exact bytes in a passthrough `Blob` (the browser never re-encodes), so there is no path by which a capture acquires extra chunks. The one realistic exception — opening a capture in an editor and re-saving — is **out of this project's workflow** (we never edit captures). We therefore keep the simple fixed-offset decode, guarded by loud validation: a non-canonical layout **throws a descriptive error** (`data` tag absent at offset 36, etc.) rather than mis-decoding, so the worst case is an obvious failure, never silent corruption. If an editor-round-trip or third-party-WAV need ever arises, the upgrade is small and additive — walk the RIFF subchunks by id (skipping unknown chunks, honoring pad bytes, accepting `fmt ` sizes 16/18/40) while keeping the same PCM/mono/16-bit enforcement.

**Orchestrator:**
- `sampleRate` (from WAV) ≠ sidecar `sample_rate`: the pure `framesToWindows` always trusts the WAV's own `sampleRate` (so band math is never silently corrupted — `bandEnergiesFromSpectrum` is given the WAV rate). The *loader wrapper* compares WAV rate against the sidecar `sample_rate` and surfaces a non-fatal warning/flag; it does not throw.
- **Trailing partial window:** kept only if it has ≥ 0.5 s of samples (`PARTIAL_MIN_COVERAGE_S`), with its real `duration_ms` and `frame_count`; otherwise dropped.
- **Empty / sub-frame audio** (fewer than `FFT_SIZE` samples): returns an empty array (no frames, no windows).
- A window that received **zero frames** (possible only at boundaries) gets `{low,mid,high} = 0` from `averageWindowEnergies` and `frame_count = 0`; consumers can treat `frame_count = 0` as unscored.

---

## 8. Tunable defaults (flagged; not load-bearing for the architecture)

| Name | Default | Notes |
|---|---|---|
| Frame overlap (hop) | 50 % (hop 1024) | Steadier per-window energy than non-overlapping; free offline. |
| Hann window | yes | Standard STFT taper; constant scaling cancels in the ratio. |
| `CLIP_THRESHOLD` | `|sample| ≥ 0.999` | Full-scale detection. |
| `NEAR_FLOOR_K` | 10 | `near_floor` when max band energy `< 10 · ENERGY_FLOOR_MIN`. **Scale-dependent on the FFT normalization; expected to need calibration against real road captures.** |
| `PARTIAL_MIN_COVERAGE_S` | 0.5 | Keep the trailing window only above this. |
| `EPS` (dB floor) | 1e-9 | Guards `log10(0)`. |

---

## 9. Testing strategy (Node `assert`, no deps)

- **`wav-decoder`**: round-trip `encodeWav` → `decodeWav` recovers samples within int16 quantization for known vectors (incl. `0, ±0.5, ±1.0`); header fields (`sampleRate`, `channels`, `bitDepth`, `sampleCount`) correct; each malformed-header case (§7) throws the expected message; parametrized over 48000 and 44100.
- **`fft`**: DC input → energy only in bin 0; a unit sine at a bin-center frequency → energy concentrated in that bin and negligible elsewhere; a 500 Hz tone → `bandEnergiesFromSpectrum` puts the energy in **mid**, ~0 in low/high; a 150 Hz tone → **low**; a 2 kHz tone → **high**; Parseval-style sanity (windowed energy is finite and positive).
- **`audio-windows`**: synthetic 2 s mid-tone → exactly 2 windows, `mid ≫ low,high`, correct `started_at_ms` from a given `audio_first_frame_ms`, correct `frame_count`; silence → `near_floor = true`, `rms ≈ 0`; a full-scale square/clipped buffer → `clip_fraction` near 1 and correct `rms`; a 2.4 s tone → 2 full windows, the trailing 0.4 s **dropped** (< 0.5 s); a 2.6 s tone → 2 full windows + 1 kept partial (`duration_ms ≈ 600`); sub-frame input (< `FFT_SIZE` samples) → empty array.
- **Mechanics smoke test:** run `framesToWindows` over the real captured `.wav` (`data/johnson-creek-pass-1-163508.wav`) and assert it yields ~25 windows with finite energies/RMS and monotonic timestamps. **This file is desktop-mic audio only (no engine/road noise) — it validates mechanics, NOT roughness semantics.**

---

## 10. Success criteria

1. Given a capture `.wav` and its `audio_first_frame_ms`, SP1 returns a deterministic window series with correct counts, epoch-anchored timestamps, and band energies that respond correctly to known tones.
2. `encodeWav` → `decodeWav` round-trips within int16 quantization.
3. RMS, `clip_fraction`, and `near_floor` are present and correct on synthetic inputs.
4. No dependencies; the full Node suite (existing 17 files + the new SP1 tests) passes.
5. Runs cleanly over the real captured pass (mechanics).

---

## 11. Open questions for review

1. **`NEAR_FLOOR_K`** is scale-dependent on the FFT normalization and is a guess until we see real road captures — acceptable to ship as a flagged default and calibrate later?
2. **Overlap**: 50 % is the recommended default; any reason to prefer non-overlapping for the first cut?
3. **Loader placement**: the thin "read both files + cross-check sample_rate" wrapper — keep it as a tiny SP1 convenience, or defer entirely to SP3's orchestrator? (Spec currently treats it as a thin convenience used by the smoke test.)
4. Anything in the **deferred SP2/SP3 context** that should be pulled forward into SP1's output now to avoid a re-cut later?
