// scripts/plot-timeline.js
// Render a scored pass as a self-contained dark-mode dual-axis line chart:
//   speed (m/s) and roughness_raw (0-100) over time, with auto-detected annotated
//   sections. Interactions:
//     - full view:  click to zoom to a 30 s window.
//     - zoomed view: grab-drag to pan, single-click to seek audio, double-click to reset.
//   When served from localhost with an audio URL, the chart becomes an audio player:
//   a playhead sweeps the graph, and while playing + zoomed the view auto-follows,
//   keeping the current moment centered. Audio is localhost-only (raw research capture).
// The renderer itself lives in the shared timeline-render.js (so this page and analyze.html
// are byte-identical); this generator only emits the shell that fetches the pipeline JSON and
// calls SensoryNavTimeline.drawTimeline. No data or SVG is baked in.
// Usage: node scripts/plot-timeline.js <scored-N.json> <out.html> [passLabel] [audioUrl]
"use strict";
const fs = require("fs");
const path = require("path");

const inPath = process.argv[2] || "out/score/scored-1.json";
const outPath = process.argv[3] || "out/score/timeline.html";
const label = process.argv[4] || "Johnson Creek pass";
const audioUrl = process.argv[5] || null; // e.g. "/data/johnson-creek-pass-1-134511.wav"
const hiresPath = process.argv[6] || null; // e.g. "out/score/highres-1.json" ({ t0, dt, r, rdb, lo, mi, hi, floLo, floMi, floHi, speech })
const flags = process.argv.slice(7);       // any of: bands, envelope
const bandsOn = flags.includes("bands");   // start with the 3-band (dB) panel on
const envelopeOn = flags.includes("envelope"); // bold smoothed roughness + faint raw

// ARCHITECTURE: this page is DATA-DRIVEN. The generator does NOT read the scored /
// highres / squelch / tags JSON and bake it (or pre-rendered SVG) into the HTML. It
// emits a small shell that FETCHES those JSON files at load time and builds every SVG
// element in the browser via the shared timeline-render.js (SensoryNavTimeline.drawTimeline).
// The same JSON the pipeline writes is the single source of truth. Pages are served from the
// repo root by scripts/serve-out.js (localhost:8137), so these same-origin fetches resolve.
//   squelch=out/score-XX/squelch-clean.json  — folded sub-bass panel + band levels
//   tags=out/score-XX/tags-clean.json         — tag-event marks
const squelchFlag = flags.find((f) => f.startsWith("squelch="));
const tagsFlag = flags.find((f) => f.startsWith("tags="));
const toUrl = (p) => (p ? "/" + String(p).replace(/\\/g, "/").replace(/^\/+/, "") : null);
const urls = {
  scored: toUrl(inPath),
  hires: toUrl(hiresPath),
  squelch: squelchFlag ? toUrl(squelchFlag.slice(8)) : null,
  tags: tagsFlag ? toUrl(tagsFlag.slice(5)) : null
};

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${label} timeline</title>
<link rel="stylesheet" href="timeline.css">
<script src="timeline-render.js"><\/script>
</head><body>
<div class="toolbar">
  <button id="play" type="button" style="display:none">&#9654; Play</button>
  <button id="reset" type="button">Reset zoom (full pass)</button>
  <button id="roughmode" type="button" style="display:none">Rough: dB</button>
  <button id="bands" type="button" style="display:none">Bands: on</button>
  <span id="smoothctl" style="display:none;color:#dcdcdc;">smooth <input id="smooth" type="range" min="1" max="11" step="2" value="5" style="vertical-align:middle;width:120px"> <span id="smoothval" style="color:#9fb7d4;font-variant-numeric:tabular-nums">5s</span></span>
  <span id="range"></span>
</div>
<div class="toolbar">
  <span class="hint">hover any panel to read exact values (level, baseline, &Delta;) in a tooltip below it; hover the small dots along a panel's bottom edge for tag detail at that moment &middot; full view: click to zoom to 30&nbsp;s &middot; zoomed: drag to pan, click to seek audio, double-click to reset &middot; Play sweeps a playhead (localhost only) and the zoomed view follows it.</span>
</div>
<div id="chartwrap"><div id="chart"></div><div id="tt"></div></div>
<div class="legendwrap">
  <div class="panel gloss" aria-label="Legend">
    <h3>Legend</h3>
    <div class="glz" tabindex="0" data-tip="Roughness defaults to dB above the speed-conditioned floor (log, doesn't saturate); the Rough button switches to a raw linear 0–100 score. Bands are reweighted low 0.6 / mid 0.3 / high 0.1 — high is de-emphasized because it is cargo rattle, not road."><span class="sw" style="background:#4da3ff"></span><b>speed</b> (m/s) &nbsp;&middot;&nbsp; <span class="sw" style="background:#ffc04d"></span><b>roughness</b> &mdash; dB above the smooth-road floor<span class="more">&#9432;</span></div>
    <div class="glz" tabindex="0" data-tip="The road channel is kept separate: low 80–250 Hz = road rumble (clean of voices); mid + high = voices + cargo rattle; sub-bass 20–80 Hz is folded (see the Glossary). Toggle with Bands."><span class="sw" style="background:#ebd73c"></span><span class="sw" style="background:#5fd35f"></span><span class="sw" style="background:#b98cff"></span><span class="sw" style="background:#ff7bac"></span><b>band panels</b> &mdash; sub-bass &middot; low &middot; mid &middot; high (dB)<span class="more">&#9432;</span></div>
    <div class="glz" tabindex="0" data-tip="Baseline = this car's noise floor on smooth pavement at that instant's speed (this run's own speed-conditioned 10th-percentile floor); it rises with speed. The shaded green gap is how far the rumble sits above it — that gap, weighted low 0.6 / mid 0.3 / high 0.1, IS the roughness number."><span class="sw" style="background:#7cc47c;height:0;border-top:2px dashed #7cc47c"></span><b>baseline (dashed)</b> + green gap &mdash; delta-dB above the floor<span class="more">&#9432;</span></div>
    <div class="glz" tabindex="0" data-tip="The sub-second structure SP1 averages into each 1 s point. A narrow spike is a <0.1 s transient; a plateau is a sustained sound. Follows the current roughness scale (dB or linear)."><span class="sw" style="background:rgba(255,192,77,0.4)"></span><b>faint amber</b> &mdash; per-frame ~47 Hz roughness<span class="more">&#9432;</span></div>
    <div class="glz" tabindex="0" data-tip="One per detected sub-bass event, along the bottom edge of the main and sub-bass panels. Hover a dot for that event's tags (name value·confidence), with an accelerometer-gap note where onset-sharpness couldn't be corroborated."><span class="sw" style="background:#dcdcdc;opacity:.55"></span><b>tag-event dots</b> &mdash; hover a dot for an event's tags<span class="more">&#9432;</span></div>
    <div class="glz" tabindex="0" data-tip="Windows where mid + high co-spike (the speech signature). Roughness there is contaminated by voices, not road."><span class="sw" style="background:#ff7bac;height:8px"></span><b>pink ribbon</b> &mdash; likely talking<span class="more">&#9432;</span></div>
  </div>
  <div class="panel gloss" aria-label="Glossary">
    <h3>Glossary</h3>
    <div class="glz" tabindex="0" data-tip="The bold line is a centered moving average over the 'smooth' width; the faint line under it is the raw 1 s value. Widen the slider to collapse per-second jitter into a trend."><b>Envelope</b> &mdash; smoothed roughness trend<span class="more">&#9432;</span></div>
    <div class="glz" tabindex="0" data-tip="Same baseline+delta grammar as the other bands, but the line is folded against structure: blue = tonal (engine, habituated) → yellow = chaotic (road, novel). Thickness redundantly encodes chaos so it stays legible without colour. Chaos = spectral flatness (1 − tonality) within 20–80 Hz."><b>folded sub-bass</b> &mdash; hue <span style="color:#3a6fd8">tonal</span>&rarr;<span style="color:#ebd73c">chaos</span>, thickness = chaos<span class="more">&#9432;</span></div>
    <div class="glz" tabindex="0" data-tip="Auto-detected sections: stops (grey), rough / saturated stretches (red), and smooth-cruise sections (blue)."><b>shaded bands</b> &mdash; auto <span style="color:#9a9a9a">stops</span> / <span style="color:#ff785a">rough</span> / <span style="color:#4da3ff">cruise</span><span class="more">&#9432;</span></div>
    <div class="glz" tabindex="0" data-tip="The flat-top plateaus are the SCORE_SCALE saturation, kept as-is to calibrate against felt annotations."><b id="satpct">…</b>% of windows pinned at roughness 100<span class="more">&#9432;</span></div>
  </div>
</div>
<script>
"use strict";
var URLS = ${JSON.stringify(urls)}, CFG = ${JSON.stringify({ label, audioUrl, bandsOn, envelopeOn })};
(function () {
  var chart = document.getElementById("chart");
  chart.innerHTML = '<div style="color:#9fb7d4;padding:1rem">Loading pass data…</div>';
  var names = Object.keys(URLS);
  Promise.all(names.map(function (n) {
    if (!URLS[n]) return Promise.resolve(null);
    return fetch(URLS[n]).then(function (r) { if (!r.ok) throw new Error(URLS[n] + " → HTTP " + r.status); return r.json(); });
  })).then(function (vals) {
    var s = {}; names.forEach(function (n, i) { s[n] = vals[i]; });
    SensoryNavTimeline.drawTimeline(s, CFG);
  }).catch(function (e) {
    chart.innerHTML = '<div style="color:#ff9b7a;padding:1rem;max-width:1100px">Could not load data: ' + e.message +
      '. This page reads the pipeline JSON live — serve the repo root with <code>node scripts/serve-out.js</code> (localhost:8137) and open it from there.</div>';
  });
})();
<\/script>
</body></html>`;

fs.writeFileSync(outPath, html);
// Ship the stylesheet + shared renderer next to the page (relative links, so they resolve on the
// local server and under a GitHub Pages project base alike).
fs.copyFileSync(path.join(__dirname, "lib", "timeline.css"), path.join(path.dirname(outPath) || ".", "timeline.css"));
fs.copyFileSync(path.join(__dirname, "..", "timeline-render.js"), path.join(path.dirname(outPath) || ".", "timeline-render.js"));
console.log("wrote", outPath, "+ timeline.css + timeline-render.js → fetches", Object.values(urls).filter(Boolean).join(", "),
  "(no data or styling baked into the HTML)", audioUrl ? "| audio " + audioUrl : "");
