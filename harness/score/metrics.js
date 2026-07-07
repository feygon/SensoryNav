// harness/score/metrics.js
"use strict";

function quantile(values, q) {
  if (!values.length) throw new Error("quantile: empty");
  const v = values.slice().sort((a, b) => a - b);
  const pos = q * (v.length - 1);
  const lo = Math.floor(pos), frac = pos - lo;
  if (lo + 1 >= v.length) return v[lo];
  return v[lo] + frac * (v[lo + 1] - v[lo]);
}

function weightedQuantile(values, weights, q) {
  const w = weights || values.map(() => 1);
  const pairs = values.map((v, i) => [v, w[i]]).sort((a, b) => a[0] - b[0]);
  const total = pairs.reduce((s, p) => s + p[1], 0);
  if (total <= 0) throw new Error("quantile: empty");
  const target = q * total;
  let cum = 0;
  for (const [v, wi] of pairs) { cum += wi; if (cum >= target) return v; }
  return pairs[pairs.length - 1][0];
}

function rankAverage(xs) {
  const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1; // 1-based average rank
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = r;
    i = j + 1;
  }
  return ranks;
}

function weightedPearson(xs, ys, weights) {
  const w = weights || xs.map(() => 1);
  const W = w.reduce((s, x) => s + x, 0);
  if (xs.length < 2 || W <= 0) return NaN;
  const mx = xs.reduce((s, x, i) => s + w[i] * x, 0) / W;
  const my = ys.reduce((s, y, i) => s + w[i] * y, 0) / W;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    cov += w[i] * dx * dy; vx += w[i] * dx * dx; vy += w[i] * dy * dy;
  }
  if (vx <= 0 || vy <= 0) return NaN;
  return cov / Math.sqrt(vx * vy);
}

function spearman(xs, ys) { return weightedSpearman(xs, ys, null); }
function weightedSpearman(xs, ys, weights) {
  if (xs.length < 2) return NaN;
  return weightedPearson(rankAverage(xs), rankAverage(ys), weights);
}

function rocAuc(scores, labels, weights) {
  const w = weights || scores.map(() => 1);
  let Wp = 0, Wn = 0;
  for (let i = 0; i < labels.length; i++) (labels[i] ? Wp += w[i] : Wn += w[i]);
  if (Wp === 0 || Wn === 0) return NaN;
  let num = 0;
  for (let i = 0; i < scores.length; i++) {
    if (!labels[i]) continue;
    for (let j = 0; j < scores.length; j++) {
      if (labels[j]) continue;
      if (scores[i] > scores[j]) num += w[i] * w[j];
      else if (scores[i] === scores[j]) num += 0.5 * w[i] * w[j];
    }
  }
  return num / (Wp * Wn);
}

function precisionRecall(scores, labels, threshold, weights) {
  const w = weights || scores.map(() => 1);
  let tp = 0, fp = 0, fn = 0;
  for (let i = 0; i < scores.length; i++) {
    const pred = scores[i] > threshold;
    if (pred && labels[i]) tp += w[i];
    else if (pred && !labels[i]) fp += w[i];
    else if (!pred && labels[i]) fn += w[i];
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

function bestF1Threshold(scores, labels, weights) {
  const cands = Array.from(new Set(scores)).sort((a, b) => a - b);
  // include a threshold just below the smallest score so "all predicted positive" is reachable
  cands.unshift(cands.length ? cands[0] - 1 : 0);
  let best = { threshold: cands[0], f1: -1 };
  for (const t of cands) {
    const { f1 } = precisionRecall(scores, labels, t, weights);
    if (f1 > best.f1) best = { threshold: t, f1 };
  }
  return best;
}

// Dual-mode: Node via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { quantile, weightedQuantile, spearman, weightedSpearman, rocAuc, precisionRecall, bestF1Threshold };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
