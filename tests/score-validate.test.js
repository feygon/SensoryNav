// tests/score-validate.test.js
"use strict";
const assert = require("assert");
const { validatePass, validateBatch } = require("../harness/score/validate");

function rec(rr, present, mag, rel) {
  return { roughness_raw: rr, roughness_null: rr, reliability: rel == null ? 1 : rel, felt_present: present, felt_magnitude: present ? mag : null };
}

// Perfect separation + monotone magnitude → AUC 1, spearman 1.
const perfect = [rec(1, false, null), rec(2, false, null), rec(40, true, 2), rec(80, true, 4), rec(60, true, 3)];
const v = validatePass(perfect, { DETECT_TAU: 12, MIN_SPEARMAN_N: 3 });
assert.strictEqual(v.presence.status, "ok");
assert.ok(Math.abs(v.presence.auc - 1) < 1e-9);
assert.ok(Math.abs(v.magnitude.spearman - 1) < 1e-9);
assert.strictEqual(v.magnitude.n, 3);

// reliability==0 rows excluded from counts.
const withDead = perfect.concat([rec(99, true, 9, 0)]);
const v2 = validatePass(withDead, { DETECT_TAU: 12, MIN_SPEARMAN_N: 3 });
assert.strictEqual(v2.n_excluded, 1);

// no felt at all → status no_felt.
const none = [rec(1, false, null), rec(2, false, null)];
assert.strictEqual(validatePass(none, {}).presence.status, "no_felt");

// all-present → degenerate labels.
const allPos = [rec(10, true, 1), rec(20, true, 2)];
assert.strictEqual(validatePass(allPos, {}).presence.status, "degenerate_labels");

// too few felt-present → magnitude unstable.
const few = [rec(1, false, null), rec(50, true, 3), rec(60, true, 4)];
assert.strictEqual(validatePass(few, { MIN_SPEARMAN_N: 5 }).magnitude.status, "unstable");

// batch: per-pass + re-pooled aggregate.
const batch = validateBatch([perfect, perfect], { DETECT_TAU: 12, MIN_SPEARMAN_N: 3 });
assert.strictEqual(batch.per_pass.length, 2);
assert.ok(Math.abs(batch.aggregate.presence.auc - 1) < 1e-9);

console.log("score-validate tests passed");
