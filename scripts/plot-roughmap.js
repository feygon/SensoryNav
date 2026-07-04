// scripts/plot-roughmap.js
// Render the aggregated rough-spot map: the road (drawn by the GPS cells themselves)
// colored by median roughness across passes, with agreement (how many passes call a cell
// rough) shown as dot size + a ring on the confident ones. Self-contained dark-mode SVG.
// Reads out/score-agg/rough-cells.json (from aggregate-rough.js). Writes an HTML file.
// Usage: node scripts/plot-roughmap.js [out.html]
"use strict";
const fs = require("fs");

const outPath = process.argv[2] || "out/score/roughmap.html";
const agg = JSON.parse(fs.readFileSync("out/score-agg/rough-cells.json", "utf8"));
const cells = agg.cells;

const MLAT = 111000, DEG = Math.PI / 180;
const lats = cells.map((c) => c.lat), lons = cells.map((c) => c.lon);
const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
const MLON = MLAT * Math.cos(lat0 * DEG);
// equirectangular metres relative to centre
const xs = cells.map((c) => (c.lon - lons.reduce((s, v) => s + v, 0) / lons.length) * MLON);
const ys = cells.map((c) => (c.lat - lats.reduce((s, v) => s + v, 0) / lats.length) * MLAT);
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);

const pad = 46, W = 1240;
const spanX = maxX - minX, spanY = maxY - minY;
const plotW = W - 2 * pad;
const scale = plotW / spanX;
const plotH = spanY * scale;
const H = plotH + 2 * pad + 108; // room for title + legend
const px = (x) => pad + (x - minX) * scale;
const py = (y) => pad + 40 + (maxY - y) * scale; // north up

// Roughness color ramp: CVD-safe blue (calm) -> yellow (rough), the project's heat convention.
const roughLo = 1.5, roughHi = 7.0; // dB above floor; clamp for color
function lerp(a, b, t) { return a + (b - a) * t; }
function roughColor(dB) {
  const t = Math.max(0, Math.min(1, (dB - roughLo) / (roughHi - roughLo)));
  // blue #3a6fd8 -> teal #2fb0a0 -> yellow #ffd23f
  let r, g, b;
  if (t < 0.5) { const u = t / 0.5; r = lerp(58, 47, u); g = lerp(111, 176, u); b = lerp(216, 160, u); }
  else { const u = (t - 0.5) / 0.5; r = lerp(47, 255, u); g = lerp(176, 210, u); b = lerp(160, 63, u); }
  return "rgb(" + Math.round(r) + "," + Math.round(g) + "," + Math.round(b) + ")";
}
function radius(c) { return 3 + c.nPasses * 0.9; } // coverage -> size
const CHOP = agg.chop_tau || 6.6;
// worst-chop = a pass hit serious chop here but consensus missed it (typically only the
// pass that crawled slowly enough sensed it — the low-speed turnoff etc.).
const isChop = (c) => (c.peak != null && c.peak > CHOP && c.nRough < 3);
const isConsistent = (c) => (c.nRough >= 3 && c.nPasses >= 3);

// order: draw calm first, rough on top; worst-chop last so it is never occluded
const ordered = cells.slice().sort((a, b) => (isChop(a) - isChop(b)) || (a.med - b.med));
let dots = "";
for (const c of ordered) {
  const cx = px((c.lon - lons.reduce((s, v) => s + v, 0) / lons.length) * MLON);
  const cy = py((c.lat - lats.reduce((s, v) => s + v, 0) / lats.length) * MLAT);
  const chop = isChop(c);
  // consistent-field cells keep median color; missed worst-chop cells show their PEAK
  const color = chop ? roughColor(c.peak) : roughColor(c.med);
  const r = chop ? Math.max(radius(c), 6) : radius(c);
  let ring = "";
  if (isConsistent(c)) ring = '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (r + 3).toFixed(1) + '" fill="none" stroke="#ff785a" stroke-width="1.6"/>';
  else if (chop) ring = '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (r + 3).toFixed(1) + '" fill="none" stroke="#ffa640" stroke-width="1.6" stroke-dasharray="3 2"/>';
  dots += ring + '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + color + '" fill-opacity="0.9"/>';
}

// legend: color ramp + size + ring
let ramp = "";
const lx = pad, ly = H - 42, lw = 260;
for (let i = 0; i <= lw; i += 4) {
  const dB = roughLo + (i / lw) * (roughHi - roughLo);
  ramp += '<rect x="' + (lx + i) + '" y="' + ly + '" width="4" height="12" fill="' + roughColor(dB) + '"/>';
}

const confidentCount = cells.filter(isConsistent).length;
const chopCount = cells.filter(isChop).length;
const svg = '<svg id="map" width="' + W + '" height="' + H.toFixed(0) + '" viewBox="0 0 ' + W + ' ' + H.toFixed(0) + '" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif" style="max-width:100%;height:auto">'
  + '<rect x="0" y="0" width="' + W + '" height="' + H.toFixed(0) + '" fill="#1a1a1a"/>'
  + '<text x="' + pad + '" y="28" fill="#dcdcdc" font-size="17" font-weight="600">Johnson Creek Rd — aggregated roughness over 5 passes (ICC ' + agg.icc.toFixed(2) + ')</text>'
  + dots
  + ramp
  + '<text x="' + lx + '" y="' + (ly - 6) + '" fill="#dcdcdc" font-size="12">median roughness (dB above floor)</text>'
  + '<text x="' + lx + '" y="' + (ly + 26) + '" fill="#8fa" font-size="11">' + roughLo + ' (calm)</text>'
  + '<text x="' + (lx + lw - 26) + '" y="' + (ly + 26) + '" fill="#ffd23f" font-size="11">' + roughHi.toFixed(0) + '+ (rough)</text>'
  + '<circle cx="' + (lx + lw + 60) + '" cy="' + (ly - 2) + '" r="8" fill="none" stroke="#ff785a" stroke-width="1.6"/>'
  + '<text x="' + (lx + lw + 74) + '" y="' + (ly + 2) + '" fill="#dcdcdc" font-size="12">consistent rough (' + confidentCount + '): &ge;3 passes agree</text>'
  + '<circle cx="' + (lx + lw + 60) + '" cy="' + (ly + 16) + '" r="8" fill="none" stroke="#ffa640" stroke-width="1.6" stroke-dasharray="3 2"/>'
  + '<text x="' + (lx + lw + 74) + '" y="' + (ly + 20) + '" fill="#dcdcdc" font-size="12">worst chop (' + chopCount + '): one pass hit it hard (usually low-speed)</text>'
  + '<text x="' + lx + '" y="' + (ly + 40) + '" fill="#888" font-size="11">dot size = number of passes covering the cell &middot; ' + cells.length + ' cells, ' + agg.cell_m + 'm grid &middot; north up</text>'
  + '</svg>';

const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark">'
  + '<title>Johnson Creek aggregated roughness map</title>'
  + '<style>:root{color-scheme:dark}body{background:#1a1a1a;color:#dcdcdc;font-family:system-ui,sans-serif;margin:1.2rem}'
  + '.panel{background:#555;padding:.8rem 1rem;border-radius:6px;max-width:1240px;margin-top:1rem;line-height:1.5}</style></head><body>'
  + svg
  + '<div class="panel">The road is drawn by the GPS cells themselves (north up). Each dot is a ~' + agg.cell_m + 'm stretch, colored by its <b>median roughness across the passes that drove it</b> '
  + '(<span style="color:#3a6fd8">blue = calm</span> &rarr; <span style="color:#ffd23f">yellow = rough</span>), sized by how many of the 5 passes covered it. '
  + 'A <b style="color:#ff785a">solid red ring</b> marks a <b>consistent rough spot</b> (&ge;3 passes agree). A <b style="color:#ffa640">dashed orange ring</b> marks a <b>worst-chop spot</b> the consensus misses &mdash; a pass hit serious chop there (peak &gt; ' + (agg.chop_tau || 0).toFixed(1) + ' dB) but usually only the pass that <b>crawled slowly enough sensed it</b> (e.g. the low-speed turnoff); those dots are colored by their peak, not median. '
  + 'Reproducibility: <b>ICC ' + agg.icc.toFixed(2) + '</b> (63% of roughness variance is explained by location, not pass-to-pass noise); '
  + 'split-half agreement <b>&rho; ' + agg.splitR.toFixed(2) + '</b>. Talking windows are excluded; each pass scored on its own baseline.</div>'
  + '</body></html>';

fs.writeFileSync(outPath, html);
console.log("wrote", outPath, "-", cells.length, "cells,", confidentCount, "confident rough spots");
