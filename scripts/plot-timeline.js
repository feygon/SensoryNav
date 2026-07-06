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
const hiresPath = process.argv[6] || null; // e.g. "out/score/highres-1.json" ({ t0, dt, r, rdb, lo, mi, hi, floLo, floMi, floHi, speech })
const flags = process.argv.slice(7);       // any of: bands, envelope
const bandsOn = flags.includes("bands");   // start with the 3-band (dB) panel on
const envelopeOn = flags.includes("envelope"); // bold smoothed roughness + faint raw

let hires = null;
if (hiresPath) {
  try { hires = JSON.parse(fs.readFileSync(hiresPath, "utf8")); }
  catch (e) { console.error("hires load failed:", e.message); }
}

// Optional aperiodic-chaos ribbon series (from squelch-extract). Passed as a flag:
//   squelch=out/score-XX/squelch-clean.json
let squelch = null;
const squelchFlag = flags.find((f) => f.startsWith("squelch="));
if (squelchFlag) {
  try {
    squelch = JSON.parse(fs.readFileSync(squelchFlag.slice(8), "utf8"));
    const bs = (s, pad) => { let lo = Infinity, hi = -Infinity; for (const p of s) { lo = Math.min(lo, p.c - p.chaos); hi = Math.max(hi, p.c + p.chaos); } return [Math.floor(lo) - pad, Math.ceil(hi) + pad]; };
    const mi = bs(squelch.mid, 2), hg = bs(squelch.high, 2);
    squelch.scale = { low: bs(squelch.low, 2), mh: [Math.min(mi[0], hg[0]), Math.max(mi[1], hg[1])] };
  } catch (e) { console.error("squelch load failed:", e.message); }
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
  var mainH = 280, gap = 78; // inter-panel gap; also hosts the hover tooltip below each panel
  var mainTop = mT;
  var lowTop = mainTop + mainH + gap, lowH = 110;   // low (road) panel
  var mhTop = lowTop + lowH + gap, mhH = 130;        // mid + high (voices + cargo) panel
  var SPEED_MAX = 20, ROUGH_MAX = 100, ROUGHDB_MAX = 16;
  var C_SPEED = "#4da3ff", C_ROUGH = "#ffc04d", C_TEXT = "#dcdcdc", C_GRID = "#444", C_AXIS = "#888", C_BG = "#1a1a1a", C_HEAD = "#f5f5f5";
  var C_LO = "#5fd35f", C_MI = "#b98cff", C_HI = "#ff7bac"; // low/mid/high band energy (dB)
  var C_LOF = "#7cc47c", C_MIF = "#8f7ab8", C_HIF = "#b87a92"; // baseline (floor) dashed lines — dimmer band hues
  var LOW_DB = [-42, -20];  // low panel dB range (road rumble), level view
  var MH_DB = [-72, -25];   // mid/high panel dB range, level view
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
  var squelch = D.squelch || null;
  var ribbonOn = !!squelch; // default the band panels to the aperiodic-chaos ribbon view
  var chart = document.getElementById("chart");
  var rangeEl = document.getElementById("range");
  var playBtn = document.getElementById("play");
  var bandsBtn = document.getElementById("bands");
  var ribbonBtn = document.getElementById("ribbon");
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
  function bandsShown() { return bandsOn && ((D.hires && D.hires.lo) || squelch); }
  function mainBottom() { return mainTop + mainH; }
  function chartBottom() { return bandsShown() ? mhTop + mhH : mainBottom(); }
  function svgH() { return chartBottom() + mB; }
  function xf(t) { return mL + (t - view[0]) / (view[1] - view[0]) * plotW; }
  function yS(v) { return mainTop + mainH * (1 - Math.min(v, SPEED_MAX) / SPEED_MAX); }
  function yR(v) { return mainTop + mainH * (1 - Math.min(v, ROUGH_MAX) / ROUGH_MAX); }
  function yRdb(v) { return mainTop + mainH * (1 - Math.min(v, ROUGHDB_MAX) / ROUGHDB_MAX); }
  function yRough(v) { return roughMode === "db" ? yRdb(v) : yR(v); }
  // dB axis ranges auto-fit to the chaos data in ribbon mode, else the fixed level-view range.
  function lowRange() { return (ribbonOn && squelch) ? squelch.scale.low : LOW_DB; }
  function mhRange() { return (ribbonOn && squelch) ? squelch.scale.mh : MH_DB; }
  function yDbLow(db) { var r = lowRange(); return lowTop + lowH * (1 - (clamp(db, r[0], r[1]) - r[0]) / (r[1] - r[0])); }
  function yDbMH(db) { var r = mhRange(); return mhTop + mhH * (1 - (clamp(db, r[0], r[1]) - r[0]) / (r[1] - r[0])); }
  function niceTicks(r) { var a = r[0], b = r[1], rd = function (v) { return Math.round(v / 2) * 2; }; return [rd(a + (b - a) * 0.18), rd((a + b) / 2), rd(a + (b - a) * 0.82)]; }
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
  // The car's smooth-pavement baseline: this run's own speed-conditioned floor (dB) at each
  // frame's speed, drawn dashed UNDER the live band noise. The vertical gap above it is the
  // per-band delta-dB — what the roughness measures. Steps with speed (a faster stretch has a
  // louder smooth-road baseline), which is exactly the point.
  function bandFloorLine(arr, color, yfn) {
    var hr = D.hires;
    if (!bandsOn || !hr || !arr) return "";
    var stride = Math.max(1, Math.floor(((view[1] - view[0]) / hr.dt) / 650));
    var d = "";
    for (var i = 0; i < arr.length; i += stride) {
      var t = hr.t0 + i * hr.dt;
      if (t < view[0] - 0.1 || t > view[1] + 0.1) continue;
      d += xf(t).toFixed(1) + "," + yfn(arr[i]).toFixed(1) + " ";
    }
    return d ? '<polyline fill="none" stroke="' + color + '" stroke-width="1" stroke-dasharray="4 3" opacity="0.7" points="' + d.trim() + '"/>' : "";
  }
  // Shade the low (road) panel's delta: the region between the rumble and its smooth-road
  // baseline. Clamped so only positive delta (noise above floor) is filled. This shaded band
  // IS the delta-dB, in the cleanest channel — the visual meaning of the roughness number.
  function lowDeltaFill() {
    var hr = D.hires;
    if (!bandsOn || !hr || !hr.lo || !hr.floLo) return "";
    var stride = Math.max(1, Math.floor(((view[1] - view[0]) / hr.dt) / 650));
    var top = "", floor = [], any = false;
    for (var i = 0; i < hr.lo.length; i += stride) {
      var t = hr.t0 + i * hr.dt;
      if (t < view[0] - 0.1 || t > view[1] + 0.1) continue;
      var f = hr.floLo[i], a = hr.lo[i] > f ? hr.lo[i] : f; // clamp to floor: fill positive delta only
      var x = xf(t).toFixed(1);
      top += x + "," + yDbLow(a).toFixed(1) + " ";
      floor.push(x + "," + yDbLow(f).toFixed(1));
      any = true;
    }
    if (!any) return "";
    floor.reverse();
    return '<polygon fill="rgba(95,211,95,0.16)" stroke="none" points="' + top.trim() + " " + floor.join(" ") + '"/>';
  }
  // Aperiodic-chaos ribbon: per squelch point a vertical bar spanning ±chaos around the band
  // level, coloured cool (tonal/rhythmic, habituated) → hot (noise-like, novel), plus a centre
  // line at the level. Replaces the 47 Hz picket fence with the felt-chaos view.
  function hueMix(t) { // 0 = tonal cool, 1 = chaos hot
    var a = [58, 111, 216], b = [255, 90, 58], m = function (i) { return Math.round(a[i] + (b[i] - a[i]) * t); };
    return "rgb(" + m(0) + "," + m(1) + "," + m(2) + ")";
  }
  function chaosRibbon(series, yfn, lineColor) {
    if (!series || !series.length) return "";
    var span = view[1] - view[0], hop = squelch.params.hopSec;
    var stride = Math.max(1, Math.floor((span / hop) / 900)); // stride by points IN VIEW, not total
    var bw = Math.max(1, stride * hop / span * plotW);          // bar spans its stride so bars abut (no gap)
    var bars = "", line = "";
    for (var i = 0; i < series.length; i += stride) {
      var p = series[i]; if (p.t < view[0] - 1 || p.t > view[1] + 1) continue;
      var x = xf(p.t), yTop = yfn(p.c + p.chaos), yBot = yfn(p.c - p.chaos);
      bars += '<rect x="' + (x - bw / 2).toFixed(2) + '" y="' + yTop.toFixed(1) + '" width="' + bw.toFixed(2)
        + '" height="' + Math.max(0.5, yBot - yTop).toFixed(1) + '" fill="' + hueMix(clamp(1 - p.per, 0, 1)) + '" opacity="0.5"/>';
      line += x.toFixed(1) + "," + yfn(p.c).toFixed(1) + " ";
    }
    return bars + '<polyline fill="none" stroke="' + lineColor + '" stroke-width="1.3" points="' + line.trim() + '"/>';
  }
  function bandLines() {
    var hr = D.hires;
    if (!bandsShown()) return "";
    if (ribbonOn && squelch) { // chaos view: low ribbon in the low panel, mid+high in the MH panel
      return chaosRibbon(squelch.low, yDbLow, C_LO) + chaosRibbon(squelch.mid, yDbMH, C_MI) + chaosRibbon(squelch.high, yDbMH, C_HI);
    }
    // level view — paint order: delta fill (back) -> dashed baselines -> live band lines (front)
    return lowDeltaFill()
      + bandFloorLine(hr.floLo, C_LOF, yDbLow) + bandFloorLine(hr.floMi, C_MIF, yDbMH) + bandFloorLine(hr.floHi, C_HIF, yDbMH)
      + bandLine(hr.lo, C_LO, yDbLow) + bandLine(hr.mi, C_MI, yDbMH) + bandLine(hr.hi, C_HI, yDbMH);
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
      var rib = ribbonOn && squelch;
      bandPanel += panelScaffold(lowTop, lowH, rib ? niceTicks(lowRange()) : [-40, -30, -20], yDbLow, rib
        ? '<tspan fill="' + C_LO + '" font-weight="600">low</tspan> 80-250 Hz &mdash; <tspan font-weight="600">aperiodic chaos</tspan> (dB): ribbon width = chaos, hue <tspan fill="#6f9bff">tonal</tspan>&rarr;<tspan fill="#ff7a5a">noise</tspan>'
        : '<tspan fill="' + C_LO + '" font-weight="600">low</tspan> 80-250 Hz &mdash; road rumble (dB) &middot; <tspan fill="' + C_LOF + '">dashed = smooth-road baseline</tspan>, shaded gap = delta-dB');
      bandPanel += panelScaffold(mhTop, mhH, rib ? niceTicks(mhRange()) : [-65, -50, -35], yDbMH, rib
        ? '<tspan fill="' + C_MI + '" font-weight="600">mid</tspan> &nbsp;<tspan fill="' + C_HI + '" font-weight="600">high</tspan> &mdash; <tspan font-weight="600">aperiodic chaos</tspan> (dB): width = chaos, hue tonal&rarr;noise'
        : '<tspan fill="' + C_MI + '" font-weight="600">mid</tspan> 250-1k &nbsp;<tspan fill="' + C_HI + '" font-weight="600">high</tspan> 1-4k Hz &mdash; voices + cargo (dB) &middot; dashed = baseline');
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

  // ---- hover-inspect: dots + delta segment on the lines, values in a tooltip BELOW the
  // hovered panel (never over the data). Immediate (mousemove, no delay). In a band panel it
  // marks the baseline dot + noise dot and the segment between them = the delta-dB; in the
  // main panel it marks speed + roughness (no baseline — roughness IS the delta already).
  var tt = document.getElementById("tt");
  var wrap = document.getElementById("chartwrap");
  function svgY(clientY) { var s = svgEl(); if (!s) return null; var r = s.getBoundingClientRect(); return (clientY - r.top) * (W / r.width); }
  function nearestPtIdx(t) { var best = 0, bd = Infinity; for (var i = 0; i < pts.length; i++) { var d = Math.abs(pts[i].t - t); if (d < bd) { bd = d; best = i; } } return best; }
  function nearestPt(t) { return pts[nearestPtIdx(t)]; }
  // The smoothed (envelope) value at a point — same centered moving average roughEnvelope draws.
  function smoothedAt(idx) { var k = Math.floor(smoothW / 2), s = 0, n = 0, lo = idx - k < 0 ? 0 : idx - k, hi = idx + k > pts.length - 1 ? pts.length - 1 : idx + k; for (var j = lo; j <= hi; j++) { s += roughField(pts[j]); n++; } return s / n; }
  function hiresIdx(t) { var hr = D.hires; var i = Math.round((t - hr.t0) / hr.dt); return i < 0 ? 0 : i > hr.lo.length - 1 ? hr.lo.length - 1 : i; }
  // The band lines are drawn at `stride` (every Nth 47 Hz sample) for legibility; the drawn
  // stride so the dot always sits on the polyline you actually see (and the reported value is
  // the visible peak, not a full-res one the line smoothed away).
  function bandStride() { var hr = D.hires; return Math.max(1, Math.floor(((view[1] - view[0]) / hr.dt) / 650)); }
  // Peak-snap: near a narrow spike the nearest drawn vertex isn't the tip. Within a ~3px window
  // of the cursor, snap to the most prominent drawn vertex (max |level - baseline|, up OR down)
  // — but only when it's clearly taller than at the cursor, so flat stretches still track the
  // mouse. `center` must already be stride-aligned; `bands` = the line(s) the panel shows.
  function peakSnap(center, stride, bands) {
    var hr = D.hires, spp = ((view[1] - view[0]) / hr.dt) / plotW, win = Math.max(stride, Math.round(3 * spp));
    var lo = center - win < 0 ? 0 : center - win, hi = center + win > hr.lo.length - 1 ? hr.lo.length - 1 : center + win;
    function dev(i) { var m = 0; for (var b = 0; b < bands.length; b++) { var base = bands[b].base ? bands[b].base[i] : 0, d = Math.abs(bands[b].arr[i] - base); if (d > m) m = d; } return m; }
    var cDev = dev(center), best = center, bDev = cDev, start = Math.ceil(lo / stride) * stride;
    for (var i = start; i <= hi; i += stride) { var d = dev(i); if (d > bDev) { bDev = d; best = i; } }
    return (bDev >= 2 && bDev - cDev > 0.75) ? best : center;
  }
  function hideHover() { if (tt) tt.style.display = "none"; var s = svgEl(); if (s) { var g = s.querySelector("#hover"); if (g) g.parentNode.removeChild(g); } }
  function dotSvg(x, y, color) { return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.4" fill="' + color + '" stroke="#111" stroke-width="0.8"/>'; }
  function dotSvgSm(x, y, color) { return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.4" fill="' + color + '" opacity="0.5" stroke="#111" stroke-width="0.6"/>'; }
  function segSvg(x, y1, y2, color, w) { return '<line x1="' + x.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="' + color + '" stroke-width="' + w + '"/>'; }
  function ttHead(t, speed) { return '<div class="tthead">t ' + t.toFixed(1) + 's · <span style="color:' + C_SPEED + '">speed ' + speed.toFixed(1) + ' m/s</span></div>'; }
  function nearestSq(series, t) { var best = series[0], bd = Infinity; for (var i = 0; i < series.length; i++) { var d = Math.abs(series[i].t - t); if (d < bd) { bd = d; best = series[i]; } } return best; }
  function ttChaos(sw, name, p) {
    return '<div><span class="ttsw" style="background:' + sw + '"></span>' + name + ' level <b>' + p.c.toFixed(1) + '</b> · chaos <b style="color:'
      + hueMix(clamp(1 - p.per, 0, 1)) + '">' + p.chaos.toFixed(2) + '</b> dB · rhythm ' + (100 * p.per).toFixed(0) + '%</div>';
  }
  function ttRow(sw, name, rec, base) {
    var d = rec - base;
    return '<div><span class="ttsw" style="background:' + sw + '"></span>' + name + ' rec <b>' + rec.toFixed(1)
      + '</b> · base ' + base.toFixed(1) + ' · Δ <b style="color:' + (d > 0 ? "#ffd27a" : "#8fbf8f") + '">'
      + (d >= 0 ? "+" : "") + d.toFixed(1) + '</b> dB</div>';
  }
  function fmtD(d) { return (d >= 0 ? "+" : "") + d.toFixed(1); }
  function dChip(sw, name, d) { return '<span class="ttsw" style="background:' + sw + '"></span>' + name + ' <b style="color:' + (d > 0 ? "#ffd27a" : "#8fbf8f") + '">' + fmtD(d) + '</b>'; }
  // Per-band level above baseline, averaged over the cursor's ~1 s window (matches the 1 Hz
  // roughness): the composition of the noise — low = engine/road, mid+high = radio/voices/wind.
  function bandAvg(ta, tb) {
    var hr = D.hires, a = hiresIdx(ta), b = hiresIdx(tb), n = 0, lo = 0, mi = 0, hi = 0, fl = 0, fm = 0, fh = 0;
    for (var i = a; i <= b; i++) { lo += hr.lo[i]; mi += hr.mi[i]; hi += hr.hi[i]; fl += hr.floLo ? hr.floLo[i] : 0; fm += hr.floMi ? hr.floMi[i] : 0; fh += hr.floHi ? hr.floHi[i] : 0; n++; }
    if (!n) n = 1;
    return { lo: lo / n, mi: mi / n, hi: hi / n, fl: fl / n, fm: fm / n, fh: fh / n };
  }
  function showHover(clientX, clientY) {
    if (drag && drag.moved) { hideHover(); return; }
    var s = svgEl(); if (!s) return;
    var sx = svgX(clientX), sy = svgY(clientY);
    if (sx == null || sy == null || sx < mL || sx > mL + plotW) { hideHover(); return; }
    var t = view[0] + (sx - mL) / plotW * (view[1] - view[0]), hr = D.hires;
    var panel = null;
    if (sy >= mainTop && sy <= mainTop + mainH) panel = "main";
    else if (bandsShown() && sy >= lowTop && sy <= lowTop + lowH) panel = "low";
    else if (bandsShown() && sy >= mhTop && sy <= mhTop + mhH) panel = "mh";
    if (!panel) { hideHover(); return; }

    var GUIDE = "rgba(255,255,255,0.16)", marks, html, panelBottom, xS;
    if (panel === "main") {
      var pi = nearestPtIdx(t), p = pts[pi]; xS = xf(p.t);
      var rv = roughField(p), units = roughMode === "db" ? " dB above floor" : " / 100";
      marks = segSvg(xS, mainTop, mainTop + mainH, GUIDE, 1) + dotSvg(xS, yS(p.speed), C_SPEED);
      var rline;
      if (envelopeOn) { // two lines drawn (faint raw + bold smoothed) — mark and report both
        var sv = smoothedAt(pi);
        marks += dotSvgSm(xS, yRough(rv), C_ROUGH) + dotSvg(xS, yRough(sv), C_ROUGH);
        rline = '<div><span class="ttsw" style="background:' + C_ROUGH + '"></span>roughness smoothed <b>' + sv.toFixed(1)
          + '</b> · raw ' + rv.toFixed(1) + units + ' (' + smoothW + 's avg)</div>';
      } else {
        marks += dotSvg(xS, yRough(rv), C_ROUGH);
        rline = '<div><span class="ttsw" style="background:' + C_ROUGH + '"></span>roughness <b>' + rv.toFixed(1) + '</b>' + units + '</div>';
      }
      html = ttHead(p.t, p.speed) + rline;
      if (hr && hr.lo) { // composition: which bands sit above baseline right here (~1 s avg)
        var av = bandAvg(p.t - 0.5, p.t + 0.5);
        html += '<div>' + dChip(C_LO, "low", av.lo - av.fl) + ' · ' + dChip(C_MI, "mid", av.mi - av.fm)
          + ' · ' + dChip(C_HI, "high", av.hi - av.fh) + ' dB over base</div>';
      }
      panelBottom = mainTop + mainH;
    } else if (panel === "low") {
      if (ribbonOn && squelch) { // chaos view: level/chaos/rhythm at the nearest squelch point
        var sqL = nearestSq(squelch.low, t); xS = xf(sqL.t);
        marks = segSvg(xS, lowTop, lowTop + lowH, GUIDE, 1) + segSvg(xS, yDbLow(sqL.c + sqL.chaos), yDbLow(sqL.c - sqL.chaos), C_LO, 1.6) + dotSvg(xS, yDbLow(sqL.c), C_LO);
        html = ttHead(sqL.t, nearestPt(sqL.t).speed) + ttChaos(C_LO, "low", sqL);
      } else {
        var sL = bandStride(), i = peakSnap(Math.round(hiresIdx(t) / sL) * sL, sL, [{ arr: hr.lo, base: hr.floLo }]);
        var tS = hr.t0 + i * hr.dt; xS = xf(tS);
        var rec = hr.lo[i], base = hr.floLo ? hr.floLo[i] : rec, sp = nearestPt(tS).speed;
        marks = segSvg(xS, lowTop, lowTop + lowH, GUIDE, 1) + segSvg(xS, yDbLow(rec), yDbLow(base), C_LO, 1.4)
          + dotSvg(xS, yDbLow(base), C_LOF) + dotSvg(xS, yDbLow(rec), C_LO);
        html = ttHead(tS, sp) + ttRow(C_LO, "low", rec, base);
      }
      panelBottom = lowTop + lowH;
    } else {
      if (ribbonOn && squelch) {
        var sqM = nearestSq(squelch.mid, t), sqH = nearestSq(squelch.high, t); xS = xf(sqM.t);
        marks = segSvg(xS, mhTop, mhTop + mhH, GUIDE, 1)
          + segSvg(xS, yDbMH(sqM.c + sqM.chaos), yDbMH(sqM.c - sqM.chaos), C_MI, 1.6) + dotSvg(xS, yDbMH(sqM.c), C_MI)
          + segSvg(xS, yDbMH(sqH.c + sqH.chaos), yDbMH(sqH.c - sqH.chaos), C_HI, 1.6) + dotSvg(xS, yDbMH(sqH.c), C_HI);
        html = ttHead(sqM.t, nearestPt(sqM.t).speed) + ttChaos(C_MI, "mid", sqM) + ttChaos(C_HI, "high", sqH);
      } else {
        var sM = bandStride(), j = peakSnap(Math.round(hiresIdx(t) / sM) * sM, sM, [{ arr: hr.mi, base: hr.floMi }, { arr: hr.hi, base: hr.floHi }]);
        var tS2 = hr.t0 + j * hr.dt; xS = xf(tS2);
        var mr = hr.mi[j], mb = hr.floMi ? hr.floMi[j] : mr, hrr = hr.hi[j], hb = hr.floHi ? hr.floHi[j] : hrr, sp2 = nearestPt(tS2).speed;
        marks = segSvg(xS, mhTop, mhTop + mhH, GUIDE, 1)
          + segSvg(xS, yDbMH(mr), yDbMH(mb), C_MI, 1.4) + dotSvg(xS, yDbMH(mb), C_MIF) + dotSvg(xS, yDbMH(mr), C_MI)
          + segSvg(xS, yDbMH(hrr), yDbMH(hb), C_HI, 1.4) + dotSvg(xS, yDbMH(hb), C_HIF) + dotSvg(xS, yDbMH(hrr), C_HI);
        html = ttHead(tS2, sp2) + ttRow(C_MI, "mid", mr, mb) + ttRow(C_HI, "high", hrr, hb);
      }
      panelBottom = mhTop + mhH;
    }
    var g = s.querySelector("#hover");
    if (g) g.parentNode.removeChild(g);
    g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("id", "hover"); g.setAttribute("pointer-events", "none");
    g.innerHTML = marks; s.appendChild(g);
    if (!tt || !wrap) return;
    tt.innerHTML = html; tt.style.display = "block";
    var rect = s.getBoundingClientRect(), wrect = wrap.getBoundingClientRect(), scale = rect.width / W;
    tt.style.top = ((rect.top - wrect.top) + (panelBottom + 8) * scale).toFixed(0) + "px";
    var left = (rect.left - wrect.left) + xS * scale - tt.offsetWidth / 2, maxL = wrect.width - tt.offsetWidth - 2;
    tt.style.left = (left < 2 ? 2 : left > maxL ? maxL : left).toFixed(0) + "px";
  }
  chart.addEventListener("mousemove", function (e) { showHover(e.clientX, e.clientY); });
  chart.addEventListener("mouseleave", hideHover);

  function updateBandsBtn() { if (bandsBtn) bandsBtn.textContent = bandsOn ? "Bands: on" : "Bands: off"; }
  if (bandsBtn) {
    if (D.hires && D.hires.lo) {
      bandsBtn.style.display = "";
      bandsBtn.addEventListener("click", function () { bandsOn = !bandsOn; updateBandsBtn(); render(); });
    } else {
      bandsBtn.style.display = "none";
    }
  }

  function updateRibbonBtn() { if (ribbonBtn) ribbonBtn.textContent = ribbonOn ? "Band view: chaos" : "Band view: levels"; }
  if (ribbonBtn) {
    if (squelch) {
      ribbonBtn.style.display = "";
      ribbonBtn.addEventListener("click", function () { ribbonOn = !ribbonOn; updateRibbonBtn(); render(); });
    } else {
      ribbonBtn.style.display = "none";
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
  updateRibbonBtn();
  updateRoughBtn();
  updatePlayBtn();
  render();
}

const data = { pts, anns, maxT, label, audioUrl, hires, bandsOn, envelopeOn, squelch };
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
  #chartwrap{position:relative;max-width:1240px;}
  #chart{max-width:1240px;}
  #tt{position:absolute;display:none;pointer-events:none;background:#111;color:#dcdcdc;border:1px solid #666;border-radius:5px;padding:6px 9px;font-size:12px;line-height:1.5;white-space:nowrap;box-shadow:0 3px 12px rgba(0,0,0,.55);z-index:5;font-variant-numeric:tabular-nums;}
  #tt .tthead{color:#9fb7d4;margin-bottom:2px;}
  #tt .ttsw{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:middle;margin-right:5px;}
  .panel{background:#555;padding:.8rem 1rem;border-radius:6px;max-width:1240px;margin-top:1rem;line-height:1.5;}
  .sw{display:inline-block;width:22px;height:3px;vertical-align:middle;margin-right:6px;}
  code{background:#666;padding:0 4px;border-radius:3px;}
</style></head><body>
<div class="toolbar">
  <button id="play" type="button" style="display:none">&#9654; Play</button>
  <button id="reset" type="button">Reset zoom (full pass)</button>
  <button id="roughmode" type="button" style="display:none">Rough: dB</button>
  <button id="bands" type="button" style="display:none">Bands: on</button>
  <button id="ribbon" type="button" style="display:none">Band view: chaos</button>
  <span id="smoothctl" style="display:none;color:#dcdcdc;">smooth <input id="smooth" type="range" min="1" max="11" step="2" value="5" style="vertical-align:middle;width:120px"> <span id="smoothval" style="color:#9fb7d4;font-variant-numeric:tabular-nums">5s</span></span>
  <span id="range"></span>
</div>
<div class="toolbar">
  <span class="hint">hover any panel to read exact values (level, baseline, &Delta;) in a tooltip below it &middot; full view: click to zoom to 30&nbsp;s &middot; zoomed: drag to pan, click to seek audio, double-click to reset &middot; Play sweeps a playhead (localhost only) and the zoomed view follows it.</span>
</div>
<div id="chartwrap"><div id="chart"></div><div id="tt"></div></div>
<div class="panel">
  <div><span class="sw" style="background:#4da3ff"></span><b>speed</b> (left axis, m/s) &nbsp;&middot;&nbsp;
       <span class="sw" style="background:#ffc04d"></span><b>roughness</b> (right axis) &mdash; defaults to <b>dB above the speed-conditioned floor</b> (log, doesn't saturate); the <b>Rough</b> button switches to the raw linear 0&ndash;100 score. Bands reweighted <b>low&nbsp;0.6 / mid&nbsp;0.3 / high&nbsp;0.1</b> (high de-emphasized: cargo rattle, not road).</div>
  <div style="margin-top:.4rem"><span class="sw" style="background:rgba(255,192,77,0.4)"></span><b>faint amber</b> = per-frame roughness at <b>~47&nbsp;Hz</b> (the sub-second structure SP1 averages into each 1&nbsp;s point) &mdash; a narrow spike is a &lt;0.1&nbsp;s transient, a plateau is a sustained sound. Follows the current roughness scale (dB or linear).</div>
  <div style="margin-top:.4rem"><b>Envelope</b>: the bold roughness line is a centered moving average (temporal envelope) over the <b>smooth</b> width; the faint line under it is the raw 1&nbsp;s value. Widen the slider to collapse per-second jitter into a trend.</div>
  <div style="margin-top:.4rem"><b>Band panels</b> (dB, log/perceptual) &mdash; the road channel is kept in its own panel:
       <span class="sw" style="background:#5fd35f"></span><b>low</b> 80&ndash;250&nbsp;Hz = <b>road rumble</b> (clean of voices); below it,
       <span class="sw" style="background:#b98cff"></span>mid and <span class="sw" style="background:#ff7bac"></span>high = <b>voices + cargo rattle</b>. Toggle with <b>Bands</b>.</div>
  <div style="margin-top:.4rem"><span class="sw" style="background:#7cc47c;height:0;border-top:2px dashed #7cc47c"></span><b>Baseline (dashed)</b> = this car's computed <b>noise floor on smooth pavement at that instant's speed</b> &mdash; the per-band 10th-percentile floor from <b>this run's own</b> speed-conditioned baseline (varies car to car and trip to trip, but is the same on equally smooth roads at the same speed). It <b>rises with speed</b>: a faster stretch is louder even on glass-smooth asphalt.
       The <span style="color:#5fd35f"><b>shaded green gap</b></span> in the low panel is the <b>delta-dB</b> &mdash; how far the rumble sits <i>above</i> that baseline. That gap, weighted <b>low&nbsp;0.6&thinsp;/&thinsp;mid&nbsp;0.3&thinsp;/&thinsp;high&nbsp;0.1</b> across the three bands, <b>is the roughness number</b> on the main panel. Baseline flat + rumble flat = smooth road at 0&nbsp;dB delta; rumble lifting off the baseline = felt roughness.</div>
  <div style="margin-top:.4rem"><b>Band view: chaos</b> (toggle) &mdash; replaces the picket fence with the <b>aperiodic-chaos ribbon</b>: the centre line is band level, the <b>ribbon width is chaos</b> (the envelope's spread with the periodic rhythm removed), and the <b>hue</b> runs <span style="color:#6f9bff">cool = tonal/rhythmic</span> (engine, habituated) &rarr; <span style="color:#ff7a5a">hot = noise-like</span> (road, novel/strobe-like). A loud but pinched cool bar is your engine; a wide hot bloom is the road. Squelch &tau; is band-specific (low 12.5&nbsp;ms, mid 4&nbsp;ms, high 1&nbsp;ms).</div>
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
