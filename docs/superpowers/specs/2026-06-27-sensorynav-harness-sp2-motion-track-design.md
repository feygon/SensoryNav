# SensoryNav Ingestion Harness — SP2: Speed & Motion Track — Design Spec

**Status:** READY — passed the Requirements Rubric gate (R1 = 40/45 → R2 = 44/45; no critical/high/open should-fix). Cleared for `writing-plans`.
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

**Function size (NFR-1):** each function targets **≤ ~100 lines**, with **300 lines a hard block**. `smooth` MUST decompose into `forwardFilter(points, sigmaA)` and `rtsBackward(filtered)`; `buildMotionTrack` MUST delegate per-window work to the named helpers `windowMotion` / `classifyWindow` / `confidenceFromCov` (§4.1, §6.2), so no function approaches the block limit.

---

## 3. Inputs

1. **`gps_samples`** (from the sidecar): array of `{ sample_id, captured_at_ms, latitude, longitude, speed_mps, accuracy_meters }`. `captured_at_ms` is epoch ms; `speed_mps` may be `null`.
2. **`windows`**: SP1's window records, each providing at least `{ window_id, started_at_ms }` (SP1's output satisfies this directly). SP2 emits exactly one record per entry, in the same order, **carrying through each input `window_id`** — so the SP2↔SP1 join cannot silently desync if SP1 ever renumbers or drops a window. (The SP3 orchestrator passes SP1's window array straight in.)

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
  - `evaluateAt(smoothed, t, sigmaA)` → `{ s: [x,y,vx,vy], P: 4×4 }` for an arbitrary time `t`. Pick the **nearest** smoothed fix as the anchor and propagate by `dt = (t − t_anchor)/1000` s through `F(dt)`, inflating covariance by **`Q(|dt|)`**. **`dt` may be negative** (window center before the anchor): `F(dt)` is valid for negative `dt`, but `Q` MUST be built from `|dt|` — a negative `dt` would make the `dt³/3` variance terms negative, i.e. a non-PSD covariance. For `t` before the first fix the anchor is fix 0 (negative `dt`); after the last, fix N−1. Such out-of-range windows are normally `gap_unscored` in §6 anyway.

- **`harness/motion/motion-track.js`** — orchestrator:
  - `buildMotionTrack(gpsSamples, windows, params)` → array of per-window records (§6), one per input window, carrying through each `window_id`. Owns the gap policy, stationary handling, Doppler cross-check, and the variance→confidence mapping, delegating to `windowMotion(window, smoothed, fixes, params)` → record, `classifyWindow(...)` → `{ confidence, source, flags, heading }` (the §6.2 canonical pipeline), and `confidenceFromCov(velTraceVar, params)`.

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

- **Forward filter** (initialize at fix 0: position = the measurement with `P[x][x] = P[y][y] = acc₀²`; velocity = 0 with `P[vx][vx] = P[vy][vy] = INIT_VEL_VAR = (50 m/s)²` so the first few fixes set the velocity; off-diagonals 0): standard predict (`s⁻ = F s`, `P⁻ = F P Fᵀ + Q`) then update (`S = H P⁻ Hᵀ + R` is 2×2, inverted in closed form; `K = P⁻ Hᵀ S⁻¹`; `s = s⁻ + K(z − H s⁻)`; `P = (I − K H) P⁻`). Store filtered and one-step-predicted `(s, P)` per fix.
- **RTS backward pass** for `k = N−2 … 0`: `C = P_k^filt · F(dt_{k+1})ᵀ · (P_{k+1}^pred)⁻¹` (computed via `solve`), `s_k^sm = s_k^filt + C(s_{k+1}^sm − s_{k+1}^pred)`, `P_k^sm = P_k^filt + C(P_{k+1}^sm − P_{k+1}^pred)Cᵀ`.

---

## 5. Data flow

```
gps_samples ──► projectFixes ──► points [{t,x,y,acc,speedNative}], lat0, lon0
points ──► smooth(points, sigmaA) ──► smoothed [{t, s:[x,y,vx,vy], P}]
for each window in windows:
    t = window.started_at_ms + WINDOW_DURATION_MS/2  # window center
    {s, P} = evaluateAt(smoothed, t, sigmaA)
    vEast = s[2]; vNorth = s[3]
    speed = sqrt(vEast² + vNorth²)
    heading = speed < STATIONARY_SPEED ? null : bearingDeg(vEast, vNorth)
    velTraceVar = P[2][2] + P[3][3]                 # velocity uncertainty proxy
    {confidence, source, flags, heading} = classifyWindow(...)   # §6.2 canonical order
    emit { window_id: window.window_id, started_at_ms: window.started_at_ms, ... }
```

`WINDOW_DURATION_MS` (1000) comes from the existing core via `const { CONSTANTS } = require("../../recorder/constants"); const WINDOW_DURATION_MS = CONSTANTS.WINDOW_DURATION_MS;` (the same access SP1's `harness/audio/audio-windows.js` uses), so SP2's window-center math matches SP1.

---

## 6. Output — the SP2 → SP3 interface

`buildMotionTrack` returns an array, one record per input `windows` entry, same order:

```js
{
  window_id:        String,      // carried through from the input window (SP1's window_id)
  started_at_ms:    Number,      // = the input window's started_at_ms
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
- **Low accuracy:** for a normal or `interpolated` window, nearest fix `acc > ACC_FLAG_M` → `flags += "low_accuracy"`. **Suppressed on `gap_unscored`** windows — the nearest fix is too far away for its accuracy to mean anything.
- **Stationary:** `speed < STATIONARY_SPEED` → `heading_deg = null`, `flags += "stationary"` (never touches `source` or `confidence`).
- **Doppler cross-check** (`relErr = |native − derived| / max(native, derived, 0.1)`): see the canonical order in §6.2.

### 6.2 Classification pipeline (canonical order)

`classifyWindow` applies these steps in **exactly** this order, making the result deterministic. `nearestGapS` = seconds from the window center to the nearest fix; `inWindowDoppler` = a fix with non-null `speed_mps` whose `captured_at_ms ∈ [started_at_ms, started_at_ms + WINDOW_DURATION_MS)`.

1. **Base:** `confidence = confidenceFromCov(velTraceVar)`; `source` undecided; `flags = []`; `heading = bearingDeg(vEast, vNorth)`.
2. **Gap tier:**
   - `nearestGapS > GAP_MAX_S` → `confidence = 0`; `source = "interpolated"`; `flags += "gap_unscored"`.
   - else if `nearestGapS > GAP_INTERP_S` → `confidence = min(confidence, INTERP_CAP)`; `source = "interpolated"`; `flags += "interpolated"`.
   - else → leave `confidence`; `source` still undecided.
3. **Low accuracy:** if NOT `gap_unscored` and nearest fix `acc > ACC_FLAG_M` → `flags += "low_accuracy"` (no further `confidence` change beyond the already-larger `R`).
4. **Stationary:** if `speed < STATIONARY_SPEED` → `heading = null`; `flags += "stationary"`.
5. **Doppler** (only when `source` is still undecided): with an `inWindowDoppler`, `relErr ≤ DOPPLER_TOL` → `source = "native_crosschecked"`; `relErr > DOPPLER_TOL` → `source = "derived"`, `flags += "doppler_mismatch"`, `confidence ·= DOPPLER_PENALTY`. No `inWindowDoppler` → `source = "derived"`.
6. **Final clamp:** `confidence = max(0, min(1, confidence))`.

The `< 2`-fix path (§7) bypasses this pipeline with fixed values.

---

## 7. Validation, edges, and error handling

- **< 2 fixes:** velocity is unknowable. `buildMotionTrack` does NOT call `smooth` (which would throw); instead every window is emitted with `speed_mps: 0`, `heading_deg: null`, `speed_confidence: 0`, `speed_source: "insufficient_fixes"`, `flags: ["gap_unscored"]`.
- **All-stationary pass:** speeds ≈ 0, every `heading_deg` null + `stationary` flag; confidence reflects the (low-velocity) covariance normally.
- **Windows before the first / after the last fix:** evaluated by extrapolation; almost always beyond `GAP_MAX_S` from a fix → `gap_unscored`.
- **Duplicate/zero-`dt` fixes** (the 25 ms-apart real case is fine; exact duplicates would make `Q(dt)`/`F(dt)` degenerate): if `dt ≤ 0` between consecutive fixes after sorting by `captured_at_ms`, the later duplicate is dropped before filtering.
- **Fixes are sorted by `captured_at_ms`** before projection/filtering (the sidecar order is not assumed monotonic).
- `solve` throws on a singular matrix; this should not occur with `R ≻ 0` and `Q ≻ 0` for `dt > 0`, but the throw is a loud guard rather than silent `NaN`.
- The array length always equals `windows.length`, in the same order, each record carrying its input `window_id` (contiguous, parallel to SP1).

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
| `INIT_VEL_VAR` | (50 m/s)² | Initial velocity-state variance at fix 0 (large, so early fixes set the velocity). |

`params` overrides any of these; omitted keys take the default.

---

## 9. Testing strategy (Node `assert`, no deps)

- **`linalg`**: `matMul`/`transpose`/`identity` on known small matrices; `solve` recovers `X` for a known `A·X = B` (incl. a 4×4) within tolerance; `solve` on a singular matrix throws.
- **`geo-project`**: a fix at `lat0,lon0` projects to ~`(0,0)`; a known eastward/northward offset projects to the expected meters (e.g., 0.001° lat ≈ 111.3 m north) within 1 %; `bearingDeg(1,0)=90` (East), `bearingDeg(0,1)=0` (North), `bearingDeg(-1,0)=270` (West).
- **`kalman-smoother`**:
  - A **straight constant-velocity synthetic track** (`v = (12, 0) m/s`, exact positions at 1 Hz, `acc = 5`, `SIGMA_A = 2.0`) → recovered `vx` and `vy` each within **±0.05 m/s** of truth at interior fixes.
  - **Accuracy weighting:** one fix with `acc = 200` displaced **20 m** sideways between many `acc = 5` fixes on a straight line → its smoothed lateral residual is **< 2 m** (< 10 % of the displacement).
  - **`evaluateAt`:** on the CV track, evaluating **0.5 s after** a fix advances position by `≈ v·0.5` (within **±0.5 m**) at the same velocity (±0.05 m/s); evaluating **before the first fix** (negative `dt`) returns a finite state whose velocity variance is strictly larger than at fix 0 (confirms `Q(|dt|)` stays PSD).
  - `smooth` throws on `< 2` points.
- **`motion-track`** (the spec-critical behaviors):
  - Constant-velocity track sampled at 1 Hz, windows every 1 s → `speed_mps` within **±0.1 m/s** of true speed, `heading_deg` within **±2°** of true bearing.
  - **Gap test:** a `gap_unscored` window must be `> GAP_MAX_S` from its **nearest** fix, i.e. inside a hole wider than `2·GAP_MAX_S` (~20 s). Use a **26 s hole** → a window at its center (`~13 s` from each side) returns `speed_confidence: 0` + `gap_unscored` and **no** `low_accuracy` flag (suppressed); a window `~3.5 s` from a fix gets `interpolated` + `speed_confidence ≤ INTERP_CAP`. (A 16 s hole's midpoint is only ~8 s from each fix → `interpolated`, **not** `gap_unscored`.)
  - **Stationary test:** near-zero-motion fixes → `heading_deg: null` + `stationary`.
  - **Confidence monotonicity:** a window served by dense `acc = 5` fixes has strictly greater `speed_confidence` than a comparable window served by sparse `acc = 100` fixes.
  - **Doppler cross-check:** an in-window native speed within `DOPPLER_TOL` → `native_crosschecked`; one beyond → `derived` + `doppler_mismatch` + `speed_confidence` reduced by `DOPPLER_PENALTY`.
  - **Combined interaction (pins §6.2 order):** an `interpolated` window that also has a far/low-accuracy nearest fix keeps `source = "interpolated"` (Doppler does NOT relabel it); a `stationary` window with an in-window Doppler of `0.0` gives `relErr = 0` → `native_crosschecked` with `heading_deg: null`.
  - **Fix dedup/sort:** fixes supplied out of `captured_at_ms` order, including a pair with identical timestamps, are sorted and the zero-`dt` duplicate dropped before filtering (assert no throw, sane track).
  - **`< 2` fixes:** all windows `insufficient_fixes`, confidence 0, `heading_deg: null`, length == `windows.length`.
  - **Real-pass smoke test:** load the sidecar `data/johnson-creek-pass-1-163508.json` and pass its `gps_samples` (3 fixes, ~0.12 Hz, `speed_mps` all null, accuracy 100/136/212 m) with a 25-entry window grid (`w0…w24`, matching SP1) → array length 25, every record carries the right `window_id`, and given the sparsity most windows are `interpolated` (the real 16 s gap's midpoint is ~8 s from each fix, so those windows are `interpolated`, not `gap_unscored`). **Validates mechanics + the trust model, not real motion.**

---

## 10. Success criteria

- **SC-1** — Given `gps_samples` + a window grid, SP2 returns exactly one record per window, same order, each with the §6 fields.
- **SC-2** — On a synthetic constant-velocity track, recovered speed is within ±0.1 m/s and heading within ±2° of truth.
- **SC-3** — Accuracy weighting works: a low-accuracy outlier fix is pulled toward the trajectory defined by its accurate neighbors.
- **SC-4** — The trust model is correct: gaps → `interpolated`/`gap_unscored`, stationary → null heading, Doppler agreement/disagreement → the right source/flag, and confidence is monotonic in fix quality.
- **SC-5** — `< 2` fixes and the real (sparse, null-speed) pass are handled without error and correctly judged low-trust.
- **SC-6** — No dependencies; the full Node suite (existing + new SP2 tests) passes.

---

## 11. Requirements and traceability

| ID | Requirement | Defined | Verified by |
|---|---|---|---|
| FR-1 | Equirectangular projection around mean `lat0/lon0`; `point` carries `t,x,y,acc,speedNative` | §4.1 | `geo-project` offset test |
| FR-2 | `bearingDeg` compass convention (0°=N, 90°=E), range `[0,360)` | §4.1 | `geo-project` bearing test |
| FR-3 | Forward CV-Kalman with F/Q/H/R per §4.2, `R = acc²` weighting, fixed init covariances | §4.2 | `kalman-smoother` CV-track test |
| FR-4 | RTS backward smoother (gain via `solve`) | §4.2 | `kalman-smoother` accuracy-weighting test |
| FR-5 | `evaluateAt` propagation, `Q(|dt|)`, negative-`dt` handling | §4.1 | `kalman-smoother` evaluateAt test |
| FR-6 | Per-window record schema (§6 fields); one per input window, same order, carried `window_id` | §6 | `motion-track` CV / `<2`-fix / smoke tests |
| FR-7 | Confidence map `1/(1+var/VAR_SCALE)`, monotonic, clamped `[0,1]` | §6.1, §6.2 | `motion-track` monotonicity test |
| FR-8 | Gap policy (3 tiers: normal / interpolated / gap_unscored) | §6.1, §6.2 | `motion-track` gap test |
| FR-9 | Stationary policy (heading null + flag) | §6.1, §6.2 | `motion-track` stationary test |
| FR-10 | Doppler cross-check + `speed_source` precedence + final clamp (canonical §6.2 order) | §6.2 | `motion-track` Doppler + combined-interaction tests |
| FR-11 | `< 2` fixes → all `insufficient_fixes`, length == `windows.length` | §7 | `motion-track` `<2`-fix test |
| FR-12 | Fixes sorted by `captured_at_ms`; zero-`dt` duplicates dropped | §7 | `motion-track` dedup/sort test |
| FR-13 | `linalg.solve` correctness + singular-matrix throw | §4.1 | `linalg` solve test |
| NFR-1 | Function size ≤~100 / 300 hard; `smooth`→`forwardFilter`+`rtsBackward`; `buildMotionTrack` delegates | §2 | review |
| NFR-2 | No dependencies; node-only `module.exports`; `O(N)` | §2 | `npm test` |
| NFR-3 | `WINDOW_DURATION_MS` from `recorder/constants.js` (`CONSTANTS` access) | §5 | window-center alignment in CV test |

### 11.1 Resolved decisions (formerly open questions)

1. **Confidence map:** ship the rational `1/(1 + var/VAR_SCALE)` (§6.1) and calibrate `VAR_SCALE` against real captures. *(Resolved: ship-and-calibrate; exponential variant not needed.)*
2. **`evaluateAt`:** `|dt|`-propagation from the nearest smoothed state (§4.1); two-sided smoother-interpolation deferred as unnecessary — mid-interval windows are ≤ 0.5 s from a fix, and gap windows are flagged regardless. *(Resolved.)*
3. **Gap tiers:** `GAP_INTERP_S = 3 s`, `GAP_MAX_S = 10 s` (§8) — flagged tunables to calibrate. *(Resolved: ship-and-calibrate.)*
4. **Stationary threshold:** `STATIONARY_SPEED = 0.5 m/s`, a fixed scalar (§8); not tied to GPS accuracy in v1. *(Resolved.)*
