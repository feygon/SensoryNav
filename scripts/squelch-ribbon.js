// scripts/squelch-ribbon.js  (PROTOTYPE)
// Aperiodic-chaos "squelch" ribbon. For one capture, band-limit the raw 48 kHz audio into
// low (80-250) and mid (250-1000), take each band's amplitude envelope at a band-specific
// squelch timescale tau, then over a sliding 1 s window separate the PERIODIC rhythm (engine
// firing, tonal drone — habituated) from the APERIODIC chaos (road, gravel, turbulence — the
// novel, strobe-like input) via envelope autocorrelation. Chaos, not loudness, is the ribbon.
//
//   center line = band level (dB)           — dimension 1, loudness (what we already had)
//   ribbon half-width = aperiodic chaos (dB) — dimension 2, the new "squelch" measure
//   ribbon hue = aperiodicity 1-periodicity  — tonal/rhythmic (cool) vs noise-like (hot)
//
// Runs entirely offline on the saved WAV — no re-driving. Amplitude chaos only; carrier-
// frequency wobble is a separate future metric. Low band is weighted up in the summary
// (an 80->100 Hz jitter is a bigger ratio than 250->270, so equal chaos hits harder low).
// Usage: node scripts/squelch-ribbon.js <sidecar.json> <out.html> [label] [scoredForSpeed.json]
"use strict";
const fs = require("fs");
const path = require("path");
const { decodeWav } = require("../harness/audio/wav-decoder");

const { computeSquelch } = require("./lib/squelch");
const W_LOW = 0.65, W_MID = 0.35;          // low-weighted "sensory chaos" summary

// ---- ribbon SVG (static, dark-mode; width = chaos, hue = aperiodicity) ----
function lerpHex(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const m = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return "#" + m.map((v) => v.toString(16).padStart(2, "0")).join("");
}
function panel(pts, top, h, plotW, mL, label, color) {
  let dmin = Infinity, dmax = -Infinity;
  for (const p of pts) { dmin = Math.min(dmin, p.c - p.chaos); dmax = Math.max(dmax, p.c + p.chaos); }
  dmin -= 2; dmax += 2;
  const maxT = pts.length ? pts[pts.length - 1].t : 1;
  const x = (t) => mL + t / maxT * plotW;
  const y = (db) => top + h * (1 - (db - dmin) / (dmax - dmin));
  const bw = Math.max(1, plotW / pts.length);
  let bars = "", line = "";
  for (const p of pts) {
    const col = lerpHex("#3a6fd8", "#ff5a3a", Math.max(0, Math.min(1, 1 - p.per))); // cool tonal -> hot chaos
    bars += '<rect x="' + (x(p.t) - bw / 2).toFixed(2) + '" y="' + y(p.c + p.chaos).toFixed(1) + '" width="' + bw.toFixed(2)
      + '" height="' + Math.max(0.4, y(p.c - p.chaos) - y(p.c + p.chaos)).toFixed(1) + '" fill="' + col + '" opacity="0.5"/>';
    line += x(p.t).toFixed(1) + "," + y(p.c).toFixed(1) + " ";
  }
  let ax = "";
  for (let db = Math.ceil(dmin / 5) * 5; db <= dmax; db += 5) {
    ax += '<line x1="' + mL + '" y1="' + y(db).toFixed(1) + '" x2="' + (mL + plotW) + '" y2="' + y(db).toFixed(1) + '" stroke="#333" stroke-width="0.6"/>'
      + '<text x="' + (mL - 8) + '" y="' + (y(db) + 4).toFixed(1) + '" fill="#888" font-size="11" text-anchor="end">' + db + '</text>';
  }
  return ax + bars + '<polyline fill="none" stroke="' + color + '" stroke-width="1.4" points="' + line.trim() + '"/>'
    + '<rect x="' + mL + '" y="' + top + '" width="' + plotW + '" height="' + h + '" fill="none" stroke="#888" stroke-width="1"/>'
    + '<text x="' + mL + '" y="' + (top - 8) + '" fill="#dcdcdc" font-size="12">' + label + '</text>';
}

// ---- main ----
const scPath = process.argv[2], outPath = process.argv[3];
const label = process.argv[4] || "pass";
const scoredPath = process.argv[5] || null;
if (!scPath || !outPath) { console.error("usage: node scripts/squelch-ribbon.js <sidecar.json> <out.html> [label] [scored.json]"); process.exit(1); }

const sidecar = JSON.parse(fs.readFileSync(scPath, "utf8"));
const dec = decodeWav(fs.readFileSync(path.join(path.dirname(scPath), sidecar.audio.wav_filename)));
const fs_ = dec.sampleRate;
console.log(label, "| samples", dec.samples.length, "|", (dec.samples.length / fs_).toFixed(1), "s @", fs_, "Hz");

const sq = computeSquelch(dec.samples, fs_);
const series = { low: sq.low, mid: sq.mid, high: sq.high };
sq.params.bands.forEach((b) => console.log("  " + b.key + " band (tau " + (b.tau * 1000).toFixed(1) + " ms):", series[b.key].length, "ribbon points"));

// align speed/roughness for the summary, if a scored file was given
let speedAt = () => null, roughAt = () => null;
if (scoredPath && fs.existsSync(scoredPath)) {
  const sc = JSON.parse(fs.readFileSync(scoredPath, "utf8"));
  const t0 = sc[0].started_at_ms;
  const rows = sc.map((r) => ({ t: (r.started_at_ms - t0) / 1000, sp: r.speed_mps, rd: r.roughness_db }));
  const near = (t) => rows[Math.max(0, Math.min(rows.length - 1, Math.round(t)))];
  speedAt = (t) => near(t).sp; roughAt = (t) => near(t).rd;
}

// summary: highest- vs lowest-chaos low-band moments, and chaos-vs-loudness contrast
const low = series.low.slice().map((p) => ({ ...p, sp: speedAt(p.t), rd: roughAt(p.t) }));
const byChaos = low.slice().sort((a, b) => b.chaos - a.chaos);
const fmt = (p) => "t=" + p.t.toFixed(0) + "s  chaos=" + p.chaos.toFixed(2) + "dB  per=" + p.per.toFixed(2) + "  level=" + p.c.toFixed(1) + "dB"
  + (p.sp != null ? "  speed=" + p.sp.toFixed(1) : "") + (p.rd != null ? "  rough_db=" + p.rd.toFixed(1) : "");
console.log("\n  LOW-band most chaotic (aperiodic):");
byChaos.slice(0, 6).forEach((p) => console.log("    " + fmt(p)));
console.log("  LOW-band calmest (most tonal/steady):");
byChaos.slice(-4).forEach((p) => console.log("    " + fmt(p)));
const mean = (a, f) => a.reduce((s, x) => s + f(x), 0) / (a.length || 1);
console.log("\n  mean low chaos:", mean(low, (p) => p.chaos).toFixed(2), "dB | mean low periodicity:", mean(low, (p) => p.per).toFixed(2));
const sens = series.low.map((p, i) => W_LOW * p.chaos + W_MID * (series.mid[i] ? series.mid[i].chaos : 0));
console.log("  low-weighted sensory chaos: mean", mean(sens, (x) => x).toFixed(2), "| p90", sens.slice().sort((a, b) => a - b)[Math.floor(0.9 * sens.length)].toFixed(2), "dB");

// write ribbon page
const W = 1240, mL = 58, mR = 20, plotW = W - mL - mR, top1 = 40, hP = 220, gap = 60;
const H = top1 + hP + gap + hP + 40;
const svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif" style="max-width:100%;height:auto">'
  + '<rect width="' + W + '" height="' + H + '" fill="#1a1a1a"/>'
  + '<text x="' + mL + '" y="24" fill="#f5f5f5" font-size="16" font-weight="600">' + label + ' — aperiodic-chaos squelch ribbon</text>'
  + panel(series.low, top1, hP, plotW, mL, "low 80–250 Hz · level (dB) with aperiodic-chaos ribbon (width) · cool=tonal, hot=noise", "#5fd35f")
  + panel(series.mid, top1 + hP + gap, hP, plotW, mL, "mid 250–1k Hz · level (dB) with aperiodic-chaos ribbon", "#b98cff")
  + '</svg>';
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<meta name="color-scheme" content="dark"><title>' + label + ' squelch ribbon</title>'
  + '<style>:root{color-scheme:dark}body{background:#1a1a1a;color:#dcdcdc;font-family:system-ui,sans-serif;margin:1.2rem}'
  + '.panel{background:#555;padding:.8rem 1rem;border-radius:6px;max-width:1240px;margin-top:1rem;line-height:1.5}'
  + '.sw{display:inline-block;width:22px;height:10px;border-radius:2px;vertical-align:middle;margin-right:6px}</style></head><body>'
  + '<div id="chart">' + svg + '</div>'
  + '<div class="panel"><div><b>Ribbon width = aperiodic chaos</b> (dB): the envelope\'s spread with the periodic rhythm removed — steady drone or a clean engine tone reads thin, gravel/impacts/turbulence read wide.</div>'
  + '<div style="margin-top:.4rem"><span class="sw" style="background:#3a6fd8"></span>cool = <b>tonal / rhythmic</b> (habituated) &nbsp; '
  + '<span class="sw" style="background:#ff5a3a"></span>hot = <b>noise-like / chaotic</b> (novel, strobe-like). The center line is band level (loudness) as before.</div>'
  + '<div style="margin-top:.4rem">Squelch τ is band-specific (low 12.5 ms, mid 4 ms) — the finest each band physically supports. Amplitude chaos only; carrier-frequency wobble is a separate metric.</div></div>'
  + '</body></html>';
fs.writeFileSync(outPath, html);
console.log("\nwrote", outPath);
