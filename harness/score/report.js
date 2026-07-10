// harness/score/report.js
// Pure formatters for a scored pass: JSON/CSV serialization + a self-contained dark-mode
// inspection HTML page. No file IO of its own — the caller (run-scorer.js) writes the returned
// strings to disk.
// @unit-begin
// unit:        report
// causality:   acausal
// state:       none
// mutates:     none
// contract:    scoredWindowsJson(scored) -> string
//              sessionSummaryJson(summary) -> string
//              scoredWindowsCsv(scored) -> string
//              inspectionHtml(scored,summary) -> string
// deps:        —
// realtime:    batch-only
// tested-by:   tests/score-report.test.js
// @unit-end
"use strict";

const COLS = ["window_id", "started_at_ms", "lat", "lon", "speed_mps", "heading_deg",
  "roughness_raw", "roughness", "detected", "magnitude", "roughness_null",
  "reliability", "reliability_flags", "speed_source", "sp2_flags", "felt_present", "felt_magnitude"];

function scoredWindowsJson(scored) { return JSON.stringify(scored, null, 2); }
function sessionSummaryJson(summary) { return JSON.stringify(summary, null, 2); }

function csvCell(v) {
  if (Array.isArray(v)) v = v.join("|");
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function scoredWindowsCsv(scored) {
  const rows = [COLS.join(",")];
  for (const r of scored) rows.push(COLS.map((c) => csvCell(r[c])).join(","));
  return rows.join("\n") + "\n";
}

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function inspectionHtml(scored, summary) {
  const anyScorable = scored.some((r) => r.reliability > 0);
  const head = `<!doctype html><html><head><meta charset="utf-8"><title>SensoryNav SP3 inspection</title>
<style>
  body{background:#1a1a1a;color:#dcdcdc;font-family:system-ui,sans-serif;margin:1rem;}
  .panel{background:#555;padding:1rem;border-radius:6px;margin-bottom:1rem;}
  table{border-collapse:collapse;width:100%;} th,td{border:1px solid #666;padding:4px 8px;text-align:right;}
  th{background:#666;} td.id{text-align:left;} tr.dead{color:#888;}
</style></head><body>`;
  const summaryPanel = `<div class="panel"><h2>Session summary</h2><pre>${esc(JSON.stringify(summary.aggregate || summary, null, 2))}</pre></div>`;
  if (!anyScorable) {
    return head + summaryPanel + `<div class="panel"><strong>No scorable windows</strong> — every window had reliability 0.</div></body></html>`;
  }
  const header = "<tr>" + COLS.map((c) => `<th>${c}</th>`).join("") + "</tr>";
  const body = scored.map((r) => {
    const cls = r.reliability === 0 ? ' class="dead"' : "";
    return `<tr${cls}>` + COLS.map((c) => {
      const v = Array.isArray(r[c]) ? r[c].join("|") : (r[c] === null || r[c] === undefined ? "" : r[c]);
      return `<td${c === "window_id" ? ' class="id"' : ""}>${esc(v)}</td>`;
    }).join("") + "</tr>";
  }).join("");
  return head + summaryPanel + `<table>${header}${body}</table></body></html>`;
}

module.exports = { scoredWindowsJson, sessionSummaryJson, scoredWindowsCsv, inspectionHtml };
