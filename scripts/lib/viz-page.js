// scripts/lib/viz-page.js
// Emit a small, DATA-DRIVEN research page. The generated HTML is a SHELL: at load
// time it FETCHES the pipeline's JSON and builds SVG (text/line/rect/path) in the
// browser. No pre-rendered SVG elements and no embedded data arrays ever go into the
// HTML — the same JSON the scorer writes is the single source of truth, loaded
// directly. Pages are served by scripts/serve-out.js from the repo root, so the
// fetch() calls are same-origin and resolve without CORS.
//
// Why: baking thousands of <rect>/<line> (or a MB of JSON.stringify) into the HTML
// makes a file that is huge, not reusable, and un-inspectable — a failure mode.
// A shell + fetch keeps the artifact tiny and lets a collaborator open the same
// JSON in any other tool.
"use strict";

const BASE_CSS = `:root{color-scheme:dark}
*{box-sizing:border-box}
body{background:#1a1a1a;color:#dcdcdc;font-family:system-ui,sans-serif;margin:1.2rem}
#chart{max-width:1240px}
#chart svg{max-width:100%;height:auto}
#status{color:#9fb7d4;font-size:.9rem;margin:.4rem 0}
#err{display:none;color:#ff9b7a;background:#3a2420;border:1px solid #7a4a3a;border-radius:6px;padding:.6rem .9rem;margin-top:1rem;max-width:1240px}
.panel{background:#555;padding:.8rem 1rem;border-radius:6px;max-width:1240px;margin-top:1rem;line-height:1.5}
.sw{display:inline-block;width:22px;height:10px;border-radius:2px;vertical-align:middle;margin-right:6px}
code{background:#666;padding:0 4px;border-radius:3px}`;

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Convert an on-disk path ("out/score-jc4/squelch-clean.json") to a repo-root URL
// ("/out/score-jc4/squelch-clean.json") that serve-out.js can resolve. Passthrough
// for values that are already URLs (leading "/"); null stays null (optional source).
function toUrl(p) {
  if (!p) return null;
  return "/" + String(p).replace(/\\/g, "/").replace(/^\/+/, "");
}

// buildPage({ title, headCss?, bodyTop?, bodyBottom?, urls, config?, clientFn })
//   urls:     { name: url|null }  — fetched in parallel; null entries pass through as null
//   config:   plain JSON handed to the client (title, flags, labels — NOT bulk data)
//   clientFn: BROWSER function (sources, config, mount) => void
//             sources = { name: parsedJson|null }, mount = the #chart element.
// Returns the HTML string.
function buildPage(opts) {
  const { title, headCss = "", bodyTop = "", bodyBottom = "", urls, config = {}, clientFn } = opts;
  if (!urls || typeof clientFn !== "function") throw new Error("buildPage: urls and clientFn are required");
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><title>${esc(title)}</title>
<style>${BASE_CSS}${headCss}</style></head><body>
${bodyTop}
<div id="status" role="status">Loading data…</div>
<div id="chart"></div>
<div id="err" role="alert"></div>
${bodyBottom}
<script>
"use strict";
var URLS = ${JSON.stringify(urls)}, CONFIG = ${JSON.stringify(config)};
var CLIENT = (${clientFn.toString()});
(function () {
  var chart = document.getElementById("chart"),
      status = document.getElementById("status"),
      err = document.getElementById("err");
  var names = Object.keys(URLS);
  Promise.all(names.map(function (n) {
    if (!URLS[n]) return Promise.resolve(null);
    return fetch(URLS[n]).then(function (r) {
      if (!r.ok) throw new Error(URLS[n] + " \\u2192 HTTP " + r.status);
      return r.json();
    });
  })).then(function (vals) {
    var s = {}; names.forEach(function (n, i) { s[n] = vals[i]; });
    if (status) status.style.display = "none";
    CLIENT(s, CONFIG, chart);
  }).catch(function (e) {
    if (status) status.style.display = "none";
    err.style.display = "block";
    err.textContent = "Could not load data: " + e.message +
      ". This page reads the pipeline JSON live \\u2014 serve the repo root with " +
      "scripts/serve-out.js (localhost:8137) and open the page from there.";
  });
})();
</script></body></html>`;
}

module.exports = { buildPage, toUrl, esc, BASE_CSS };
