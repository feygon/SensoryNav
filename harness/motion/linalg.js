// harness/motion/linalg.js
// Small dense-matrix ops (arrays-of-arrays) backing the Kalman smoother: multiply, transpose,
// identity, add/sub, scale, and Gauss-Jordan solve.
// @unit-begin
// unit:        linalg
// causality:   pure
// state:       none
// mutates:     none
// contract:    matMul(A,B) -> C
//              transpose(A) -> T
//              identity(n) -> I
//              matAdd(A,B) -> C
//              matSub(A,B) -> C
//              scale(A,k) -> C
//              solve(A,B) -> X
// deps:        —
// realtime:    reuse-as-is
// tested-by:   tests/linalg.test.js
// @unit-end
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

// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { matMul, transpose, identity, matAdd, matSub, scale, solve };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
