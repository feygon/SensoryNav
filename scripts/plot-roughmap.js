// scripts/plot-roughmap.js
// Aggregated rough-spot map: the road drawn by its own GPS cells, colored by median
// roughness across passes; agreement = dot size + a ring on confident cells.
//
// ARCHITECTURE: the generator bakes NO SVG. It emits a small shell (scripts/lib/viz-page.js)
// that FETCHES out/score-agg/rough-cells.json at load time and builds every <circle>/<rect>/
// <text> in the browser from that JSON. Serve the repo root with scripts/serve-out.js.
// Usage: node scripts/plot-roughmap.js [out.html]
"use strict";
const fs = require("fs");
const { buildPage, toUrl } = require("./lib/viz-page");

// ---- browser renderer: builds the map SVG from the fetched rough-cells.json ----
function drawMap(sources, cfg, mount) {
  const agg = sources.agg;
  if (!agg || !agg.cells) { mount.textContent = "no aggregate data"; return; }
  const cells = agg.cells;
  const MLAT = 111000, DEG = Math.PI / 180;
  const lats = cells.map((c) => c.lat), lons = cells.map((c) => c.lon);
  const lat0 = (Math.min.apply(null, lats) + Math.max.apply(null, lats)) / 2;
  const MLON = MLAT * Math.cos(lat0 * DEG);
  const lonC = lons.reduce((s, v) => s + v, 0) / lons.length;
  const latC = lats.reduce((s, v) => s + v, 0) / lats.length;
  const xs = cells.map((c) => (c.lon - lonC) * MLON);
  const ys = cells.map((c) => (c.lat - latC) * MLAT);
  const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
  const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  const pad = 46, W = 1240, spanX = maxX - minX, spanY = maxY - minY;
  const plotW = W - 2 * pad, scale = plotW / spanX, plotH = spanY * scale;
  const H = plotH + 2 * pad + 108;
  const px = (x) => pad + (x - minX) * scale;
  const py = (y) => pad + 40 + (maxY - y) * scale; // north up

  const roughLo = 1.5, roughHi = 7.0;
  const lerp = (a, b, t) => a + (b - a) * t;
  function roughColor(dB) {
    const t = Math.max(0, Math.min(1, (dB - roughLo) / (roughHi - roughLo)));
    let r, g, b;
    if (t < 0.5) { const u = t / 0.5; r = lerp(58, 47, u); g = lerp(111, 176, u); b = lerp(216, 160, u); }
    else { const u = (t - 0.5) / 0.5; r = lerp(47, 255, u); g = lerp(176, 210, u); b = lerp(160, 63, u); }
    return "rgb(" + Math.round(r) + "," + Math.round(g) + "," + Math.round(b) + ")";
  }
  const radius = (c) => 3 + c.nPasses * 0.9;
  const CHOP = agg.chop_tau || 6.6;
  const isChop = (c) => (c.peak != null && c.peak > CHOP && c.nRough < 3);
  const isConsistent = (c) => (c.nRough >= 3 && c.nPasses >= 3);

  const ordered = cells.slice().sort((a, b) => ((isChop(a) - isChop(b)) || (a.med - b.med)));
  let dots = "";
  ordered.forEach((c) => {
    const cx = px((c.lon - lonC) * MLON), cy = py((c.lat - latC) * MLAT);
    const chop = isChop(c);
    const color = chop ? roughColor(c.peak) : roughColor(c.med);
    const r = chop ? Math.max(radius(c), 6) : radius(c);
    let ring = "";
    if (isConsistent(c)) ring = '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (r + 3).toFixed(1) + '" fill="none" stroke="#ff785a" stroke-width="1.6"/>';
    else if (chop) ring = '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (r + 3).toFixed(1) + '" fill="none" stroke="#ffa640" stroke-width="1.6" stroke-dasharray="3 2"/>';
    dots += ring + '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + color + '" fill-opacity="0.9"/>';
  });

  let ramp = "";
  const lx = pad, ly = H - 42, lw = 260;
  for (let i = 0; i <= lw; i += 4) ramp += '<rect x="' + (lx + i) + '" y="' + ly + '" width="4" height="12" fill="' + roughColor(roughLo + (i / lw) * (roughHi - roughLo)) + '"/>';
  const confidentCount = cells.filter(isConsistent).length, chopCount = cells.filter(isChop).length;

  mount.innerHTML = '<svg id="map" width="' + W + '" height="' + H.toFixed(0) + '" viewBox="0 0 ' + W + " " + H.toFixed(0) +
    '" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif" style="max-width:100%;height:auto">' +
    '<rect x="0" y="0" width="' + W + '" height="' + H.toFixed(0) + '" fill="#1a1a1a"/>' +
    '<text x="' + pad + '" y="28" fill="#dcdcdc" font-size="17" font-weight="600">Johnson Creek Rd — aggregated roughness over 5 passes (ICC ' + agg.icc.toFixed(2) + ')</text>' +
    dots + ramp +
    '<text x="' + lx + '" y="' + (ly - 6) + '" fill="#dcdcdc" font-size="12">median roughness (dB above floor)</text>' +
    '<text x="' + lx + '" y="' + (ly + 26) + '" fill="#8fa" font-size="11">' + roughLo + ' (calm)</text>' +
    '<text x="' + (lx + lw - 26) + '" y="' + (ly + 26) + '" fill="#ffd23f" font-size="11">' + roughHi.toFixed(0) + '+ (rough)</text>' +
    '<circle cx="' + (lx + lw + 60) + '" cy="' + (ly - 2) + '" r="8" fill="none" stroke="#ff785a" stroke-width="1.6"/>' +
    '<text x="' + (lx + lw + 74) + '" y="' + (ly + 2) + '" fill="#dcdcdc" font-size="12">consistent rough (' + confidentCount + '): &ge;3 passes agree</text>' +
    '<circle cx="' + (lx + lw + 60) + '" cy="' + (ly + 16) + '" r="8" fill="none" stroke="#ffa640" stroke-width="1.6" stroke-dasharray="3 2"/>' +
    '<text x="' + (lx + lw + 74) + '" y="' + (ly + 20) + '" fill="#dcdcdc" font-size="12">worst chop (' + chopCount + '): one pass hit it hard (usually low-speed)</text>' +
    '<text x="' + lx + '" y="' + (ly + 40) + '" fill="#888" font-size="11">dot size = passes covering the cell &middot; ' + cells.length + ' cells, ' + agg.cell_m + 'm grid &middot; north up</text>' +
    "</svg>";

  const panel = document.getElementById("mappanel");
  if (panel) panel.innerHTML =
    "The road is drawn by the GPS cells themselves (north up). Each dot is a ~" + agg.cell_m + "m stretch, colored by its " +
    "<b>median roughness across the passes that drove it</b> (<span style=\"color:#3a6fd8\">blue = calm</span> &rarr; " +
    "<span style=\"color:#ffd23f\">yellow = rough</span>), sized by pass coverage. A <b style=\"color:#ff785a\">solid red ring</b> " +
    "marks a <b>consistent rough spot</b> (&ge;3 passes agree); a <b style=\"color:#ffa640\">dashed orange ring</b> marks a " +
    "<b>worst-chop spot</b> the consensus misses (colored by peak). Reproducibility: <b>ICC " + agg.icc.toFixed(2) + "</b>; " +
    "split-half <b>&rho; " + (agg.splitR != null ? agg.splitR.toFixed(2) : "?") + "</b>. Talking windows excluded; each pass on its own baseline.";
}

// ---- generator: emit the shell; no data or SVG is baked in ----
const outPath = process.argv[2] || "out/score/roughmap.html";
const url = toUrl("out/score-agg/rough-cells.json");
const html = buildPage({
  title: "Johnson Creek aggregated roughness map",
  urls: { agg: url },
  config: {},
  clientFn: drawMap,
  bodyBottom: '<div class="panel" id="mappanel"></div>'
});
fs.writeFileSync(outPath, html);
console.log("wrote", outPath, "→ fetches", url, "(no data baked into the HTML)");
