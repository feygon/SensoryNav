# SensoryNav Harness SP2 — Speed & Motion Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the offline GPS-fusion motion track (SP2): a constant-velocity Kalman filter + RTS smoother that turns a pass's GPS fixes into one smoothed speed + heading + confidence record per SP1 window.

**Architecture:** Four pure, node-tested modules under `harness/motion/` — a tiny linear-algebra kit, an equirectangular projector, the CV Kalman/RTS smoother, and the orchestrator that resamples onto SP1's window grid and applies the trust model. Reuses `recorder/constants.js` for `WINDOW_DURATION_MS`.

**Tech Stack:** Vanilla JS, no dependencies, Node `assert` test scripts. Node-only (`module.exports`).

**Spec:** `docs/superpowers/specs/2026-06-27-sensorynav-harness-sp2-motion-track-design.md` (READY, 44/45).

## Global Constraints

Copied from the spec; every task implicitly includes these.

- **No dependencies.** Vanilla JS only. Node-only modules → plain `module.exports = { ... }`.
- **Filter math (CV, white-noise acceleration)** with `q = SIGMA_A²`, `dt` in seconds:
  - `F(dt) = [[1,0,dt,0],[0,1,0,dt],[0,0,1,0],[0,0,0,1]]`
  - `Q(dt) = q·[[dt³/3,0,dt²/2,0],[0,dt³/3,0,dt²/2],[dt²/2,0,dt,0],[0,dt²/2,0,dt]]`
  - `H = [[1,0,0,0],[0,1,0,0]]`, `R = [[acc²,0],[0,acc²]]`.
- **Init at fix 0:** position = measurement with `P[x][x]=P[y][y]=acc₀²`; velocity 0 with `P[vx][vx]=P[vy][vy]=INIT_VEL_VAR=(50 m/s)²`; off-diagonals 0.
- **RTS gain** `C = P_filt · Fᵀ · (P_pred,next)⁻¹` computed via `solve` (no explicit inverse).
- **`evaluateAt`** propagates from the **nearest** smoothed state by `dt = (t − t_anchor)/1000`, inflating covariance by **`Q(|dt|)`** (never `Q(dt)` with negative `dt` — that would be non-PSD).
- **Projection:** equirectangular around mean lat/lon. `x = R_EARTH·(lon−lon0)·cos(lat0)` (east), `y = R_EARTH·(lat−lat0)` (north), lat/lon in radians, `R_EARTH = 6371000`.
- **`bearingDeg(vEast, vNorth)` = `((atan2(vEast,vNorth)·180/π)+360) mod 360`** (0°=North, 90°=East).
- **Window center** `t = started_at_ms + WINDOW_DURATION_MS/2`; `WINDOW_DURATION_MS` (1000) via `const { CONSTANTS } = require("../../recorder/constants"); CONSTANTS.WINDOW_DURATION_MS`.
- **Input** is `(gps_samples, windows, params)` where `windows` are SP1 records (each `{ window_id, started_at_ms }`). Output: exactly one record per input window, same order, **carrying through `window_id`**; array length == `windows.length`.
- **Fixes** sorted by `captured_at_ms`; a fix with `captured_at_ms ≤` the previous kept fix is dropped (zero/negative `dt`).
- **Classification canonical order (§6.2):** base confidence → gap tier → low_accuracy (suppressed on `gap_unscored`) → stationary (heading null) → Doppler (only if source still undecided) → final clamp `[0,1]`.
- **`speed_confidence` = `1/(1 + velTraceVar/VAR_SCALE)`**, `velTraceVar = P[2][2]+P[3][3]`.
- **Defaults:** `SIGMA_A 2.0`, `STATIONARY_SPEED 0.5`, `GAP_INTERP_S 3.0`, `GAP_MAX_S 10.0`, `INTERP_CAP 0.5`, `ACC_FLAG_M 50`, `DOPPLER_TOL 0.25`, `DOPPLER_PENALTY 0.5`, `VAR_SCALE 1.0`, `INIT_VEL_VAR (50)²`. `params` overrides any.
- **Function size:** ~100 lines/function target, 300 hard. `smooth` decomposes into `forwardFilter` + `rtsBackward`; `buildMotionTrack` delegates to `windowMotion`/`classifyWindow`/`confidenceFromCov`.

---

## File Structure

- Create: `harness/motion/linalg.js` — `matMul, transpose, identity, matAdd, matSub, scale, solve`.
- Create: `harness/motion/geo-project.js` — `projectFixes(gpsSamples)`, `bearingDeg(vEast, vNorth)`.
- Create: `harness/motion/kalman-smoother.js` — `smooth(points, sigmaA)`, `evaluateAt(smoothed, t, sigmaA)` (+ `forwardFilter`, `rtsBackward`).
- Create: `harness/motion/motion-track.js` — `buildMotionTrack(gpsSamples, windows, params)` (+ helpers).
- Test: `tests/linalg.test.js`, `tests/geo-project.test.js`, `tests/kalman-smoother.test.js`, `tests/motion-track.test.js`.
- Modify: `package.json` — append each test.

## Orchestration (static delegation calculus — Planner)

| Tasks | Delegation | Model | Bloat | Must-inline | Tier-2 |
|---|---|---|---|---|---|
| 1–4 | `subagent` | `sonnet` (user rule: never haiku for code) | low | no | no |

Sequential; all gate on green node tests. Checkpoint: after Task 4 run full `npm test`.

---

### Task 1: Linear-algebra kit

**Files:**
- Create: `harness/motion/linalg.js`
- Test: `tests/linalg.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `matMul(A,B)`, `transpose(A)`, `identity(n)`, `matAdd(A,B)`, `matSub(A,B)`, `scale(A,k)`, `solve(A,B)` (solves `A·X=B`, `A` n×n, `B` n×m; throws `"solve: singular matrix"` on a singular `A`). Matrices are row-major arrays of arrays.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/linalg.test.js
"use strict";
const assert = require("assert");
const { matMul, transpose, identity, matAdd, matSub, scale, solve } = require("../harness/motion/linalg");

assert.deepStrictEqual(matMul([[1,2],[3,4]], [[5,6],[7,8]]), [[19,22],[43,50]]);
assert.deepStrictEqual(transpose([[1,2,3],[4,5,6]]), [[1,4],[2,5],[3,6]]);
assert.deepStrictEqual(identity(3), [[1,0,0],[0,1,0],[0,0,1]]);
assert.deepStrictEqual(matAdd([[1,2]],[[3,4]]), [[4,6]]);
assert.deepStrictEqual(matSub([[5,5]],[[1,2]]), [[4,3]]);
assert.deepStrictEqual(scale([[1,2]],3), [[3,6]]);

// solve a 2x2 system: A X = B
const A = [[2,1],[1,3]];
const X = solve(A, [[1],[2]]);
const AX = matMul(A, X);
assert.ok(Math.abs(AX[0][0]-1) < 1e-9 && Math.abs(AX[1][0]-2) < 1e-9);

// 4x4 inverse via solve(A, I): A * inv ≈ I
const A4 = [[4,1,0,0],[1,3,1,0],[0,1,2,1],[0,0,1,2]];
const inv = solve(A4, identity(4));
const chk = matMul(A4, inv);
for (let i=0;i<4;i++) for (let j=0;j<4;j++) assert.ok(Math.abs(chk[i][j] - (i===j?1:0)) < 1e-9);

assert.throws(() => solve([[1,2],[2,4]], [[1],[1]]), /singular/);

console.log("linalg tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/linalg.test.js`
Expected: FAIL with "Cannot find module '../harness/motion/linalg'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// harness/motion/linalg.js
"use strict";

function matMul(A, B) {
  const n = A.length, k = B.length, m = B[0].length;
  const C = [];
  for (let i = 0; i < n; i++) {
    C[i] = new Array(m).fill(0);
    for (let p = 0; p < k; p++) {
      const a = A[i][p];
      if (a === 0) continue;
      for (let j = 0; j < m; j++) C[i][j] += a * B[p][j];
    }
  }
  return C;
}

function transpose(A) {
  const n = A.length, m = A[0].length;
  const T = [];
  for (let j = 0; j < m; j++) {
    T[j] = new Array(n);
    for (let i = 0; i < n; i++) T[j][i] = A[i][j];
  }
  return T;
}

function identity(n) {
  const I = [];
  for (let i = 0; i < n; i++) { I[i] = new Array(n).fill(0); I[i][i] = 1; }
  return I;
}

function matAdd(A, B) {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

function matSub(A, B) {
  return A.map((row, i) => row.map((v, j) => v - B[i][j]));
}

function scale(A, k) {
  return A.map((row) => row.map((v) => v * k));
}

// Solve A X = B for X via Gauss-Jordan elimination with partial pivoting.
function solve(A, B) {
  const n = A.length, m = B[0].length;
  const M = [];
  for (let i = 0; i < n; i++) M[i] = A[i].slice().concat(B[i].slice());
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error("solve: singular matrix");
    if (piv !== col) { const tmp = M[piv]; M[piv] = M[col]; M[col] = tmp; }
    const pivVal = M[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / pivVal;
      if (factor === 0) continue;
      for (let c = col; c < n + m; c++) M[r][c] -= factor * M[col][c];
    }
  }
  const X = [];
  for (let i = 0; i < n; i++) {
    X[i] = new Array(m);
    const d = M[i][i];
    for (let j = 0; j < m; j++) X[i][j] = M[i][n + j] / d;
  }
  return X;
}

module.exports = { matMul, transpose, identity, matAdd, matSub, scale, solve };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/linalg.test.js`
Expected: PASS, prints "linalg tests passed".

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/linalg.test.js` to the `test` script.

- [ ] **Step 6: Commit**

```bash
git add harness/motion/linalg.js tests/linalg.test.js package.json
git commit -m "feat(harness): add linear-algebra kit (SP2)"
```

---

### Task 2: Equirectangular projector

**Files:**
- Create: `harness/motion/geo-project.js`
- Test: `tests/geo-project.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `projectFixes(gpsSamples)` → `{ points, lat0, lon0 }`; each `point` = `{ t, x, y, acc, speedNative }` (`t`=`captured_at_ms`, `x` east m, `y` north m, `acc`=`accuracy_meters`, `speedNative`=`speed_mps` or `null`).
  - `bearingDeg(vEast, vNorth)` → compass degrees `[0,360)`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/geo-project.test.js
"use strict";
const assert = require("assert");
const { projectFixes, bearingDeg } = require("../harness/motion/geo-project");

function fix(t, lat, lon, speed, acc) {
  return { sample_id: "g", captured_at_ms: t, latitude: lat, longitude: lon, speed_mps: speed, accuracy_meters: acc };
}

// Single fix → projects to ~(0,0) at the mean; fields carried.
const one = projectFixes([fix(1000, 45.5, -122.6, 10, 5)]);
assert.ok(Math.abs(one.points[0].x) < 1e-6 && Math.abs(one.points[0].y) < 1e-6);
assert.strictEqual(one.points[0].acc, 5);
assert.strictEqual(one.points[0].speedNative, 10);
assert.strictEqual(one.points[0].t, 1000);

// 0.002° north between two fixes ≈ 222 m in y.
const two = projectFixes([fix(0, 45.000, -122.0, null, 5), fix(1000, 45.002, -122.0, null, 5)]);
const dy = two.points[1].y - two.points[0].y;
const expected = 6371000 * 0.002 * Math.PI / 180;
assert.ok(Math.abs(dy - expected) / expected < 0.01);
assert.strictEqual(two.points[0].speedNative, null); // null preserved

// Eastward offset → +x.
const east = projectFixes([fix(0, 45.0, -122.000, null, 5), fix(1000, 45.0, -121.998, null, 5)]);
assert.ok(east.points[1].x > east.points[0].x);

// Bearing convention: 0=N, 90=E, 180=S, 270=W.
assert.ok(Math.abs(bearingDeg(0, 1) - 0) < 1e-9);
assert.ok(Math.abs(bearingDeg(1, 0) - 90) < 1e-9);
assert.ok(Math.abs(bearingDeg(0, -1) - 180) < 1e-9);
assert.ok(Math.abs(bearingDeg(-1, 0) - 270) < 1e-9);

console.log("geo-project tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/geo-project.test.js`
Expected: FAIL with "Cannot find module '../harness/motion/geo-project'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// harness/motion/geo-project.js
"use strict";

const R_EARTH = 6371000;
const DEG = Math.PI / 180;

function projectFixes(gpsSamples) {
  const n = gpsSamples.length;
  let sumLat = 0, sumLon = 0;
  for (const g of gpsSamples) { sumLat += g.latitude; sumLon += g.longitude; }
  const lat0 = n ? sumLat / n : 0;
  const lon0 = n ? sumLon / n : 0;
  const cosLat0 = Math.cos(lat0 * DEG);
  const points = gpsSamples.map((g) => ({
    t: g.captured_at_ms,
    x: R_EARTH * (g.longitude - lon0) * DEG * cosLat0,
    y: R_EARTH * (g.latitude - lat0) * DEG,
    acc: g.accuracy_meters,
    speedNative: (g.speed_mps === null || g.speed_mps === undefined) ? null : g.speed_mps
  }));
  return { points, lat0, lon0 };
}

function bearingDeg(vEast, vNorth) {
  return ((Math.atan2(vEast, vNorth) * 180 / Math.PI) + 360) % 360;
}

module.exports = { projectFixes, bearingDeg, R_EARTH };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/geo-project.test.js`
Expected: PASS, prints "geo-project tests passed".

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/geo-project.test.js` to the `test` script.

- [ ] **Step 6: Commit**

```bash
git add harness/motion/geo-project.js tests/geo-project.test.js package.json
git commit -m "feat(harness): add equirectangular projector (SP2)"
```

---

### Task 3: Constant-velocity Kalman + RTS smoother

**Files:**
- Create: `harness/motion/kalman-smoother.js`
- Test: `tests/kalman-smoother.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `linalg.js` (`matMul, transpose, matAdd, matSub, identity, solve`).
- Produces:
  - `smooth(points, sigmaA)` → array aligned to `points` of `{ t, s: [x,y,vx,vy], P }` (`P` 4×4). Throws on `< 2` points. Decomposed into `forwardFilter(points, sigmaA)` and `rtsBackward(points, filtered, sigmaA)`.
  - `evaluateAt(smoothed, t, sigmaA)` → `{ s: [x,y,vx,vy], P }` at arbitrary `t`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/kalman-smoother.test.js
"use strict";
const assert = require("assert");
const { smooth, evaluateAt } = require("../harness/motion/kalman-smoother");

const SIGMA_A = 2.0;
// CV track: v=(12,0) m/s, 1 Hz, exact positions, acc=5.
function cvPoints(n) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push({ t: i * 1000, x: 12 * i, y: 0, acc: 5, speedNative: 12 });
  return pts;
}

const sm = smooth(cvPoints(20), SIGMA_A);
for (let i = 5; i < 15; i++) {
  assert.ok(Math.abs(sm[i].s[2] - 12) < 0.05, `vx@${i}=${sm[i].s[2]}`);
  assert.ok(Math.abs(sm[i].s[3] - 0) < 0.05, `vy@${i}=${sm[i].s[3]}`);
}

// Accuracy weighting: one fix displaced 20 m sideways with acc=200 is pulled back toward the line.
const pts = cvPoints(20);
pts[10] = { t: 10000, x: 120, y: 20, acc: 200, speedNative: 12 };
const sm2 = smooth(pts, SIGMA_A);
assert.ok(Math.abs(sm2[10].s[1]) < 2, `smoothed y=${sm2[10].s[1]} should be < 2 m`);

// evaluateAt 0.5 s after fix 5 → position advanced ~6 m at same velocity.
const ev = evaluateAt(sm, 5500, SIGMA_A);
assert.ok(Math.abs(ev.s[0] - (12 * 5 + 6)) < 0.5, `x=${ev.s[0]}`);
assert.ok(Math.abs(ev.s[2] - 12) < 0.05);

// evaluateAt before the first fix (negative dt) → finite, with larger velocity variance than at fix 0.
const evBefore = evaluateAt(sm, -2000, SIGMA_A);
assert.ok(Number.isFinite(evBefore.s[0]));
assert.ok(evBefore.P[2][2] > sm[0].P[2][2]);

assert.throws(() => smooth([{ t: 0, x: 0, y: 0, acc: 5, speedNative: null }], SIGMA_A), />= 2|need/);

console.log("kalman-smoother tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/kalman-smoother.test.js`
Expected: FAIL with "Cannot find module '../harness/motion/kalman-smoother'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// harness/motion/kalman-smoother.js
"use strict";
const { matMul, transpose, matAdd, matSub, identity } = require("./linalg");
const { solve } = require("./linalg");

const INIT_VEL_VAR = 50 * 50; // (50 m/s)^2

function buildF(dt) {
  return [[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]];
}

function buildQ(dt, q) {
  const dt2 = dt * dt, dt3 = dt2 * dt;
  return [
    [q * dt3 / 3, 0, q * dt2 / 2, 0],
    [0, q * dt3 / 3, 0, q * dt2 / 2],
    [q * dt2 / 2, 0, q * dt, 0],
    [0, q * dt2 / 2, 0, q * dt]
  ];
}

function invert2x2(M) {
  const a = M[0][0], b = M[0][1], c = M[1][0], d = M[1][1];
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error("invert2x2: singular");
  const inv = 1 / det;
  return [[d * inv, -b * inv], [-c * inv, a * inv]];
}

function colToVec(col) { return [col[0][0], col[1][0], col[2][0], col[3][0]]; }
function vecToCol(v) { return [[v[0]], [v[1]], [v[2]], [v[3]]]; }

// Forward Kalman filter. Returns per-fix { sFilt, PFilt, sPred, PPred }.
function forwardFilter(points, sigmaA) {
  const q = sigmaA * sigmaA;
  const H = [[1, 0, 0, 0], [0, 1, 0, 0]];
  const Ht = transpose(H);
  const I4 = identity(4);
  const out = [];

  const p0 = points[0];
  let s = [[p0.x], [p0.y], [0], [0]];
  let P = [
    [p0.acc * p0.acc, 0, 0, 0],
    [0, p0.acc * p0.acc, 0, 0],
    [0, 0, INIT_VEL_VAR, 0],
    [0, 0, 0, INIT_VEL_VAR]
  ];
  out.push({ sFilt: s, PFilt: P, sPred: s, PPred: P });

  for (let k = 1; k < points.length; k++) {
    const pk = points[k];
    const dt = (pk.t - points[k - 1].t) / 1000;
    const F = buildF(dt);
    const Q = buildQ(dt, q);
    const sPred = matMul(F, s);
    const PPred = matAdd(matMul(matMul(F, P), transpose(F)), Q);
    const z = [[pk.x], [pk.y]];
    const R = [[pk.acc * pk.acc, 0], [0, pk.acc * pk.acc]];
    const S = matAdd(matMul(matMul(H, PPred), Ht), R);
    const K = matMul(matMul(PPred, Ht), invert2x2(S)); // 4x2
    const innov = matSub(z, matMul(H, sPred));
    s = matAdd(sPred, matMul(K, innov));
    P = matMul(matSub(I4, matMul(K, H)), PPred);
    out.push({ sFilt: s, PFilt: P, sPred, PPred });
  }
  return out;
}

// RTS backward smoother. Returns array aligned to points of { t, s:[4], P }.
function rtsBackward(points, filtered) {
  const n = points.length;
  const smoothed = new Array(n);
  smoothed[n - 1] = { t: points[n - 1].t, s: colToVec(filtered[n - 1].sFilt), P: filtered[n - 1].PFilt };
  let sNext = filtered[n - 1].sFilt;
  let PNext = filtered[n - 1].PFilt;
  for (let k = n - 2; k >= 0; k--) {
    const dt = (points[k + 1].t - points[k].t) / 1000;
    const F = buildF(dt);
    const PFilt = filtered[k].PFilt;
    const PPredNext = filtered[k + 1].PPred;
    const sPredNext = filtered[k + 1].sPred;
    // C = PFilt Fᵀ (PPredNext)⁻¹  → Cᵀ = solve(PPredNextᵀ, (PFilt Fᵀ)ᵀ)
    const A = matMul(PFilt, transpose(F));
    const C = transpose(solve(transpose(PPredNext), transpose(A)));
    const sSm = matAdd(filtered[k].sFilt, matMul(C, matSub(sNext, sPredNext)));
    const PSm = matAdd(PFilt, matMul(matMul(C, matSub(PNext, PPredNext)), transpose(C)));
    smoothed[k] = { t: points[k].t, s: colToVec(sSm), P: PSm };
    sNext = sSm;
    PNext = PSm;
  }
  return smoothed;
}

function smooth(points, sigmaA) {
  if (points.length < 2) throw new Error("smooth: need >= 2 points");
  return rtsBackward(points, forwardFilter(points, sigmaA));
}

function evaluateAt(smoothed, t, sigmaA) {
  const q = sigmaA * sigmaA;
  let anchor = 0, best = Infinity;
  for (let i = 0; i < smoothed.length; i++) {
    const d = Math.abs(smoothed[i].t - t);
    if (d < best) { best = d; anchor = i; }
  }
  const a = smoothed[anchor];
  const dt = (t - a.t) / 1000;
  const F = buildF(dt);
  const Q = buildQ(Math.abs(dt), q); // |dt| keeps Q positive-semidefinite
  const sProp = matMul(F, vecToCol(a.s));
  const PProp = matAdd(matMul(matMul(F, a.P), transpose(F)), Q);
  return { s: colToVec(sProp), P: PProp };
}

module.exports = { smooth, evaluateAt, forwardFilter, rtsBackward, INIT_VEL_VAR };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/kalman-smoother.test.js`
Expected: PASS, prints "kalman-smoother tests passed".

- [ ] **Step 5: Wire into package.json**

Append ` && node tests/kalman-smoother.test.js` to the `test` script.

- [ ] **Step 6: Commit**

```bash
git add harness/motion/kalman-smoother.js tests/kalman-smoother.test.js package.json
git commit -m "feat(harness): add CV Kalman + RTS smoother (SP2)"
```

---

### Task 4: Motion-track orchestrator + real-pass smoke test

**Files:**
- Create: `harness/motion/motion-track.js`
- Test: `tests/motion-track.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `recorder/constants.js` (`CONSTANTS.WINDOW_DURATION_MS`), `geo-project.js` (`projectFixes`, `bearingDeg`), `kalman-smoother.js` (`smooth`, `evaluateAt`).
- Produces: `buildMotionTrack(gpsSamples, windows, params)` → array of `{ window_id, started_at_ms, speed_mps, heading_deg, speed_confidence, speed_source, flags }`, one per input window, carrying `window_id`. Helpers: `classifyWindow`, `confidenceFromCov`, `sortDedupFixes`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/motion-track.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildMotionTrack } = require("../harness/motion/motion-track");

const BASE = 1000000;
function windows(n, t0) {
  const w = [];
  for (let i = 0; i < n; i++) w.push({ window_id: "w" + i, started_at_ms: t0 + i * 1000 });
  return w;
}
function fix(t, lat, lon, speed, acc) {
  return { sample_id: "g", captured_at_ms: t, latitude: lat, longitude: lon, speed_mps: speed, accuracy_meters: acc };
}
// 12 m/s eastward → lon step per second at lat 45.
const MPD_LON = 6371000 * Math.cos(45 * Math.PI / 180) * Math.PI / 180; // meters per degree lon
const DLON = 12 / MPD_LON;
function cvFix(i, speed, acc) { return fix(BASE + i * 1000, 45.0, -122.0 + DLON * i, speed, acc); }

// --- CV track: speed ~12, heading ~East, Doppler agrees ---
const cv = []; for (let i = 0; i < 30; i++) cv.push(cvFix(i, 12, 5));
const track = buildMotionTrack(cv, windows(28, BASE));
assert.strictEqual(track.length, 28);
assert.strictEqual(track[0].window_id, "w0");
for (let i = 5; i < 20; i++) {
  assert.ok(Math.abs(track[i].speed_mps - 12) < 0.1, `speed@${i}=${track[i].speed_mps}`);
  assert.ok(Math.abs(track[i].heading_deg - 90) < 2, `heading@${i}=${track[i].heading_deg}`);
}
assert.strictEqual(track[10].speed_source, "native_crosschecked");

// --- Gap test: long hole → gap_unscored; moderate distance → interpolated ---
const gapFixes = [];
for (let i = 0; i < 5; i++) gapFixes.push(cvFix(i, 12, 5));    // BASE..BASE+4000
for (let i = 30; i < 35; i++) gapFixes.push(cvFix(i, 12, 5));  // BASE+30000..+34000 (26 s hole)
const gt = buildMotionTrack(gapFixes, windows(35, BASE));
const w17 = gt[17]; // center BASE+17500 → 12.5 s from nearest fix → gap_unscored
assert.strictEqual(w17.speed_confidence, 0);
assert.ok(w17.flags.includes("gap_unscored"));
assert.ok(!w17.flags.includes("low_accuracy")); // suppressed on gap_unscored
const w7 = gt[7]; // center BASE+7500 → ~3.5 s from fix BASE+4000 → interpolated
assert.ok(w7.flags.includes("interpolated"));
assert.ok(w7.speed_confidence <= 0.5 + 1e-9);
assert.strictEqual(w7.speed_source, "interpolated"); // Doppler does not relabel it

// --- Stationary: same location → heading null + flag; Doppler 0 vs derived 0 → native_crosschecked ---
const stat = []; for (let i = 0; i < 10; i++) stat.push(fix(BASE + i * 1000, 45.0, -122.0, 0, 5));
const st = buildMotionTrack(stat, windows(8, BASE));
assert.strictEqual(st[3].heading_deg, null);
assert.ok(st[3].flags.includes("stationary"));
assert.strictEqual(st[3].speed_source, "native_crosschecked");

// --- Confidence monotonicity: dense/accurate > sparse/inaccurate ---
const dense = []; for (let i = 0; i < 20; i++) dense.push(cvFix(i, 12, 5));
const sparse = []; for (let i = 0; i < 20; i += 4) sparse.push(cvFix(i, 12, 100));
const denseT = buildMotionTrack(dense, windows(18, BASE));
const sparseT = buildMotionTrack(sparse, windows(18, BASE));
assert.ok(denseT[10].speed_confidence > sparseT[10].speed_confidence);

// --- Doppler mismatch: native says 50, positions imply 12 ---
const dis = []; for (let i = 0; i < 20; i++) dis.push(cvFix(i, 50, 5));
const disT = buildMotionTrack(dis, windows(18, BASE));
assert.ok(disT[10].flags.includes("doppler_mismatch"));
assert.strictEqual(disT[10].speed_source, "derived");

// --- Dedup/sort: out-of-order fixes + a duplicate timestamp → no throw, sane track ---
const unsorted = [cvFix(2, 12, 5), cvFix(0, 12, 5), cvFix(1, 12, 5), cvFix(1, 12, 5)];
const dt = buildMotionTrack(unsorted, windows(3, BASE));
assert.strictEqual(dt.length, 3);
assert.ok(Number.isFinite(dt[1].speed_mps));

// --- < 2 fixes → all insufficient_fixes ---
const few = buildMotionTrack([cvFix(0, 12, 5)], windows(5, BASE));
assert.strictEqual(few.length, 5);
assert.strictEqual(few[0].speed_source, "insufficient_fixes");
assert.strictEqual(few[0].speed_confidence, 0);
assert.strictEqual(few[0].heading_deg, null);

// --- Real-pass smoke test (mechanics + trust model, not real motion) ---
const sidecar = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "johnson-creek-pass-1-163508.json"), "utf8"));
const realTrack = buildMotionTrack(sidecar.gps_samples, windows(25, sidecar.audio_first_frame_ms));
assert.strictEqual(realTrack.length, 25);
for (let i = 0; i < 25; i++) assert.strictEqual(realTrack[i].window_id, "w" + i);
const lowTrust = realTrack.filter((r) => r.flags.includes("interpolated") || r.flags.includes("gap_unscored")).length;
assert.ok(lowTrust >= 10, `expected many low-trust windows, got ${lowTrust}`);

console.log("motion-track tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/motion-track.test.js`
Expected: FAIL with "Cannot find module '../harness/motion/motion-track'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// harness/motion/motion-track.js
"use strict";
const { CONSTANTS } = require("../../recorder/constants");
const { projectFixes, bearingDeg } = require("./geo-project");
const { smooth, evaluateAt } = require("./kalman-smoother");

const WINDOW_DURATION_MS = CONSTANTS.WINDOW_DURATION_MS;

const DEFAULTS = {
  SIGMA_A: 2.0, STATIONARY_SPEED: 0.5, GAP_INTERP_S: 3.0, GAP_MAX_S: 10.0,
  INTERP_CAP: 0.5, ACC_FLAG_M: 50, DOPPLER_TOL: 0.25, DOPPLER_PENALTY: 0.5, VAR_SCALE: 1.0
};

function confidenceFromCov(velTraceVar, params) {
  return 1 / (1 + velTraceVar / params.VAR_SCALE);
}

function sortDedupFixes(gpsSamples) {
  const sorted = gpsSamples.slice().sort((a, b) => a.captured_at_ms - b.captured_at_ms);
  const out = [];
  for (const g of sorted) {
    if (out.length && g.captured_at_ms <= out[out.length - 1].captured_at_ms) continue;
    out.push(g);
  }
  return out;
}

function inWindowDoppler(startedAtMs, fixes) {
  for (const f of fixes) {
    if (f.speedNative !== null && f.t >= startedAtMs && f.t < startedAtMs + WINDOW_DURATION_MS) {
      return f.speedNative;
    }
  }
  return null;
}

// Canonical classification pipeline (spec §6.2).
function classifyWindow(t, startedAtMs, speed, vEast, vNorth, velTraceVar, fixes, params) {
  let confidence = confidenceFromCov(velTraceVar, params);
  let source = null;
  const flags = [];
  let heading = bearingDeg(vEast, vNorth);

  let nearest = null, nearestGapS = Infinity;
  for (const f of fixes) {
    const g = Math.abs(f.t - t) / 1000;
    if (g < nearestGapS) { nearestGapS = g; nearest = f; }
  }

  let gapUnscored = false;
  if (nearestGapS > params.GAP_MAX_S) {
    confidence = 0; source = "interpolated"; flags.push("gap_unscored"); gapUnscored = true;
  } else if (nearestGapS > params.GAP_INTERP_S) {
    confidence = Math.min(confidence, params.INTERP_CAP); source = "interpolated"; flags.push("interpolated");
  }

  if (!gapUnscored && nearest && nearest.acc > params.ACC_FLAG_M) flags.push("low_accuracy");

  if (speed < params.STATIONARY_SPEED) { heading = null; flags.push("stationary"); }

  if (source === null) {
    const dop = inWindowDoppler(startedAtMs, fixes);
    if (dop !== null) {
      const relErr = Math.abs(dop - speed) / Math.max(dop, speed, 0.1);
      if (relErr <= params.DOPPLER_TOL) {
        source = "native_crosschecked";
      } else {
        source = "derived"; flags.push("doppler_mismatch"); confidence *= params.DOPPLER_PENALTY;
      }
    } else {
      source = "derived";
    }
  }

  confidence = Math.max(0, Math.min(1, confidence));
  return { confidence, source, flags, heading };
}

function windowMotion(w, smoothed, fixes, params) {
  const t = w.started_at_ms + WINDOW_DURATION_MS / 2;
  const { s, P } = evaluateAt(smoothed, t, params.SIGMA_A);
  const vEast = s[2], vNorth = s[3];
  const speed = Math.sqrt(vEast * vEast + vNorth * vNorth);
  const velTraceVar = P[2][2] + P[3][3];
  const c = classifyWindow(t, w.started_at_ms, speed, vEast, vNorth, velTraceVar, fixes, params);
  return {
    window_id: w.window_id,
    started_at_ms: w.started_at_ms,
    speed_mps: speed,
    heading_deg: c.heading,
    speed_confidence: c.confidence,
    speed_source: c.source,
    flags: c.flags
  };
}

function buildMotionTrack(gpsSamples, windows, params) {
  const p = Object.assign({}, DEFAULTS, params || {});
  const fixesRaw = sortDedupFixes(gpsSamples);
  if (fixesRaw.length < 2) {
    return windows.map((w) => ({
      window_id: w.window_id,
      started_at_ms: w.started_at_ms,
      speed_mps: 0,
      heading_deg: null,
      speed_confidence: 0,
      speed_source: "insufficient_fixes",
      flags: ["gap_unscored"]
    }));
  }
  const { points } = projectFixes(fixesRaw);
  const smoothed = smooth(points, p.SIGMA_A);
  return windows.map((w) => windowMotion(w, smoothed, points, p));
}

module.exports = { buildMotionTrack, classifyWindow, confidenceFromCov, sortDedupFixes };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/motion-track.test.js`
Expected: PASS, prints "motion-track tests passed".

- [ ] **Step 5: Wire into package.json and run the full suite**

Append ` && node tests/motion-track.test.js` to the `test` script, then run `npm test`. Expected: every prior "… passed" line prints, no error.

- [ ] **Step 6: Commit**

```bash
git add harness/motion/motion-track.js tests/motion-track.test.js package.json
git commit -m "feat(harness): add motion-track orchestrator + smoke test (SP2)"
```

---

## Self-Review

**1. Spec coverage:**
- FR-1 projection / FR-2 bearing → Task 2. ✓
- FR-3 forward CV-Kalman / FR-4 RTS / FR-5 evaluateAt (Q(|dt|), negative dt) → Task 3. ✓
- FR-6 per-window schema, carried window_id, length → Task 4. ✓
- FR-7 confidence map (clamped) / FR-8 gap tiers / FR-9 stationary / FR-10 Doppler + precedence → Task 4 (`classifyWindow`, §6.2 order). ✓
- FR-11 < 2 fixes / FR-12 sort+dedup → Task 4. ✓
- FR-13 linalg.solve + singular throw → Task 1. ✓
- NFR-1 function size / decomposition (`forwardFilter`+`rtsBackward`; `windowMotion`/`classifyWindow`/`confidenceFromCov`) → Tasks 3, 4. ✓
- NFR-2 no deps / NFR-3 constants access → all tasks. ✓
- SC-1…SC-6 → covered; the real-pass smoke test pins length 25 + carried window_id. ✓

**2. Placeholder scan:** No TBD/TODO; every code step is complete and runnable.

**3. Type consistency:** `point` shape `{t,x,y,acc,speedNative}` is produced by `projectFixes` (Task 2) and consumed by `smooth`/`forwardFilter` (Task 3) and `classifyWindow`/`inWindowDoppler` (Task 4) identically. `smooth` returns `{t, s:[4], P}`; `evaluateAt` consumes that and returns `{s:[4], P}`; `windowMotion` reads `s[2]/s[3]` and `P[2][2]/P[3][3]`. The window record keys match across Task 4 and the spec §6. `solve`/`matMul`/etc. signatures match Task 1.

**Note on the gap test (corrected from spec §9):** a `gap_unscored` window must be `> GAP_MAX_S` from its *nearest* fix, i.e. inside a hole wider than `2·GAP_MAX_S` (~20 s). The test therefore uses a 26 s hole for `gap_unscored` and a ~3.5 s distance for `interpolated`. The real 16 s pass gap yields `interpolated` windows (midpoint ~8 s from each fix), which is what the smoke test asserts. The spec's §9 example wording is being corrected to match.

---

## Execution

Use **superpowers:subagent-driven-development**, Sonnet per task (user rule), sequential. All four tasks gate on green node tests; the Task 4 checkpoint runs the full `npm test`.
