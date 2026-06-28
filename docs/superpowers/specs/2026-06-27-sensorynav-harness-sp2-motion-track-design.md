# SensoryNav Ingestion Harness — SP2: Speed & Motion Track — Design Spec

**Status:** Draft for review (brainstorming output; not yet through the Requirements Rubric gate).
**Date:** 2026-06-27
**Scope:** SP2 only. SP1 (audio front-end) is built and merged; SP3 (scorer) is deferred and described here only as the consumer.

---

## 1. Where SP2 fits (context, not scope)

The ingestion harness turns each captured drive pass (`.wav` + `sensorynav-capture-v1` JSON sidecar) into per-second roughness scores paired to GPS position. Three sub-projects:

- **SP1 — Audio front-end** *(done, on `main`)*: decode WAV → STFT → per-1-second-window band energies + RMS + audio-quality flags. Output records carry `window_id` and `started_at_ms` on a fixed 1 s grid (`started_at_ms = audio_first_frame_ms + i·1000`).
- **SP2 — Speed & motion track** *(this spec)*: fuse the sidecar's GPS fixes into a smooth per-window speed + heading + confidence, aligned to SP1's window grid.
- **SP3 — Scorer** *(deferred)*: fit the per-vehicle, speed-conditioned lower-envelope baseline (roughness = residual above the floor for the window's speed), using SP2's speed as the x-axis and SP2's `speed_confidence` as a weight; pair to position with direction.

### The model and why this fusion

GPS fixes are sparse (~1 Hz), irregular (one real pass had two fixes 25 ms apart then a 16 s gap), vary in accuracy (5–200 m+), and sometimes report `speed_mps: null` (no Doppler). The scorer needs, per 1 s window, a **smooth speed** (the baseline's x-axis) and a **heading** (for direction — the same road point can be smooth one way, rough the other), plus a **trust weight**.

Velocity in a car is the integral of acceleration, so the true motion is intrinsically smooth. We exploit that with a **constant-velocity Kalman filter + RTS (Rauch–Tung–Striebel) smoother** over 2-D position, weighting each fix by its accuracy (`R = accuracy²`) and bridging gaps with the motion model. Because the whole pass is available offline, the backward RTS pass uses fixes on both sides of every moment — strictly better than a live forward-only filter. The smoother's posterior variance becomes the per-window confidence for free. This is the algorithmic form of: *smoothness prior + inverse-accuracy anchoring + speed-from-positions when Doppler is null*.

**Confidence is designed as a future aggregation weight.** The product's end goal aggregates many users × many passes through an area; a low-confidence single-pass window must down-weight rather than poison the consensus. Hence `speed_confidence` is a continuous `[0,1]` value, not a binary flag.

---

## 2. SP2 purpose and boundaries

**Purpose:** Given one pass's GPS fixes and SP1's window grid, produce one motion record per window: a smoothed speed, heading, a continuous confidence, a source label, and human-readable reason flags.

**In scope:** equirectangular projection to local meters; a constant-velocity Kalman + RTS smoother over 2-D position with accuracy-weighted measurements; per-window evaluation; the confidence/trust model (gap policy, stationary handling, Doppler cross-check, reason flags).

**Out of scope (deferred):**
- The **constant-acceleration model + audio engine-RPM cue** (a paired phase-2 refinement: the RPM accel/decel-onset signal informs the acceleration state). RPM is a *sign* indicator only — gear changes decouple RPM magnitude from acceleration.
- **Fusing native Doppler `speed_mps` as a measurement** (it is `|v|`, a nonlinear EKF term). v1 uses Doppler only as a confidence cross-check.
- **Cross-user / cross-trip aggregation** (its own future sub-project; SP2 only emits the per-pass weights it will consume).
- Any audio, scoring, or road-network map-matching (we deliberately do NOT snap to roads — that would destroy within-lane and directional detail).

**Non-functional:** vanilla JS, **no dependencies**, Node `assert` tests, node-only (`module.exports`). Offline batch — no real-time budget; N ≈ 100–300 fixes per pass, the whole pipeline is `O(N)` and runs in milliseconds. Refactored into small, independently-tested modules with the linear-algebra and filter math documented inline.

---

## 3. Inputs

1. **`gps_samples`** (from the sidecar): array of `{ sample_id, captured_at_ms, latitude, longitude, speed_mps, accuracy_meters }`. `captured_at_ms` is epoch ms; `speed_mps` may be `null`.
2. **`windowStarts`**: the ordered list of SP1 window `started_at_ms` values (one per 1 s window). SP2 emits exactly one record per entry, in the same order. (A thin caller derives this from SP1's output; SP2 itself takes the array.)

SP2's units are pure functions over these in-memory inputs. Disk reading lives in the SP3 orchestrator / existing `load-pass.js`.

---

## 4. Architecture

New directory `harness/motion/` (sibling to `harness/audio/`).

### 4.1 Modules (pure, no deps, node-tested)

- **`harness/motion/linalg.js`** — minimal fixed-purpose matrix ops on arrays-of-arrays (row-major):
  - `matMul(A, B)`, `transpose(A)`, `identity(n)`, `matAdd(A, B)`, `matSub(A, B)`, `scale(A, k)`.
  - `solve(A, B)` → solves `A · X = B` for `X` by Gaussian elimination with partial pivoting (used for the 4×4 RTS gain and any linear solve; avoids an explicit 4×4 inverse). `A` is `n×n`, `B` is `n×m`.

- **`harness/motion/geo-project.js`**
  - `projectFixes(gpsSamples)` → `{ points, lat0, lon0 }`. `lat0/lon0` are the mean latitude/longitude of the fixes. Each `point` = `{ t, x, y, acc, speedNative }` where (lat/lon in radians):
    - `x = R_EARTH · (lon − lon0) · cos(lat0)` (east, meters)
    - `y = R_EARTH · (lat − lat0)` (north, meters)
    - `acc = accuracy_meters`, `speedNative = speed_mps` (or `null`). `R_EARTH = 6371000`.
  - `bearingDeg(vEast, vNorth)` → compass heading in `[0, 360)`, `0° = North`, clockwise: `((atan2(vEast, vNorth) · 180/π) + 360) mod 360`.

- **`harness/motion/kalman-smoother.js`** — constant-velocity 4-state `[x, y, vx, vy]`:
  - `smooth(points, sigmaA)` → array (aligned to `points`) of RTS-smoothed `{ t, s: [x,y,vx,vy], P: 4×4 }`. Requires `points.length ≥ 2`; throws otherwise (caller guards — see §7).
  - `evaluateAt(smoothed, t, sigmaA)` → `{ s: [x,y,vx,vy], P: 4×4 }` for an arbitrary time `t`, by propagating the immediately-preceding smoothed state forward by `dt = (t − t_prev)/1000` s through `F(dt)`, inflating covariance by `Q(dt)`. (For `t` before the first / after the last fix, extrapolate from the nearest end; such windows are typically gap-flagged in §6.)

- **`harness/motion/motion-track.js`** — orchestrator:
  - `buildMotionTrack(gpsSamples, windowStarts, params)` → array of per-window records (§6). Owns the gap policy, stationary handling, Doppler cross-check, and the variance→confidence mapping. Decomposed into helpers (`windowMotion`, `classifyWindow`, `confidenceFromCov`).

### 4.2 The filter math (constant-velocity, white-noise acceleration)

Between consecutive fixes, `dt = (t_k − t_{k−1}) / 1000` seconds. With `q = sigmaA²` (per-axis acceleration spectral density):

```
F(dt) = [[1,0,dt,0],
         [0,1,0,dt],
         [0,0,1, 0],
         [0,0,0, 1]]

Q(dt) = q · [[dt³/3, 0,     dt²/2, 0    ],
             [0,     dt³/3, 0,     dt²/2],
             [dt²/2, 0,     dt,    0    ],
             [0,     dt²/2, 0,     dt   ]]

H = [[1,0,0,0],
     [0,1,0,0]]          R = [[acc², 0],
                              [0, acc²]]     (acc = that fix's accuracy_meters)
```

- **Forward filter** (initialize at fix 0: position = measurement, velocity = 0, large initial velocity covariance): standard predict (`s⁻ = F s`, `P⁻ = F P Fᵀ + Q`) then update (`S = H P⁻ Hᵀ + R` is 2×2, inverted in closed form; `K = P⁻ Hᵀ S⁻¹`; `s = s⁻ + K(z − H s⁻)`; `P = (I − K H) P⁻`). Store filtered and one-step-predicted `(s, P)` per fix.
- **RTS backward pass** for `k = N−2 … 0`: `C = P_k^filt · F(dt_{k+1})ᵀ · (P_{k+1}^pred)⁻¹` (computed via `solve`), `s_k^sm = s_k^filt + C(s_{k+1}^sm − s_{k+1}^pred)`, `P_k^sm = P_k^filt + C(P_{k+1}^sm − P_{k+1}^pred)Cᵀ`.

---

## 5. Data flow

```
gps_samples ──► projectFixes ──► points [{t,x,y,acc,speedNative}], lat0, lon0
points ──► smooth(points, sigmaA) ──► smoothed [{t, s:[x,y,vx,vy], P}]
for each windowStart in windowStarts:
    t = windowStart + WINDOW_DURATION_MS/2          # window center
    {s, P} = evaluateAt(smoothed, t, sigmaA)
    vEast = s[2]; vNorth = s[3]
    speed = sqrt(vEast² + vNorth²)
    heading = speed < STATIONARY_SPEED ? null : bearingDeg(vEast, vNorth)
    velTraceVar = P[2][2] + P[3][3]                 # velocity uncertainty proxy
    confidence, source, flags = classifyWindow(t, speed, velTraceVar, nearest fix, in-window Doppler)
    emit record
```

`WINDOW_DURATION_MS` (1000) is imported from `recorder/constants.js` so SP2's window-center math matches SP1.

---

## 6. Output — the SP2 → SP3 interface

`buildMotionTrack` returns an array, one record per `windowStarts` entry, same order:

```js
{
  window_id:        "w0",        // matches SP1's window_id by index ("w" + i)
  started_at_ms:    Number,      // = windowStarts[i]
  speed_mps:        Number,      // smoothed speed magnitude (>= 0)
  heading_deg:      Number|null, // compass bearing [0,360); null when stationary
  speed_confidence: Number,      // [0,1], continuous; 0 = unscored
  speed_source:     String,      // "native_crosschecked" | "derived" | "interpolated" | "insufficient_fixes"
  flags:            String[]     // subset of: "interpolated","gap_unscored","low_accuracy","doppler_mismatch","stationary"
}
```

### 6.1 Confidence and classification

`nearestGapS` = seconds from the window center to the nearest fix time. `inWindowDoppler` = a fix with non-null `speed_mps` whose `captured_at_ms` lies in `[started_at_ms, started_at_ms + WINDOW_DURATION_MS)`.

- **Base confidence:** `confidenceFromCov(velTraceVar) = 1 / (1 + velTraceVar / VAR_SCALE)` → monotonic decreasing in velocity uncertainty, in `(0,1]`.
- **Gap policy** (applied after base):
  - `nearestGapS > GAP_MAX_S` → `speed_confidence = 0`, `source = "interpolated"`, `flags += "gap_unscored"` (SP3 excludes it). Speed/heading are still the best estimate but must not be trusted.
  - `GAP_INTERP_S < nearestGapS ≤ GAP_MAX_S` → `flags += "interpolated"`, `speed_confidence = min(base, INTERP_CAP)`, `source = "interpolated"`.
  - else → normal.
- **Low accuracy:** nearest fix `acc > ACC_FLAG_M` → `flags += "low_accuracy"` (and base confidence is already lower because `R` was large there).
- **Stationary:** `speed < STATIONARY_SPEED` → `heading_deg = null`, `flags += "stationary"`.
- **`speed_source` precedence (highest wins):** `insufficient_fixes` (the §7 < 2-fix case) → `interpolated` (any gap tier — `interpolated` or `gap_unscored`) → otherwise a *normal* window's source is decided by the Doppler cross-check below. Stationary affects `heading_deg`/flags only, never `source`.
- **Doppler cross-check** (normal windows only — skipped when `interpolated`/`gap_unscored`; requires an `inWindowDoppler`; `relErr = |native − derived| / max(native, derived, 0.1)`):
  - `relErr ≤ DOPPLER_TOL` → `source = "native_crosschecked"`.
  - `relErr > DOPPLER_TOL` → `source = "derived"`, `flags += "doppler_mismatch"`, `speed_confidence ·= DOPPLER_PENALTY`.
  - no `inWindowDoppler` → `source = "derived"`.

---

## 7. Validation, edges, and error handling

- **< 2 fixes:** velocity is unknowable. `buildMotionTrack` does NOT call `smooth` (which would throw); instead every window is emitted with `speed_mps: 0`, `heading_deg: null`, `speed_confidence: 0`, `speed_source: "insufficient_fixes"`, `flags: ["gap_unscored"]`.
- **All-stationary pass:** speeds ≈ 0, every `heading_deg` null + `stationary` flag; confidence reflects the (low-velocity) covariance normally.
- **Windows before the first / after the last fix:** evaluated by extrapolation; almost always beyond `GAP_MAX_S` from a fix → `gap_unscored`.
- **Duplicate/zero-`dt` fixes** (the 25 ms-apart real case is fine; exact duplicates would make `Q(dt)`/`F(dt)` degenerate): if `dt ≤ 0` between consecutive fixes after sorting by `captured_at_ms`, the later duplicate is dropped before filtering.
- **Fixes are sorted by `captured_at_ms`** before projection/filtering (the sidecar order is not assumed monotonic).
- `solve` throws on a singular matrix; this should not occur with `R ≻ 0` and `Q ≻ 0` for `dt > 0`, but the throw is a loud guard rather than silent `NaN`.
- The array length always equals `windowStarts.length`, in the same order (contiguous, parallel to SP1).

---

## 8. Tunable defaults (flagged; calibrate against real captures)

| Name | Default | Meaning |
|---|---|---|
| `SIGMA_A` | 2.0 m/s² | Acceleration prior (process-noise spectral density `q = SIGMA_A²`). Larger = trusts GPS more / smooths less. |
| `STATIONARY_SPEED` | 0.5 m/s | Below this, heading is undefined (null). |
| `GAP_INTERP_S` | 3.0 s | Beyond this from a fix, a window is `interpolated` (confidence capped). |
| `GAP_MAX_S` | 10.0 s | Beyond this, a window is `gap_unscored` (confidence 0). |
| `INTERP_CAP` | 0.5 | Confidence ceiling for interpolated windows. |
| `ACC_FLAG_M` | 50 m | Nearest-fix accuracy above which `low_accuracy` is flagged. |
| `DOPPLER_TOL` | 0.25 | Relative speed disagreement above which `doppler_mismatch` fires. |
| `DOPPLER_PENALTY` | 0.5 | Confidence multiplier on a Doppler mismatch. |
| `VAR_SCALE` | 1.0 (m/s)² | Normalizer in the confidence map; tune so typical good windows land near 0.8–0.95. |

`params` overrides any of these; omitted keys take the default.

---

## 9. Testing strategy (Node `assert`, no deps)

- **`linalg`**: `matMul`/`transpose`/`identity` on known small matrices; `solve` recovers `X` for a known `A·X = B` (incl. a 4×4) within tolerance; `solve` on a singular matrix throws.
- **`geo-project`**: a fix at `lat0,lon0` projects to ~`(0,0)`; a known eastward/northward offset projects to the expected meters (e.g., 0.001° lat ≈ 111.3 m north) within 1 %; `bearingDeg(1,0)=90` (East), `bearingDeg(0,1)=0` (North), `bearingDeg(-1,0)=270` (West).
- **`kalman-smoother`**:
  - A **straight constant-velocity synthetic track** (known `v`, exact positions, small `acc`) → recovered `vx,vy` within a tight tolerance at interior fixes.
  - **Accuracy weighting:** a single fix with `acc = 200` displaced sideways between many `acc = 5` fixes on a line → its smoothed position is pulled back onto the line (residual ≪ the displacement).
  - `smooth` throws on `< 2` points.
- **`motion-track`** (the spec-critical behaviors):
  - Constant-velocity track sampled at 1 Hz, windows every 1 s → `speed_mps` ≈ true speed, `heading_deg` ≈ true bearing, `speed_source` reflects Doppler presence.
  - **Gap test:** fixes with a 16 s hole → windows whose center is `> GAP_MAX_S` from any fix come back `speed_confidence: 0` + `gap_unscored`; windows in `(GAP_INTERP_S, GAP_MAX_S]` get `interpolated` + capped confidence.
  - **Stationary test:** near-zero-motion fixes → `heading_deg: null` + `stationary`.
  - **Confidence monotonicity:** sparser / lower-accuracy fixes yield lower `speed_confidence` than dense / high-accuracy ones for comparable windows.
  - **Doppler cross-check:** an in-window native speed agreeing → `native_crosschecked`; a disagreeing one → `doppler_mismatch` + reduced confidence.
  - **`< 2` fixes:** all windows `insufficient_fixes`, confidence 0, length == `windowStarts.length`.
  - **Real-pass smoke test:** run over `data/johnson-creek-pass-1-163508` GPS (3 fixes, ~0.12 Hz, `speed_mps` all null, accuracy 100–212 m) → array length == SP1's window count (25), and (given the sparsity) most windows are `interpolated`/`gap_unscored` — documents that a desktop-grade GPS pass is correctly judged low-trust. **This validates mechanics + the trust model, not real motion.**

---

## 10. Success criteria

- **SC-1** — Given `gps_samples` + a window grid, SP2 returns exactly one record per window, same order, each with the §6 fields.
- **SC-2** — On a synthetic constant-velocity track, recovered speed and heading match truth within tolerance.
- **SC-3** — Accuracy weighting works: a low-accuracy outlier fix is pulled toward the trajectory defined by its accurate neighbors.
- **SC-4** — The trust model is correct: gaps → `interpolated`/`gap_unscored`, stationary → null heading, Doppler agreement/disagreement → the right source/flag, and confidence is monotonic in fix quality.
- **SC-5** — `< 2` fixes and the real (sparse, null-speed) pass are handled without error and correctly judged low-trust.
- **SC-6** — No dependencies; the full Node suite (existing + new SP2 tests) passes.

---

## 11. Open questions for review

1. **Confidence map shape:** `1/(1 + var/VAR_SCALE)` is simple and monotonic; an exponential `exp(−var/VAR_SCALE)` is an alternative. Acceptable to ship the rational form and tune `VAR_SCALE` against real data?
2. **`evaluateAt` propagation:** v1 propagates forward from the *preceding* smoothed state (covariance-inflated). A two-sided smoother-interpolation would be marginally more accurate mid-interval but more code. Forward-propagation acceptable, given gap windows are flagged anyway?
3. **Gap tiers (3 s / 10 s):** do these match your sense of when a coast becomes untrustworthy at typical road speeds?
4. **Heading at low speed:** `STATIONARY_SPEED = 0.5 m/s` (~1.1 mph) as the null-heading threshold — reasonable, or do you want it tied to GPS accuracy instead?
