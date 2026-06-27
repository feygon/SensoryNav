# SensoryNav Ingestion Harness — SP1: Audio Front-End — Design Spec

**Status:** READY — passed the Requirements Rubric gate (R1 = 40/45 → R2 = 44/45; no critical/high/open should-fix). Cleared for `writing-plans`.
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

**Function size (NFR-1):** each function targets **≤ ~100 lines**, with **300 lines a hard block**. `framesToWindows` MUST decompose into focused helpers — at minimum `stft(samples, sampleRate)` (frame→per-frame band energies), `assignFramesToWindows(frameEnergies, sampleRate)` (frame-center → window grouping), and `windowRmsAndClip(samples, sampleRate)` (single-pass time-domain stats) — so no function approaches the block limit.

**Window-duration invariant (NFR-2):** all window math is expressed in terms of `samplesPerWindow = round(sampleRate · WINDOW_DURATION_MS / 1000)` and `WINDOW_DURATION_MS`, never in bare "whole seconds." The formulas in §5 are correct for any `WINDOW_DURATION_MS`, not only 1000.

---

## 3. Inputs

1. **The pass WAV** — produced by this project's capture page: canonical 44-byte header, PCM (`audioFormat = 1`), **mono**, **16-bit**, little-endian, `data` chunk at byte 36 / payload at byte 44.
2. **`audio_first_frame_ms`** — from the sidecar; the epoch-ms timestamp of the first audio frame. Used as `t0` so window timestamps share the GPS epoch clock.
3. **`sample_rate`** — from the sidecar; cross-checked against the WAV header (mismatch is flagged).

SP1's core units are **pure functions over bytes/samples**. Reading the two files from disk is a thin loader module (`harness/audio/load-pass.js`, see §4.1) that is part of SP1; it owns the WAV-vs-sidecar `sample_rate` cross-check and is used by the smoke test. (This resolves former open question Q3: the loader lives in SP1, not deferred to SP3.)

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
  - **Input contract:** `frame.length` MUST equal `FFT_SIZE` (2048). `realFftDb` **throws** on any other length — it does **no internal zero-padding**. (The caller is responsible for framing; the STFT drops any trailing slice shorter than `FFT_SIZE` — see §5.)
  - Internally: apply a **Hann** window, run a radix-2 Cooley–Tukey FFT (2048 = 2¹¹), compute magnitude per bin, return **`20·log10(max(magnitude, EPS))`** dB.
  - **Output length and bin indexing:** exactly `FFT_SIZE/2 = 1024` values, for bins `0 … 1023`. Bin 0 (**DC**) **is included**; the Nyquist bin (index 1024) is **excluded**. Bin `k` corresponds to frequency `k · sampleRate / FFT_SIZE`, matching `bandEnergiesFromSpectrum` (which iterates `binCount = floor(fftSize/2)` over `i · sampleRate/fftSize`).
  - Magnitude normalization: `magnitude_k = |X_k| / FFT_SIZE` (the `AnalyserNode` convention). `EPS = 1e-9` guards `log10(0)` **only inside the dB transform**; it is a different constant for a different purpose than `ENERGY_FLOOR_MIN`/`NEAR_FLOOR_K` (which gate the band-power `near_floor` decision in §5). The two are independent and not interchangeable.
  - **dB convention is fixed by the consumer, not by AnalyserNode fidelity.** `bandEnergiesFromSpectrum` applies `10^(dB/10)` to recover power; feeding it `20·log10(magnitude)` yields `magnitude²` (linear power), which is the intended quantity. The normalization constant and Hann scaling are global and cancel in the roughness ratio.

- **`harness/audio/audio-windows.js`** — the orchestrator.
  - `framesToWindows(samples, sampleRate, audioFirstFrameMs) → Array<Window>`
  - Consumes `realFftDb` and the existing core `bandEnergiesFromSpectrum` / `averageWindowEnergies`. Decomposed into the helpers named in NFR-1.

- **`harness/audio/load-pass.js`** — the thin disk loader (part of SP1).
  - `loadPass(wavPath, sidecarPath) → { windows, sampleRate, warnings }`
  - Reads the WAV bytes and the JSON sidecar, calls `decodeWav` and `framesToWindows(samples, sampleRate, sidecar.audio_first_frame_ms)`, and **cross-checks** the WAV's `sampleRate` against the sidecar `sample_rate`, pushing a non-fatal string into `warnings` on mismatch (it does not throw). This is the module that owns the §7 rate-mismatch flag.

### 4.2 Reuse surface (from `recorder/`)

- `constants.js`: `FFT_SIZE` (2048), `BANDS`, `WINDOW_DURATION_MS` (1000), `ENERGY_FLOOR_MIN` (1e-6), `ASSUMED_SAMPLE_RATE_HZ` (48000).
- `audio-scoring.js`: `bandEnergiesFromSpectrum(freqDataDb, sampleRate, fftSize)`, `averageWindowEnergies(frameEnergies)`, `bandForFrequency`.

Everything else in SP1 (decoder, FFT, framing, RMS, quality flags) is net-new.

---

## 5. Data flow

Let `samplesPerWindow = round(sampleRate · WINDOW_DURATION_MS / 1000)` (= 48000 at 48 kHz / 1000 ms).

```
WAV bytes
  → decodeWav → { sampleRate, samples }
  → STFT: frameSize = FFT_SIZE (2048), Hann window, hop = 1024 (50% overlap)
        number of frames = floor((sampleCount − FFT_SIZE) / hop) + 1, for sampleCount ≥ FFT_SIZE
        any trailing slice shorter than FFT_SIZE is DROPPED (realFftDb requires a full frame)
        per frame:
          realFftDb(frame) → dB spectrum (1024 bins)
          bandEnergiesFromSpectrum(dB, sampleRate, FFT_SIZE) → { low, mid, high }
          frame center sample = frameStart + FFT_SIZE/2
  → assign each frame to windowIndex = floor(frameCenterSample / samplesPerWindow)
        (i.e. by the frame's center time; correct for any WINDOW_DURATION_MS — NFR-2)
  → per window i:
          { low, mid, high } = averageWindowEnergies(frames in window i)
          windowSamples= samples in [i·samplesPerWindow, (i+1)·samplesPerWindow) (trailing window: remainder)
          rms          = sqrt(mean(sample² over windowSamples))
          clip_fraction= count(|sample| ≥ CLIP_THRESHOLD) / windowSamples.length   // denom = THIS window's count
          near_floor   = max(low, mid, high) < NEAR_FLOOR_K · ENERGY_FLOOR_MIN
          frame_count  = number of frames assigned
  → Array<Window>
```

`rms`, `clip_fraction`, and the clip count are accumulated in the **same single pass** over `samples` (nearly free).

### 5.1 Window timestamp mapping and array shape

- `started_at_ms = audio_first_frame_ms + windowIndex · WINDOW_DURATION_MS`.
- A frame belongs to `windowIndex = floor(frameCenterSample / samplesPerWindow)` (NFR-2; reduces to whole-seconds only because `WINDOW_DURATION_MS = 1000`, but the formula does not hardcode that).
- RMS / clip statistics for window `i` are computed over raw samples in `[i·samplesPerWindow, (i+1)·samplesPerWindow)`; the trailing window uses whatever samples remain, and `clip_fraction`'s denominator is that window's **actual** sample count (not `samplesPerWindow`).
- **Array shape (contiguity guarantee):** the returned array is ordered by ascending `windowIndex` with **no gaps** — every index from `0` to the last kept window is present exactly once, so `started_at_ms` values are contiguous at `WINDOW_DURATION_MS` spacing. A window that legitimately received **zero frames** is still emitted (with `frame_count = 0`, zero energies); only the trailing partial window below `PARTIAL_MIN_COVERAGE_S` is omitted (always the final index). SP3 can therefore rely on contiguous spacing.
- **Boundary handling (reviewed, negligible):** a frame straddling a one-second boundary is counted whole in the window its center falls in. With ~46 frames averaged per window this is ≤ ~2 %, and the 50 % overlap further softens it — the adjacent overlapping frame, centered just past the boundary, carries the same boundary-region energy into the next window (overlap *reduces* the edge effect rather than enlarging it). Note that band energies are partitioned by **frame center** while RMS/clip are partitioned by **exact sample range**; this is a deliberate, same-order-negligible difference — band energy is inherently frame-quantized (no sub-frame FFT), RMS is sample-exact — not an inconsistency.

---

## 6. Output — the SP1 → SP2/SP3 interface

`framesToWindows` returns an array of:

```js
{
  window_id:      "w0",      // "w" + windowIndex; indices are contiguous (no gaps)
  started_at_ms:  Number,    // epoch ms, anchored to audio_first_frame_ms
  duration_ms:    Number,    // WINDOW_DURATION_MS for full windows; for a kept partial
                             //   trailing window: round(windowSamples.length / sampleRate * 1000)
  frame_count:    Number,    // FFT frames averaged into this window (0 for a zero-frame window)
  low_energy:     Number,    // linear power (mag²), averaged over frames
  mid_energy:     Number,
  high_energy:    Number,
  rms:            Number,     // time-domain RMS over the window's raw samples [0..1]
  clip_fraction:  Number,     // 0..1, fraction of full-scale samples
  near_floor:     Boolean     // window too quiet to score meaningfully
}
```

This object is intentionally a **superset** of what SP3's roughness step needs (`{low,mid,high}_energy`, `started_at_ms`, `duration_ms`), so SP3 can consume it directly while the extra fields feed RMS cross-reference (SP2/SP3) and the reliability model.

Note for consumers: a **zero-frame** window (`frame_count === 0`, only possible at a boundary) still carries a real `rms` computed from its raw samples — those samples exist even when no frame *center* lands in the window. So `frame_count === 0` gates the band energies (which are `0`), **not** `rms`.

---

## 7. Validation, edges, and error handling

**Decoder (throws `Error` with a specific message):**
- Missing/!= `RIFF`, `WAVE`, `fmt `, or `data` tags at canonical offsets → throw (we decode only our own files; no chunk-scanning).
- `audioFormat != 1` → throw (`"unsupported WAV: expected PCM"`).
- `channels != 1` → throw (`"unsupported WAV: expected mono"`).
- `bitsPerSample != 16` → throw (`"unsupported WAV: expected 16-bit"`).
- Declared `data` size exceeding the byte length → throw (truncated file).

**Decoder layout — reviewed decision (fixed-offset, loud-fail).** WAV files from other encoders/OSes, or files re-saved through an audio editor, frequently insert chunks (`LIST`/`INFO`/`fact`/`JUNK`) between `fmt ` and `data`, or use an 18/40-byte `fmt ` chunk — which a fixed-offset parser cannot read. This does **not** apply to files our own capture page produces: `encodeWav` hand-builds the canonical 44-byte header and the page wraps those exact bytes in a passthrough `Blob` (the browser never re-encodes), so there is no path by which a capture acquires extra chunks. The one realistic exception — opening a capture in an editor and re-saving — is **out of this project's workflow** (we never edit captures). We therefore keep the simple fixed-offset decode, guarded by loud validation: a non-canonical layout **throws a descriptive error** (`data` tag absent at offset 36, etc.) rather than mis-decoding, so the worst case is an obvious failure, never silent corruption. If an editor-round-trip or third-party-WAV need ever arises, the upgrade is small and additive — walk the RIFF subchunks by id (skipping unknown chunks, honoring pad bytes, accepting `fmt ` sizes 16/18/40) while keeping the same PCM/mono/16-bit enforcement.

**Orchestrator / loader:**
- `sampleRate` (from WAV) ≠ sidecar `sample_rate`: the pure `framesToWindows` always trusts the WAV's own `sampleRate` (so band math is never silently corrupted — `bandEnergiesFromSpectrum` is given the WAV rate). The **`load-pass.js` loader** (§4.1, part of SP1) compares WAV rate against the sidecar `sample_rate` and pushes a non-fatal string into its `warnings` array; it does not throw.
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
- **`fft` input contract:** `realFftDb` throws on a frame whose length ≠ `FFT_SIZE`; output array length is exactly 1024; bin 0 (DC) is populated.
- **`audio-windows`**: synthetic 2 s mid-tone → exactly 2 windows, `mid ≫ low,high`, correct `started_at_ms` from a given `audio_first_frame_ms`, correct `frame_count`; silence → `near_floor = true`, `rms ≈ 0`; a full-scale square/clipped buffer → `clip_fraction` near 1 and correct `rms`; a 2.4 s tone → 2 full windows, the trailing 0.4 s **dropped** (< 0.5 s); a 2.6 s tone → 2 full windows + 1 kept partial with `duration_ms === round(0.6·sampleRate / sampleRate * 1000) === 600` (exact); sub-frame input (< `FFT_SIZE` samples) → empty array; array indices are **contiguous** (assert `window_id` sequence `w0,w1,…` with no gaps).
- **`windowIndexFor(frameCenterSample, samplesPerWindow)` helper (NFR-2):** with `samplesPerWindow = 100`, assert center 0 → 0, 99 → 0, 100 → 1, 250 → 2 — proving the index formula is correct for a window size other than 48000, i.e. not hardcoded to whole seconds.
- **`load-pass` (FR-9):** a sidecar whose `sample_rate` disagrees with the WAV header yields a non-empty `warnings` array and still returns windows (no throw); the real captured pass loads with empty `warnings`.
- **Mechanics smoke test:** run `framesToWindows` over the real captured `.wav` (`data/johnson-creek-pass-1-163508.wav`, 1 204 352 samples @ 48 000 Hz) and assert it yields **exactly 25 windows** (`w0…w24`; the trailing 1 204 352 − 25·48 000 = 4 352 samples ≈ 0.091 s < 0.5 s is dropped) with finite energies/RMS and strictly increasing timestamps spaced `WINDOW_DURATION_MS` apart. **This file is desktop-mic audio only (no engine/road noise) — it validates mechanics, NOT roughness semantics.**

---

## 10. Success criteria

- **SC-1** — Given a capture `.wav` and its `audio_first_frame_ms`, SP1 returns a deterministic window series with correct counts, epoch-anchored timestamps, and band energies that respond correctly to known tones.
- **SC-2** — `encodeWav` → `decodeWav` round-trips within int16 quantization.
- **SC-3** — `rms`, `clip_fraction`, and `near_floor` are present and correct on synthetic inputs.
- **SC-4** — No dependencies; the full Node suite (existing 17 files + the new SP1 tests) passes.
- **SC-5** — Runs cleanly over the real captured pass (mechanics; exactly 25 windows).

---

## 11. Requirements and traceability

Normative requirements, each mapped to the section that defines it and the test that verifies it (closes the test↔requirement mapping):

| ID | Requirement | Defined | Verified by |
|---|---|---|---|
| FR-1 | `decodeWav` decodes canonical PCM/mono/16-bit; throws a specific `Error` on every deviation in §7 | §4.1, §7 | `wav-decoder` malformed-header cases |
| FR-2 | encode→decode round-trips within int16 quantization (`0, ±0.5, ±1.0`), at 48000 and 44100 | §4.1 | `wav-decoder` round-trip |
| FR-3 | `realFftDb`: Hann + radix-2 FFT → 1024-bin `20·log10(|X|/N)` dB; **throws** on frame length ≠ `FFT_SIZE`; DC bin included, Nyquist excluded | §4.1 | `fft` (tones, DC, length-throw) |
| FR-4 | STFT frames at 2048/hop 1024; trailing slice < `FFT_SIZE` dropped; sub-frame audio → empty array | §5, §7 | `audio-windows` (`frame_count`, sub-frame→empty) |
| FR-5 | Frames grouped by center via `floor(center / samplesPerWindow)`; array contiguous (no gaps); zero-frame windows emitted; trailing partial < `PARTIAL_MIN_COVERAGE_S` dropped | §5, §5.1 | `audio-windows` (2.4 s drop, 2.6 s keep, contiguity) |
| FR-6 | Per-window band energies via `bandEnergiesFromSpectrum` + `averageWindowEnergies`; a tone lands in the correct band | §5 | `fft`/`audio-windows` tone tests |
| FR-7 | Per-window `rms`, `clip_fraction` (denominator = that window's own sample count), `near_floor` | §5 | `audio-windows` (silence, clipped) |
| FR-8 | `started_at_ms` epoch-anchored; `duration_ms` = `WINDOW_DURATION_MS` (full) or `round(windowSamples/sampleRate·1000)` (partial) | §5.1, §6 | `audio-windows` (timestamps, 2.6 s → `duration_ms === 600`) |
| FR-9 | `load-pass.js` reads WAV + sidecar, cross-checks `sample_rate` → non-fatal `warnings`, never throws on mismatch | §4.1, §7 | `load-pass` (mismatch warning, real-file smoke) |
| NFR-1 | Function size ≤ ~100 target / 300 hard block; `framesToWindows` decomposed into named helpers | §2 | review + `windowIndexFor` helper unit (§9) |
| NFR-2 | All window math uses `samplesPerWindow`/`WINDOW_DURATION_MS`, correct for any window duration (not hardcoded to 1000) | §2, §5 | `windowIndexFor(center, samplesPerWindow)` unit with a non-48000 `samplesPerWindow` (§9) |
| NFR-3 | No dependencies; vanilla JS; full Node suite green | §2 | `npm test` |

### 11.1 Resolved decisions (formerly open questions)

1. **`NEAR_FLOOR_K` = 10** ships as a flagged default (§8) and is **calibrated against real road captures later**; it is scale-dependent on the FFT normalization and is not claimed to be final. *(Resolved: ship-and-calibrate.)*
2. **Overlap = 50 %** (hop 1024). *(Resolved: 50 % for the first cut; steadier energy, free offline.)*
3. **Loader placement:** the thin file loader **is part of SP1** as `harness/audio/load-pass.js` and owns the `sample_rate` cross-check. *(Resolved; reflected in §3, §4.1, §7.)*
4. **SP2/SP3 pull-forward:** none required. The window object already carries `rms` and the quality flags the reliability model and speed-RMS cross-reference need; SP2/SP3 add fields to their *own* outputs, not to SP1's. *(Resolved: no re-cut anticipated.)*
