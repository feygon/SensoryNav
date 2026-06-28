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
