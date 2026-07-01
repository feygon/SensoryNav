// tests/score-metrics.test.js
"use strict";
const assert = require("assert");
const { quantile, weightedQuantile, spearman, weightedSpearman, rocAuc, precisionRecall, bestF1Threshold } = require("../harness/score/metrics");
const close = (a, b, t = 1e-9) => Math.abs(a - b) < t;

// quantile: median of 1..5 = 3; 0.25 interpolates.
assert.ok(close(quantile([5, 1, 3, 2, 4], 0.5), 3));
assert.ok(close(quantile([0, 10], 0.1), 1));
assert.throws(() => quantile([], 0.5), /empty/);

// weightedQuantile: all-equal weights behaves like a step quantile; weight shifts it.
assert.strictEqual(weightedQuantile([1, 2, 3, 4], [1, 1, 1, 1], 0.5), 2);
assert.strictEqual(weightedQuantile([1, 2, 3], [10, 1, 1], 0.1), 1); // mass at 1

// spearman: monotone → 1, antitone → -1, ties handled.
assert.ok(close(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1));
assert.ok(close(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1));
assert.ok(Number.isNaN(spearman([1], [1])));
assert.ok(close(weightedSpearman([1, 2, 3, 4], [1, 2, 3, 4], [1, 1, 1, 1]), 1));

// rocAuc: perfect separation = 1; reversed = 0; degenerate = NaN.
assert.ok(close(rocAuc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1]), 1));
assert.ok(close(rocAuc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1]), 0));
assert.ok(Number.isNaN(rocAuc([0.1, 0.2], [1, 1])));

// precisionRecall at threshold 0.5: predicted positive = scores>0.5.
const pr = precisionRecall([0.9, 0.6, 0.4, 0.1], [1, 0, 1, 0], 0.5);
assert.ok(close(pr.precision, 0.5) && close(pr.recall, 0.5));
assert.ok(close(pr.f1, 0.5));

// bestF1Threshold finds the separating threshold (f1 = 1).
const best = bestF1Threshold([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1]);
assert.ok(close(best.f1, 1));

console.log("score-metrics tests passed");
