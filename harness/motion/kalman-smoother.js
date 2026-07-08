// harness/motion/kalman-smoother.js
"use strict";
var { matMul, transpose, matAdd, matSub, identity } = (typeof require !== "undefined") ? require("./linalg") : self.SensoryNavScore;
var { solve } = (typeof require !== "undefined") ? require("./linalg") : self.SensoryNavScore;

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

// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { smooth, evaluateAt, forwardFilter, rtsBackward, INIT_VEL_VAR };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
