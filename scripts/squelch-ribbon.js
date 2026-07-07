// scripts/squelch-ribbon.js
// Spectral-chaos "ribbon" view of ONE pass, rendered from the pipeline's squelch-clean.json.
// The renderer itself lives in the shared ribbon-render.js (so this page and analyze.html are
// byte-identical); this generator only emits the shell that fetches squelch-clean.json and calls
// window.SensoryNavRibbon.drawRibbon. No data or SVG is baked in. Serve the repo root with
// scripts/serve-out.js (localhost:8137).
//
// Usage: node scripts/squelch-ribbon.js <squelch-clean.json> <out.html> [label]
"use strict";
const fs = require("fs");
const path = require("path");
const { buildPage, toUrl } = require("./lib/viz-page");

const LEGEND = '<div class="panel">' +
  '<div><b>Ribbon width = chaos</b> (spectral flatness, 1&nbsp;&minus;&nbsp;tonality): a steady tone or clean ' +
  'engine drone reads thin; broadband road/gravel/impacts read wide.</div>' +
  '<div style="margin-top:.4rem"><span class="sw" style="background:#3a6fd8"></span>blue = <b>tonal / rhythmic</b> ' +
  '(habituated) &nbsp; <span class="sw" style="background:#ebd73c"></span>yellow = <b>chaotic / noise-like</b> ' +
  '(novel, strobe-like). Thickness carries chaos too, so the panel stays legible without colour.</div>' +
  '<div style="margin-top:.4rem">Rendered live from <code>squelch-clean.json</code> ' +
  '(scripts/squelch-extract.js). Serve the repo root with <code>node scripts/serve-out.js</code>.</div></div>';

const squelchPath = process.argv[2], outPath = process.argv[3], label = process.argv[4] || "pass";
if (!squelchPath || !outPath) {
  console.error("usage: node scripts/squelch-ribbon.js <squelch-clean.json> <out.html> [label]");
  process.exit(1);
}
const url = toUrl(squelchPath);
const html = buildPage({
  title: label + " spectral-chaos ribbon",
  urls: { squelch: url },
  config: { label },
  scripts: ["ribbon-render.js"],
  clientFn: function (sources, cfg, mount) { window.SensoryNavRibbon.drawRibbon(sources, cfg, mount); },
  bodyBottom: LEGEND
});
fs.writeFileSync(outPath, html);
// ship the shared renderer next to the page (linked relatively), like timeline.css
fs.copyFileSync(path.join(__dirname, "..", "ribbon-render.js"), path.join(path.dirname(outPath) || ".", "ribbon-render.js"));
console.log("wrote", outPath, "+ ribbon-render.js → fetches", url, "(no data or renderer baked into the HTML)");
