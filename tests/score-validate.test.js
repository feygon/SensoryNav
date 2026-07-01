// tests/score-validate.test.js
"use strict";
const assert = require("assert");
const { validatePass, validateBatch } = require("../harness/score/validate");

function rec(rr, present, mag, rel) {
  return { roughness_raw: rr, roughness_null: rr, reliability: rel == null ? 1 : rel, felt_present: present, felt_magnitude: present ? mag : null };
}

// rec2: like rec but lets roughness_null differ from roughness_raw.
function rec2(rr, rn, present, mag, rel) {
  return { roughness_raw: rr, roughness_null: rn, reliability: rel == null ? 1 : rel, felt_present: present, felt_magnitude: present ? mag : null };
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

// Null-vs-real A/B: roughness_null is DISTINCT from roughness_raw.
//
// Presence AUC:
//   roughness_raw  → absent=[1,2], present=[80,90,100] → perfect separation → auc=1
//   roughness_null → absent=[80,90], present=[1,2,3]  → reversed ordering   → auc=0
//
// Magnitude spearman:
//   roughness_raw  vs felt_magnitude=[2,4,6] → monotone ascending → spearman=+1
//   roughness_null vs felt_magnitude=[2,4,6] → monotone descending (100,50,10) → spearman=-1
const abRecords = [
  rec2(1,   80, false, null),  // absent: raw=low, null=high
  rec2(2,   90, false, null),  // absent: raw=low, null=high
  rec2(80,  3,  true,  2),     // present: raw=high, null=low, mag=2
  rec2(90,  2,  true,  4),     // present: raw=high, null=lower, mag=4
  rec2(100, 1,  true,  6),     // present: raw=highest, null=lowest, mag=6
];
const vAB = validatePass(abRecords, { DETECT_TAU: 12, MIN_SPEARMAN_N: 3 });

// presence AUC from roughness_raw must be perfect (1.0)
assert.ok(Math.abs(vAB.presence.auc - 1) < 1e-9, `expected auc=1 got ${vAB.presence.auc}`);
// presence AUC from roughness_null must be strictly worse than roughness_raw AUC
assert.ok(vAB.presence.auc_null < vAB.presence.auc,
  `expected auc_null(${vAB.presence.auc_null}) < auc(${vAB.presence.auc})`);
// magnitude spearman from roughness_raw must be +1 (monotone)
assert.ok(Math.abs(vAB.magnitude.spearman - 1) < 1e-9,
  `expected spearman=1 got ${vAB.magnitude.spearman}`);
// magnitude spearman from roughness_null must be strictly less (inverted ordering → negative)
assert.ok(vAB.magnitude.spearman_null < vAB.magnitude.spearman,
  `expected spearman_null(${vAB.magnitude.spearman_null}) < spearman(${vAB.magnitude.spearman})`);

console.log("score-validate tests passed");
