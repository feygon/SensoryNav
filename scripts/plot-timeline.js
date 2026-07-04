// scripts/plot-timeline.js
// Render a scored pass as a self-contained dark-mode dual-axis line chart:
//   speed (m/s) and roughness_raw (0-100) over time, with auto-detected annotated
//   sections. Interactions:
//     - full view:  click to zoom to a 30 s window.
//     - zoomed view: grab-drag to pan, single-click to seek audio, double-click to reset.
//   When served from localhost with an audio URL, the chart becomes an audio player:
//   a playhead sweeps the graph, and while playing + zoomed the view auto-follows,
//   keeping the current moment centered. Audio is localhost-only (raw research capture).
// Usage: node scripts/plot-timeline.js <scored-N.json> <out.html> [passLabel] [audioUrl]
"use strict";
const fs = require("fs");

const inPath = process.argv[2] || "out/score/scored-1.json";
const outPath = process.argv[3] || "out/score/timeline.html";
const label = process.argv[4] || "Johnson Creek pass";
const audioUrl = process.argv[5] || null; // e.g. "/data/johnson-creek-pass-1-134511.wav"
const hiresPath = process.argv[6] || null; // e.g. "out/score/highres-1.json" ({ t0, dt, r, lo, mi, hi, speech })
const flags = process.argv.slice(7);       // any of: bands, envelope
const bandsOn = flags.includes("bands");   // start with the 3-band (dB) panel on
const envelopeOn = flags.includes("envelope"); // bold smoothed roughness + faint raw

let hires = null;
if (hiresPath) {
  try { hires = JSON.parse(fs.readFileSync(hiresPath, "utf8")); }
  catch (e) { console.error("hires load failed:", e.message); }
}

const scored = JSON.parse(fs.readFileSync(inPath, "utf8"));
const t0 = scored[0].started_at_ms;
const pts = scored.map((r) => ({
  t: (r.started_at_ms - t0) / 1000, // seconds from pass start (== WAV seek time)
  speed: r.speed_mps,
  rough: r.roughness_raw,
  rdb: r.roughness_db // weighted dB-above-floor; may be undefined for older scored files
}));
const maxT = pts[pts.length - 1].t;

// ---- annotation detection (server-side data analysis) ----
function runs(pred, minLen) {
  const out = [];
  let s = -1;
  for (let i = 0; i <= pts.length; i++) {
    const ok = i < pts.length && pred(pts[i]);
    if (ok && s < 0) s = i;
    else if (!ok && s >= 0) {
      if (i - s >= minLen) out.push({ a: s, b: i - 1 });
      s = -1;
    }
  }
  return out;
}
function longest(rs, n) {
  return rs.slice().sort((p, q) => (q.b - q.a) - (p.b - p.a)).slice(0, n);
}
const anns = [
  ...longest(runs((p) => p.speed < 1, 4), 3).map((r) => ({ ...r, kind: "stop" })),
  ...longest(runs((p) => p.rough >= 99 && p.speed >= 2, 5), 3).map((r) => ({ ...r, kind: "rough" })),
  ...longest(runs((p) => p.speed > 10 && p.rough < 12, 3), 3).map((r) => ({ ...r, kind: "cruise" }))
].sort((p, q) => p.a - q.a);

const satPct = (100 * pts.filter((p) => p.rough >= 99.99).length / pts.length).toFixed(0);

// ---- client-side renderer + player (runs in the browser; embedded via toString) ----
function chartClient(D) {
  // Stacked panels sharing the time axis: main (speed + roughness) on top, then two
  // separate band-energy panels when bands are on — LOW (road rumble) and MID+HIGH
  // (voices + cargo), kept apart so the clean road channel isn't visually mixed in.
  var W = 1240, mL = 58, mR = 62, mT = 90, mB = 64;
  var plotW = W - mL - mR;
  var mainH = 280, gap = 46;
  var mainTop = mT;
  var lowTop = mainTop + mainH + gap, lowH = 110;   // low (road) panel
  var mhTop = lowTop + lowH + gap, mhH = 130;        // mid + high (voices + cargo) panel
  var SPEED_MAX = 20, ROUGH_MAX = 100, ROUGHDB_MAX = 16;
  var C_SPEED = "#4da3ff", C_ROUGH = "#ffc04d", C_TEXT = "#dcdcdc", C_GRID = "#444", C_AXIS = "#888", C_BG = "#1a1a1a", C_HEAD = "#f5f5f5";
  var C_LO = "#5fd35f", C_MI = "#b98cff", C_HI = "#ff7bac"; // low/mid/high band energy (dB)
  var LOW_DB_MIN = -42, LOW_DB_MAX = -20;  // low panel dB range (road rumble)
  var MH_DB_MIN = -72, MH_DB_MAX = -25;    // mid/high panel dB range
  var BAND = {
    stop:   { fill: "rgba(150,150,150,0.14)", edge: "#9a9a9a", label: "stop" },
    rough:  { fill: "rgba(255,120,90,0.16)",  edge: "#ff785a", label: "rough" },
    cruise: { fill: "rgba(77,163,255,0.14)",  edge: "#4da3ff", label: "cruise ≈0 (new asphalt)" }
  };
  var pts = D.pts, anns = D.anns, maxT = D.maxT;
  var view = [0, maxT];
  var bandsOn = !!D.bandsOn;
  var hasRdb = !!(D.hires && D.hires.rdb) && pts.length > 0 && pts[0].rdb != null;
  var roughMode = hasRdb ? "db" : "linear"; // dB is far easier on the eyes when available
  var envelopeOn = !!D.envelopeOn;
  var smoothW = 5; // temporal-envelope width in seconds (odd; 1 = raw)
  var chart = document.getElementById("chart");
  var rangeEl = document.getElementById("range");
  var playBtn = document.getElementById("play");
  var bandsBtn = document.getElementById("bands");
  var roughBtn = document.getElementById("roughmode");
  var smoothSlider = document.getElementById("smooth");
  var smoothVal = document.getElementById("smoothval");
  var smoothCtl = document.getElementById("smoothctl");

  // Audio is localhost-only (raw research capture must not leave the machine).
  var isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var audio = null;
  if (isLocal && D.audioUrl) {
    audio = new Audio(D.audioUrl);
    audio.preload = "metadata";
    audio.addEventListener("play", updatePlayBtn);
    audio.addEventListener("pause", updatePlayBtn);
    audio.addEventListener("ended", updatePlayBtn);
    if (playBtn) { playBtn.style.display = ""; playBtn.addEventListener("click", togglePlay); }
  } else if (playBtn) {
    playBtn.style.display = "none";
  }

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function audioTime() { return audio ? audio.currentTime : null; }
  function dur() { return audio && audio.duration ? audio.duration : maxT; }
  function isZoomed(v) { v = v || view; return (v[1] - v[0]) < maxT - 0.5; }
  function bandsShown() { return bandsOn && D.hires && D.hires.lo; }
  function mainBottom() { return mainTop + mainH; }
  function chartBottom() { return bandsShown() ? mhTop + mhH : mainBottom(); }
  function svgH() { return chartBottom() + mB; }
  function xf(t) { return mL + (t - view[0]) / (view[1] - view[0]) * plotW; }
  function yS(v) { return mainTop + mainH * (1 - Math.min(v, SPEED_MAX) / SPEED_MAX); }
  function yR(v) { return mainTop + mainH * (1 - Math.min(v, ROUGH_MAX) / ROUGH_MAX); }
  function yRdb(v) { return mainTop + mainH * (1 - Math.min(v, ROUGHDB_MAX) / ROUGHDB_MAX); }
  function yRough(v) { return roughMode === "db" ? yRdb(v) : yR(v); }
  function yDbLow(db) { return lowTop + lowH * (1 - (clamp(db, LOW_DB_MIN, LOW_DB_MAX) - LOW_DB_MIN) / (LOW_DB_MAX - LOW_DB_MIN)); }
  function yDbMH(db) { return mhTop + mhH * (1 - (clamp(db, MH_DB_MIN, MH_DB_MAX) - MH_DB_MIN) / (MH_DB_MAX - MH_DB_MIN)); }
  function step(span) { return span <= 40 ? 5 : span <= 120 ? 15 : span <= 300 ? 30 : 60; }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function line(key, color) {
    var d = "";
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.t < view[0] - 1 || p.t > view[1] + 1) continue;
      var y = key === "speed" ? yS(p.speed) : yRough(roughField(p));
      d += xf(p.t).toFixed(1) + "," + y.toFixed(1) + " ";
    }
    return '<polyline fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linejoin="round" points="' + d.trim() + '"/>';
  }

  function roughField(p) { return roughMode === "db" ? p.rdb : p.rough; }

  // Temporal envelope: centered moving average of the roughness over smoothW seconds
  // (1 s windows), collapsing per-second jitter into a readable trend. An envelope
  // follower is the same tool used in audio dynamics / noise reduction.
  function smoothedSeries() {
    var k = Math.floor(smoothW / 2), out = new Array(pts.length);
    for (var i = 0; i < pts.length; i++) {
      var s = 0, n = 0, lo = Math.max(0, i - k), hi = Math.min(pts.length - 1, i + k);
      for (var j = lo; j <= hi; j++) { s += roughField(pts[j]); n++; }
      out[i] = s / n;
    }
    return out;
  }
  function roughEnvelope() {
    var sm = smoothedSeries(), raw = "", smooth = "", i, p;
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      if (p.t < view[0] - 1 || p.t > view[1] + 1) continue;
      var x = xf(p.t).toFixed(1);
      raw += x + "," + yRough(roughField(p)).toFixed(1) + " ";
      smooth += x + "," + yRough(sm[i]).toFixed(1) + " ";
    }
    return '<polyline fill="none" stroke="rgba(255,192,77,0.28)" stroke-width="0.8" points="' + raw.trim() + '"/>'
      + '<polyline fill="none" stroke="' + C_ROUGH + '" stroke-width="2.4" stroke-linejoin="round" points="' + smooth.trim() + '"/>';
  }
  function roughDraw() { return envelopeOn ? roughEnvelope() : line("rough", C_ROUGH); }

  // Faint ~47 Hz per-frame roughness trace (the sub-second structure SP1 averages away).
  function hiresLine() {
    var hr = D.hires;
    var arr = roughMode === "db" ? (hr && hr.rdb) : (hr && hr.r);
    if (!hr || !arr) return "";
    if (view[1] - view[0] > 120) return ""; // sub-second detail is only legible zoomed in
    var stride = Math.max(1, Math.floor(((view[1] - view[0]) / hr.dt) / 900));
    var d = "";
    for (var i = 0; i < arr.length; i += stride) {
      var t = hr.t0 + i * hr.dt;
      if (t < view[0] - 0.1 || t > view[1] + 0.1) continue;
      d += xf(t).toFixed(1) + "," + yRough(arr[i]).toFixed(1) + " ";
    }
    return d ? '<polyline fill="none" stroke="rgba(255,192,77,0.32)" stroke-width="0.7" points="' + d.trim() + '"/>' : "";
  }

  // Per-band energy in dB. Strided so it stays legible at any zoom (full-view envelope,
  // full detail when zoomed). low = road rumble, mid+high = where speech lives.
  function bandLine(arr, color, yfn) {
    var hr = D.hires;
    if (!bandsOn || !hr || !arr) return "";
    var stride = Math.max(1, Math.floor(((view[1] - view[0]) / hr.dt) / 650));
    var d = "";
    for (var i = 0; i < arr.length; i += stride) {
      var t = hr.t0 + i * hr.dt;
      if (t < view[0] - 0.1 || t > view[1] + 0.1) continue;
      d += xf(t).toFixed(1) + "," + yfn(arr[i]).toFixed(1) + " ";
    }
    return d ? '<polyline fill="none" stroke="' + color + '" stroke-width="1" opacity="0.85" points="' + d.trim() + '"/>' : "";
  }
  function bandLines() {
    var hr = D.hires;
    if (!bandsShown()) return "";
    return bandLine(hr.lo, C_LO, yDbLow) + bandLine(hr.mi, C_MI, yDbMH) + bandLine(hr.hi, C_HI, yDbMH);
  }

  // Talking-contamination ribbon: a strip along the top marking windows where mid+high co-spike.
  function speechRibbon() {
    var hr = D.hires;
    if (!hr || !hr.speech) return "";
    var out = "";
    for (var i = 0; i < hr.speech.length; i++) {
      var a = hr.speech[i][0], b = hr.speech[i][1];
      if (b < view[0] || a > view[1]) continue;
      var x1 = Math.max(xf(a), mL), x2 = Math.min(xf(b), mL + plotW);
      out += '<rect x="' + x1.toFixed(1) + '" y="' + (mainTop + 1) + '" width="' + Math.max(1, x2 - x1).toFixed(1) + '" height="7" fill="#ff7bac" opacity="0.75"/>';
    }
    return out;
  }

  function render() {
    var span = view[1] - view[0];
    var showBands = bandsShown(), bottom = mainBottom(), cbottom = chartBottom(), H = svgH();
    // x gridlines (both panels) + labels along the chart bottom
    var xg = "", st = step(span), gt0 = Math.ceil(view[0] / st) * st, t;
    for (t = gt0; t <= view[1] + 0.001; t += st) {
      var px = xf(t);
      xg += '<line x1="' + px.toFixed(1) + '" y1="' + mainTop + '" x2="' + px.toFixed(1) + '" y2="' + bottom + '" stroke="' + C_GRID + '" stroke-width="1"/>';
      if (showBands) {
        xg += '<line x1="' + px.toFixed(1) + '" y1="' + lowTop + '" x2="' + px.toFixed(1) + '" y2="' + (lowTop + lowH) + '" stroke="' + C_GRID + '" stroke-width="1"/>';
        xg += '<line x1="' + px.toFixed(1) + '" y1="' + mhTop + '" x2="' + px.toFixed(1) + '" y2="' + (mhTop + mhH) + '" stroke="' + C_GRID + '" stroke-width="1"/>';
      }
      xg += '<text x="' + px.toFixed(1) + '" y="' + (cbottom + 22) + '" fill="' + C_AXIS + '" font-size="12" text-anchor="middle">' + t + 's</text>';
    }
    // speed (left) gridlines/ticks — main panel
    var lg = "", v;
    for (v = 0; v <= SPEED_MAX; v += 5) {
      var py = yS(v);
      lg += '<line x1="' + mL + '" y1="' + py.toFixed(1) + '" x2="' + (mL + plotW) + '" y2="' + py.toFixed(1) + '" stroke="' + C_GRID + '" stroke-width="' + (v === 0 ? 1.4 : 0.6) + '"/>';
      lg += '<text x="' + (mL - 8) + '" y="' + (py + 4).toFixed(1) + '" fill="' + C_SPEED + '" font-size="12" text-anchor="end">' + v + '</text>';
    }
    // roughness (right) ticks — main panel
    var rg = "", vr, rmax = roughMode === "db" ? ROUGHDB_MAX : ROUGH_MAX, rstep = roughMode === "db" ? 4 : 25;
    for (vr = 0; vr <= rmax; vr += rstep) {
      var pyr = yRough(vr);
      rg += '<text x="' + (mL + plotW + 10) + '" y="' + (pyr + 4).toFixed(1) + '" fill="' + C_ROUGH + '" font-size="12" text-anchor="start">' + vr + '</text>';
    }
    // two separate band panels when shown: LOW (road) and MID+HIGH (voices + cargo)
    var bandPanel = "";
    if (showBands) {
      function panelScaffold(top, h, ticks, yfn, labelHtml) {
        var out = "";
        for (var di = 0; di < ticks.length; di++) {
          var yd = yfn(ticks[di]);
          out += '<line x1="' + mL + '" y1="' + yd.toFixed(1) + '" x2="' + (mL + plotW) + '" y2="' + yd.toFixed(1) + '" stroke="' + C_GRID + '" stroke-width="0.5"/>';
          out += '<text x="' + (mL - 8) + '" y="' + (yd + 4).toFixed(1) + '" fill="' + C_AXIS + '" font-size="11" text-anchor="end">' + ticks[di] + '</text>';
        }
        out += '<rect x="' + mL + '" y="' + top + '" width="' + plotW + '" height="' + h + '" fill="none" stroke="' + C_AXIS + '" stroke-width="1"/>';
        out += '<text x="' + mL + '" y="' + (top - 8) + '" fill="' + C_TEXT + '" font-size="12">' + labelHtml + '</text>';
        return out;
      }
      bandPanel += panelScaffold(lowTop, lowH, [-40, -30, -20], yDbLow,
        '<tspan fill="' + C_LO + '" font-weight="600">low</tspan> 80-250 Hz &mdash; road rumble (dB)');
      bandPanel += panelScaffold(mhTop, mhH, [-65, -50, -35], yDbMH,
        '<tspan fill="' + C_MI + '" font-weight="600">mid</tspan> 250-1k &nbsp;<tspan fill="' + C_HI + '" font-weight="600">high</tspan> 1-4k Hz &mdash; voices + cargo (dB)');
    }
    // annotation bands (main panel) + staggered labels
    var bandsSvg = "", labels = "", row = 0;
    for (var k = 0; k < anns.length; k++) {
      var rr = anns[k], ta = pts[rr.a].t, tb = pts[rr.b].t + 1;
      if (tb < view[0] || ta > view[1]) continue;
      var cfg = BAND[rr.kind];
      var x1 = Math.max(xf(ta), mL), x2 = Math.min(xf(tb), mL + plotW);
      bandsSvg += '<rect x="' + x1.toFixed(1) + '" y="' + mainTop + '" width="' + Math.max(2, x2 - x1).toFixed(1) + '" height="' + mainH + '" fill="' + cfg.fill + '" stroke="' + cfg.edge + '" stroke-width="0.6" stroke-dasharray="3 3"/>';
      var cx = ((x1 + x2) / 2).toFixed(1), ly = 42 + (row % 3) * 15;
      row++;
      labels += '<line x1="' + cx + '" y1="' + (ly + 3) + '" x2="' + cx + '" y2="' + mainTop + '" stroke="' + cfg.edge + '" stroke-width="0.6" stroke-dasharray="2 2"/>';
      labels += '<text x="' + cx + '" y="' + ly + '" fill="' + cfg.edge + '" font-size="11.5" text-anchor="middle">' + cfg.label + ' · ' + pts[rr.a].t.toFixed(0) + '–' + pts[rr.b].t.toFixed(0) + 's</text>';
    }
    var ptime = audioTime();
    var phx = (ptime != null && ptime >= view[0] && ptime <= view[1]) ? xf(ptime) : -10;
    var playhead = '<line id="playhead" x1="' + phx.toFixed(1) + '" y1="' + mainTop + '" x2="' + phx.toFixed(1) + '" y2="' + cbottom + '" stroke="' + C_HEAD + '" stroke-width="1.5" pointer-events="none"/>';
    var cursor = isZoomed() ? "grab" : "crosshair";
    var svg = '<svg id="svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif" style="max-width:100%;height:auto;cursor:' + cursor + '">'
      + '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + C_BG + '"/>'
      + '<text x="' + mL + '" y="26" fill="' + C_TEXT + '" font-size="17" font-weight="600">' + esc(D.label) + ' — speed &amp; roughness over time</text>'
      + bandsSvg + xg + lg + rg + bandPanel
      + '<rect x="' + mL + '" y="' + mainTop + '" width="' + plotW + '" height="' + mainH + '" fill="none" stroke="' + C_AXIS + '" stroke-width="1"/>'
      + hiresLine() + line("speed", C_SPEED) + roughDraw() + bandLines() + labels + speechRibbon() + playhead
      + '<text x="' + (mL - 40) + '" y="' + (mainTop + mainH / 2) + '" fill="' + C_SPEED + '" font-size="13" text-anchor="middle" transform="rotate(-90 ' + (mL - 40) + ' ' + (mainTop + mainH / 2) + ')">speed (m/s)</text>'
      + '<text x="' + (mL + plotW + 44) + '" y="' + (mainTop + mainH / 2) + '" fill="' + C_ROUGH + '" font-size="13" text-anchor="middle" transform="rotate(90 ' + (mL + plotW + 44) + ' ' + (mainTop + mainH / 2) + ')">' + (roughMode === "db" ? "roughness (dB above floor)" : "roughness_raw (0–100)") + '</text>'
      + '<text x="' + (mL + plotW / 2) + '" y="' + (H - 8) + '" fill="' + C_AXIS + '" font-size="13" text-anchor="middle">time (s)</text>'
      + '</svg>';
    chart.innerHTML = svg;
    if (rangeEl) rangeEl.textContent = "showing " + view[0].toFixed(0) + "–" + view[1].toFixed(0) + "s (" + span.toFixed(0) + "s window)";
  }

  function updatePlayhead(t) {
    var ph = document.getElementById("playhead");
    if (!ph) return;
    var phx = (t >= view[0] && t <= view[1]) ? xf(t) : -10;
    ph.setAttribute("x1", phx.toFixed(1));
    ph.setAttribute("x2", phx.toFixed(1));
  }

  function centerOn(t) {
    var span = view[1] - view[0], a = t - span / 2, b = t + span / 2;
    if (a < 0) { a = 0; b = span; }
    if (b > maxT) { b = maxT; a = maxT - span; }
    view = [a, b];
  }

  var rafOn = false;
  function tick() {
    if (!audio || audio.paused) { rafOn = false; return; }
    var ct = audio.currentTime;
    if (isZoomed()) { centerOn(ct); render(); } // follow: keep the moment centered
    else { updatePlayhead(ct); }
    requestAnimationFrame(tick);
  }
  function togglePlay() {
    if (!audio) return;
    if (audio.paused) { audio.play(); if (!rafOn) { rafOn = true; requestAnimationFrame(tick); } }
    else { audio.pause(); }
  }
  function updatePlayBtn() {
    if (!playBtn || !audio) return;
    playBtn.textContent = audio.paused ? "▶ Play" : "❙❙ Pause";
  }
  function seek(t) {
    if (!audio) return;
    audio.currentTime = clamp(t, 0, dur());
    if (audio.paused) { if (isZoomed()) { centerOn(t); render(); } else { updatePlayhead(t); } }
  }
  function zoomTo(t) {
    var a = t - 15, b = t + 15;
    if (a < 0) { a = 0; b = Math.min(maxT, 30); }
    if (b > maxT) { b = maxT; a = Math.max(0, maxT - 30); }
    view = [a, b]; render();
  }
  function reset() { view = [0, maxT]; render(); }

  // ---- pointer interaction ----
  function svgEl() { return chart.querySelector("svg"); }
  function svgX(clientX) {
    var s = svgEl(); if (!s) return null;
    var r = s.getBoundingClientRect();
    return (clientX - r.left) * (W / r.width);
  }
  function timeAt(clientX) {
    var sx = svgX(clientX);
    if (sx == null || sx < mL || sx > mL + plotW) return null;
    return view[0] + (sx - mL) / plotW * (view[1] - view[0]);
  }

  var drag = null, pendingClick = null;
  chart.addEventListener("mousedown", function (e) {
    drag = { x: e.clientX, view: view.slice(), moved: false };
  });
  window.addEventListener("mousemove", function (e) {
    if (!drag) return;
    var sxNow = svgX(e.clientX), sxDown = svgX(drag.x);
    if (sxNow == null) return;
    if (Math.abs(sxNow - sxDown) > 3) drag.moved = true;
    if (drag.moved && isZoomed(drag.view)) {
      var span = drag.view[1] - drag.view[0];
      var dt = (sxNow - sxDown) / plotW * span;
      var a = drag.view[0] - dt, b = drag.view[1] - dt;
      if (a < 0) { a = 0; b = span; }
      if (b > maxT) { b = maxT; a = maxT - span; }
      view = [a, b]; render();
      var se = svgEl(); if (se) se.style.cursor = "grabbing";
    }
  });
  window.addEventListener("mouseup", function (e) {
    if (!drag) return;
    var d = drag; drag = null;
    if (d.moved) { var se = svgEl(); if (se) se.style.cursor = isZoomed() ? "grab" : "crosshair"; return; }
    var t = timeAt(e.clientX);
    if (t == null) return;
    if (isZoomed(d.view)) {
      // zoomed single-click = seek, but hold briefly so a double-click resets instead
      pendingClick = setTimeout(function () { seek(t); pendingClick = null; }, 250);
    } else {
      zoomTo(t);
    }
  });
  chart.addEventListener("dblclick", function () {
    if (pendingClick) { clearTimeout(pendingClick); pendingClick = null; }
    reset();
  });

  function updateBandsBtn() { if (bandsBtn) bandsBtn.textContent = bandsOn ? "Bands: on" : "Bands: off"; }
  if (bandsBtn) {
    if (D.hires && D.hires.lo) {
      bandsBtn.style.display = "";
      bandsBtn.addEventListener("click", function () { bandsOn = !bandsOn; updateBandsBtn(); render(); });
    } else {
      bandsBtn.style.display = "none";
    }
  }

  function updateRoughBtn() { if (roughBtn) roughBtn.textContent = roughMode === "db" ? "Rough: dB" : "Rough: linear"; }
  if (roughBtn) {
    if (hasRdb) {
      roughBtn.style.display = "";
      roughBtn.addEventListener("click", function () { roughMode = roughMode === "db" ? "linear" : "db"; updateRoughBtn(); render(); });
    } else {
      roughBtn.style.display = "none";
    }
  }

  if (smoothCtl) {
    if (envelopeOn) {
      smoothCtl.style.display = "";
      if (smoothSlider) {
        smoothSlider.value = String(smoothW);
        smoothSlider.addEventListener("input", function () {
          smoothW = parseInt(smoothSlider.value, 10) || 1;
          if (smoothVal) smoothVal.textContent = (smoothW === 1 ? "raw" : smoothW + "s");
          render();
        });
      }
      if (smoothVal) smoothVal.textContent = smoothW + "s";
    } else {
      smoothCtl.style.display = "none";
    }
  }

  updateBandsBtn();
  updateRoughBtn();
  updatePlayBtn();
  render();
}

const data = { pts, anns, maxT, label, audioUrl, hires, bandsOn, envelopeOn };
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${label} timeline</title>
<style>
  :root{color-scheme:dark;}
  body{background:#1a1a1a;color:#dcdcdc;font-family:system-ui,sans-serif;margin:1.2rem;}
  .toolbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:.6rem;}
  .toolbar button{background:#333;color:#dcdcdc;border:1px solid #666;border-radius:5px;padding:6px 12px;font:inherit;cursor:pointer;}
  .toolbar button:hover{background:#444;}
  #play{min-width:92px;}
  #range{color:#9fb7d4;font-variant-numeric:tabular-nums;}
  .hint{color:#888;font-size:.9rem;}
  #chart{max-width:1240px;}
  .panel{background:#555;padding:.8rem 1rem;border-radius:6px;max-width:1240px;margin-top:1rem;line-height:1.5;}
  .sw{display:inline-block;width:22px;height:3px;vertical-align:middle;margin-right:6px;}
  code{background:#666;padding:0 4px;border-radius:3px;}
</style></head><body>
<div class="toolbar">
  <button id="play" type="button" style="display:none">&#9654; Play</button>
  <button id="reset" type="button">Reset zoom (full pass)</button>
  <button id="roughmode" type="button" style="display:none">Rough: dB</button>
  <button id="bands" type="button" style="display:none">Bands: on</button>
  <span id="smoothctl" style="display:none;color:#dcdcdc;">smooth <input id="smooth" type="range" min="1" max="11" step="2" value="5" style="vertical-align:middle;width:120px"> <span id="smoothval" style="color:#9fb7d4;font-variant-numeric:tabular-nums">5s</span></span>
  <span id="range"></span>
</div>
<div class="toolbar">
  <span class="hint">full view: click to zoom to 30&nbsp;s &middot; zoomed: drag to pan, click to seek audio, double-click to reset &middot; Play sweeps a playhead (localhost only) and the zoomed view follows it.</span>
</div>
<div id="chart"></div>
<div class="panel">
  <div><span class="sw" style="background:#4da3ff"></span><b>speed</b> (left axis, m/s) &nbsp;&middot;&nbsp;
       <span class="sw" style="background:#ffc04d"></span><b>roughness</b> (right axis) &mdash; defaults to <b>dB above the speed-conditioned floor</b> (log, doesn't saturate); the <b>Rough</b> button switches to the raw linear 0&ndash;100 score. Bands reweighted <b>low&nbsp;0.6 / mid&nbsp;0.3 / high&nbsp;0.1</b> (high de-emphasized: cargo rattle, not road).</div>
  <div style="margin-top:.4rem"><span class="sw" style="background:rgba(255,192,77,0.4)"></span><b>faint amber</b> = per-frame roughness at <b>~47&nbsp;Hz</b> (the sub-second structure SP1 averages into each 1&nbsp;s point) &mdash; a narrow spike is a &lt;0.1&nbsp;s transient, a plateau is a sustained sound. Follows the current roughness scale (dB or linear).</div>
  <div style="margin-top:.4rem"><b>Envelope</b>: the bold roughness line is a centered moving average (temporal envelope) over the <b>smooth</b> width; the faint line under it is the raw 1&nbsp;s value. Widen the slider to collapse per-second jitter into a trend.</div>
  <div style="margin-top:.4rem"><b>Band panels</b> (dB, log/perceptual) &mdash; the road channel is kept in its own panel:
       <span class="sw" style="background:#5fd35f"></span><b>low</b> 80&ndash;250&nbsp;Hz = <b>road rumble</b> (clean of voices); below it,
       <span class="sw" style="background:#b98cff"></span>mid and <span class="sw" style="background:#ff7bac"></span>high = <b>voices + cargo rattle</b>. Toggle with <b>Bands</b>.</div>
  <div style="margin-top:.4rem"><span class="sw" style="background:#ff7bac;height:8px"></span><b>pink ribbon (top)</b> = <b>likely talking</b>: windows where mid&nbsp;+&nbsp;high co-spike (the speech signature). Roughness there is contaminated by voices, not road.</div>
  <div style="margin-top:.5rem">Shaded bands are auto-detected: <span style="color:#9a9a9a">stops</span>,
      <span style="color:#ff785a">rough / saturated stretches</span>, and
      <span style="color:#4da3ff">smooth-cruise sections</span>.</div>
  <div style="margin-top:.5rem"><b>${satPct}%</b> of windows sit pinned at roughness 100 &mdash; the flat-top plateaus are the
      <code>SCORE_SCALE</code> saturation to calibrate against felt annotations.</div>
</div>
<script>(${chartClient.toString()})(${JSON.stringify(data)});</script>
</body></html>`;

fs.writeFileSync(outPath, html);
console.log("wrote", outPath, audioUrl ? "(audio: " + audioUrl + ")" : "(no audio)");
console.log("annotations:", JSON.stringify(anns.map((r) => ({ kind: r.kind, from: pts[r.a].t, to: pts[r.b].t }))));
