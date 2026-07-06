"use strict";
const assert = require("assert");
const { validateTag, loadRegistry } = require("../harness/tags/schema");
const good = { name: "tonality", display: "Tonality", domain: "harmonics", definition: "x", indicators: ["comb"], detection: { method: "peak-prominence", band: "per-band", window_samples: 16384, measure: "HNR", provenance: "spec" }, value: { type: "scalar", unit: "0-1", range: [0, 1] }, confidence: { model: "reliability×sharpness×accel", basis: "peak margin" }, accel_dependency: "none", status: "proposed", discrimination_test: { dataset: "jc4", claim: "idle>road", result: "0.78 vs 0.67" }, notes: "" };
assert.strictEqual(validateTag(good).ok, true);
assert.strictEqual(validateTag({ name: "x" }).ok, false); // missing fields
const reg = loadRegistry(require("path").join(__dirname, "..", "harness", "tags", "registry"));
assert.ok(reg["tonality"] && reg["level"], "registry missing starter tags");
console.log("tags-schema tests passed");
