// scripts/squelch-ribbon.js
// Spectral-chaos "ribbon" view of ONE pass, rendered from the pipeline's
// squelch-clean.json (the output of scripts/squelch-extract.js). For each band the
// centre line is band level (dB), the ribbon half-width encodes chaos (= 1 - tonality),
// and the hue runs blue = tonal (engine/rhythmic, habituated) -> yellow = chaotic
// (road/noise-like, novel). CVD-safe: thickness carries chaos redundantly with hue.
//
// ARCHITECTURE: this generator does NOT compute or bake any SVG. It emits a small
// shell (via scripts/lib/viz-page.js) that FETCHES squelch-clean.json at load time and
// builds every <rect>/<line>/<text> in the browser from that JSON directly. The page
// must be served from the repo root by scripts/serve-out.js (localhost:8137).
//
// Usage: node scripts/squelch-ribbon.js <squelch-clean.json> <out.html> [label]
"use strict";
const fs = require("fs");
const { buildPage, toUrl } = require("./lib/viz-page");

// ---- browser renderer: builds the ribbon SVG from the fetched squelch-clean.json ----
function drawRibbon(sources, cfg, mount) {
  const sq = sources.squelch;
  if (!sq) { mount.textContent = "no squelch data"; return; }
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const BANDS = [
    { key: "subbass", label: "sub-bass 20–80 Hz", line: "#ebd73c" },
    { key: "low", label: "low 80–250 Hz", line: "#5fd35f" },
    { key: "mid", label: "mid 250–1000 Hz", line: "#b98cff" },
    { key: "high", label: "high 1000–4000 Hz", line: "#ff7bac" }
  ].filter((b) => sq[b.key] && sq[b.key].length);
  const CHAOS_DB = 8; // chaos in [0,1] -> ribbon half-width in dB (matches the timeline's CHAOS_DISPLAY_DB)
  const W = 1240, mL = 58, mR = 20, plotW = W - mL - mR, top0 = 40, hP = 176, gap = 46;
  const H = top0 + BANDS.length * (hP + gap);
  // blue (tonal) -> yellow (chaotic); t = chaos = 1 - tonality
  function hue(tonality) {
    const t = Math.max(0, Math.min(1, 1 - (tonality == null ? 0.5 : tonality)));
    const a = [58, 111, 216], b = [235, 215, 60];
    return "rgb(" + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",") + ")";
  }
  const parts = [
    '<rect width="' + W + '" height="' + H + '" fill="#1a1a1a"/>',
    '<text x="' + mL + '" y="24" fill="#f5f5f5" font-size="16" font-weight="600">' +
      esc(cfg.label) + " — spectral-chaos ribbon</text>"
  ];
  BANDS.forEach((band, bi) => {
    const pts = sq[band.key];
    const top = top0 + bi * (hP + gap);
    let dmin = Infinity, dmax = -Infinity;
    pts.forEach((p) => { const hw = (p.chaos || 0) * CHAOS_DB; dmin = Math.min(dmin, p.level_db - hw); dmax = Math.max(dmax, p.level_db + hw); });
    dmin -= 2; dmax += 2;
    const maxT = pts[pts.length - 1].t || 1;
    const x = (t) => mL + (t / maxT) * plotW;
    const y = (db) => top + hP * (1 - (db - dmin) / (dmax - dmin));
    const bw = Math.max(1, plotW / pts.length);
    for (let db = Math.ceil(dmin / 5) * 5; db <= dmax; db += 5) {
      parts.push('<line x1="' + mL + '" y1="' + y(db).toFixed(1) + '" x2="' + (mL + plotW) + '" y2="' + y(db).toFixed(1) + '" stroke="#333" stroke-width="0.6"/>');
      parts.push('<text x="' + (mL - 8) + '" y="' + (y(db) + 4).toFixed(1) + '" fill="#888" font-size="11" text-anchor="end">' + db + "</text>");
    }
    let line = "";
    pts.forEach((p) => {
      const hw = (p.chaos || 0) * CHAOS_DB, yTop = y(p.level_db + hw), yBot = y(p.level_db - hw);
      parts.push('<rect x="' + (x(p.t) - bw / 2).toFixed(2) + '" y="' + yTop.toFixed(1) +
        '" width="' + bw.toFixed(2) + '" height="' + Math.max(0.4, yBot - yTop).toFixed(1) +
        '" fill="' + hue(p.tonality) + '" opacity="0.5"/>');
      line += x(p.t).toFixed(1) + "," + y(p.level_db).toFixed(1) + " ";
    });
    parts.push('<polyline fill="none" stroke="' + band.line + '" stroke-width="1.3" points="' + line.trim() + '"/>');
    parts.push('<rect x="' + mL + '" y="' + top + '" width="' + plotW + '" height="' + hP + '" fill="none" stroke="#888" stroke-width="1"/>');
    parts.push('<text x="' + mL + '" y="' + (top - 8) + '" fill="#dcdcdc" font-size="12">' +
      esc(band.label) + " · level (dB), ribbon width = chaos, hue tonal→chaos</text>");
  });
  mount.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H +
    '" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif" style="max-width:100%;height:auto">' +
    parts.join("") + "</svg>";
}

const LEGEND = '<div class="panel">' +
  '<div><b>Ribbon width = chaos</b> (spectral flatness, 1&nbsp;&minus;&nbsp;tonality): a steady tone or clean ' +
  'engine drone reads thin; broadband road/gravel/impacts read wide.</div>' +
  '<div style="margin-top:.4rem"><span class="sw" style="background:#3a6fd8"></span>blue = <b>tonal / rhythmic</b> ' +
  '(habituated) &nbsp; <span class="sw" style="background:#ebd73c"></span>yellow = <b>chaotic / noise-like</b> ' +
  '(novel, strobe-like). Thickness carries chaos too, so the panel stays legible without colour.</div>' +
  '<div style="margin-top:.4rem">Rendered live from <code>squelch-clean.json</code> ' +
  '(scripts/squelch-extract.js). Serve the repo root with <code>node scripts/serve-out.js</code>.</div></div>';

// ---- generator: emit the shell; no data or SVG is baked in ----
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
  clientFn: drawRibbon,
  bodyBottom: LEGEND
});
fs.writeFileSync(outPath, html);
console.log("wrote", outPath, "→ fetches", url, "(no data baked into the HTML)");
