// tests/score-report.test.js
"use strict";
const assert = require("assert");
const { scoredWindowsJson, sessionSummaryJson, scoredWindowsCsv, inspectionHtml } = require("../harness/score/report");

const scored = [
  { window_id: "w0", started_at_ms: 0, lat: 45, lon: -122, speed_mps: 10, heading_deg: 90, roughness_raw: 17.4, roughness: 17, detected: true, magnitude: 17.4, roughness_null: 12.1, reliability: 1, reliability_flags: [], speed_source: "derived", sp2_flags: [], felt_present: true, felt_magnitude: 3 },
  { window_id: "w1", started_at_ms: 1000, lat: 45, lon: -122, speed_mps: 10, heading_deg: 90, roughness_raw: 0, roughness: 0, detected: false, magnitude: 0, roughness_null: 0, reliability: 0, reliability_flags: ["near_floor"], speed_source: "derived", sp2_flags: [], felt_present: false, felt_magnitude: null }
];
const summary = { per_pass: [], aggregate: { n_total: 2, n_excluded: 1, presence: { auc: 0.9, status: "ok" }, magnitude: { spearman: 0.8, n: 1, status: "unstable" } } };

assert.ok(scoredWindowsJson(scored).includes("\"window_id\": \"w0\""));
assert.ok(sessionSummaryJson(summary).includes("\"auc\""));

const csv = scoredWindowsCsv(scored);
const lines = csv.trim().split("\n");
assert.strictEqual(lines.length, 3);                       // header + 2 rows
assert.ok(lines[0].includes("window_id") && lines[0].includes("roughness_raw"));
assert.ok(lines[1].includes("w0"));

const html = inspectionHtml(scored, summary);
assert.ok(html.includes("#1a1a1a") && html.includes("#dcdcdc")); // dark palette
assert.ok(!/(?:src|href)\s*=\s*["']https?:/i.test(html), "HTML must not reference external http(s) resources");
assert.ok(html.includes("w0"));

// empty/fully-excluded → no-scorable-windows panel.
const deadHtml = inspectionHtml([scored[1]], summary);
assert.ok(/no scorable windows/i.test(deadHtml));

console.log("score-report tests passed");
