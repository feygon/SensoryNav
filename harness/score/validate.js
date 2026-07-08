// harness/score/validate.js
"use strict";
var { rocAuc, precisionRecall, bestF1Threshold, weightedSpearman } = (typeof require !== "undefined") ? require("./metrics") : self.SensoryNavScore;

const DEFAULTS = { DETECT_TAU: 12, MIN_SPEARMAN_N: 5 };

function buildSummary(scored, p) {
  const kept = scored.filter((r) => r.reliability > 0);
  const labels = kept.map((r) => (r.felt_present ? 1 : 0));
  const w = kept.map((r) => r.reliability);
  const scores = kept.map((r) => r.roughness_raw);
  const scoresNull = kept.map((r) => r.roughness_null);
  const nPos = labels.reduce((s, x) => s + x, 0);

  let presence;
  if (nPos === 0) {
    presence = { auc: NaN, auc_null: NaN, pr: null, pr_null: null, best_f1: null, status: "no_felt" };
  } else if (nPos === labels.length) {
    presence = { auc: NaN, auc_null: NaN, pr: null, pr_null: null, best_f1: null, status: "degenerate_labels" };
  } else {
    presence = {
      auc: rocAuc(scores, labels, w),
      auc_null: rocAuc(scoresNull, labels, w),
      pr: precisionRecall(scores, labels, p.DETECT_TAU, w),
      pr_null: precisionRecall(scoresNull, labels, p.DETECT_TAU, w),
      best_f1: bestF1Threshold(scores, labels, w),
      status: "ok"
    };
  }

  const present = kept.filter((r) => r.felt_present);
  let magnitude;
  if (!present.length) {
    magnitude = { spearman: NaN, spearman_null: NaN, n: 0, status: "no_felt" };
  } else {
    const ms = present.map((r) => r.roughness_raw);
    const mn = present.map((r) => r.roughness_null);
    const mm = present.map((r) => r.felt_magnitude);
    const mw = present.map((r) => r.reliability);
    magnitude = {
      spearman: weightedSpearman(ms, mm, mw),
      spearman_null: weightedSpearman(mn, mm, mw),
      n: present.length,
      status: present.length < p.MIN_SPEARMAN_N ? "unstable" : "ok"
    };
  }

  return { n_total: scored.length, n_excluded: scored.length - kept.length, presence, magnitude };
}

function validatePass(scored, params) {
  return buildSummary(scored, Object.assign({}, DEFAULTS, params || {}));
}

function validateBatch(perPassScored, params) {
  const p = Object.assign({}, DEFAULTS, params || {});
  const pooled = [];
  for (const s of perPassScored) for (const r of s) pooled.push(r);
  return { per_pass: perPassScored.map((s) => buildSummary(s, p)), aggregate: buildSummary(pooled, p) };
}

// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { validatePass, validateBatch };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
