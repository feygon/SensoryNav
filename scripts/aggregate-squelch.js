// scripts/aggregate-squelch.js
// Cross-pass aggregation of APERIODIC CHAOS (the squelch measure), parallel to
// aggregate-rough.js but on felt-chaos instead of delta-dB loudness. Question: is aperiodic
// chaos MORE reproducibly tied to a location than delta-dB was (ICC 0.63)? If so, felt-chaos
// is a better positional signal than loudness. Squelch is time-indexed, so each chaos point is
// mapped to lat/lon through the scored windows. Default band = low (road rumble, clean of
// speech, weighted highest); talking is NOT excluded because speech lives in mid/high, not low.
// Usage: node scripts/aggregate-squelch.js [cellSizeMeters=25] [band=low]
// band is any key squelch-clean.json carries a per-point array for: subbass|low|mid|high.
"use strict";
const fs = require("fs");

const CELL = Number(process.argv[2]) || 25;
const BAND = process.argv[3] || "low";
const PASSES = [
  { id: "jc1", dir: "out/score-jc1" },
  { id: "jc2", dir: "out/score-jc2" },
  { id: "jc3", dir: "out/score-seat" },
  { id: "jc4", dir: "out/score-jc4" },
  { id: "jc5", dir: "out/score-jc5" }
];
const MLAT = 111000, MLON = 78700; // metres per degree at ~45.46N
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };
const median = (a) => q(a, 0.5);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const key = (lat, lon) => Math.round(lat * MLAT / CELL) + "_" + Math.round(lon * MLON / CELL);

// Each chaos point -> lat/lon via the scored window at that second (1 Hz, audio-start origin).
const passPts = {};
const allChaos = [];
for (const p of PASSES) {
  const sc = JSON.parse(fs.readFileSync(p.dir + "/scored-clean.json", "utf8"));
  const t0 = sc[0].started_at_ms;
  const pos = [];
  for (const r of sc) if (Number.isFinite(r.lat)) pos[Math.round((r.started_at_ms - t0) / 1000)] = { lat: r.lat, lon: r.lon };
  const sq = JSON.parse(fs.readFileSync(p.dir + "/squelch-clean.json", "utf8"))[BAND];
  const rows = [];
  for (const s of sq) { const pp = pos[Math.round(s.t)]; if (pp) { rows.push({ lat: pp.lat, lon: pp.lon, chaos: s.chaos }); allChaos.push(s.chaos); } }
  passPts[p.id] = rows;
}
const ROUGH_TAU = q(allChaos, 0.75); // "chaotic" cell threshold
const CHOP_TAU = q(allChaos, 0.95);  // "serious chaos burst" threshold

const cells = {};
for (const p of PASSES) {
  for (const r of passPts[p.id]) {
    const k = key(r.lat, r.lon);
    if (!cells[k]) cells[k] = { lat: 0, lon: 0, n: 0, byPass: {} };
    const c = cells[k];
    c.lat += r.lat; c.lon += r.lon; c.n++;
    (c.byPass[p.id] = c.byPass[p.id] || []).push(r.chaos);
  }
}
const cellList = [];
for (const k in cells) {
  const c = cells[k];
  const passVals = {}, passPeak = {};
  for (const pid in c.byPass) { passVals[pid] = median(c.byPass[pid]); passPeak[pid] = q(c.byPass[pid], 0.9); }
  const passIds = Object.keys(passVals);
  const vals = passIds.map((pid) => passVals[pid]);
  const peaks = passIds.map((pid) => passPeak[pid]);
  cellList.push({
    key: k, lat: c.lat / c.n, lon: c.lon / c.n, nPasses: passIds.length, passVals, passPeak,
    cellMedian: median(vals), nRough: vals.filter((v) => v > ROUGH_TAU).length,
    peakMax: Math.max.apply(null, peaks), nChop: peaks.filter((v) => v > CHOP_TAU).length
  });
}

const cov = {};
for (const c of cellList) cov[c.nPasses] = (cov[c.nPasses] || 0) + 1;

const multi = cellList.filter((c) => c.nPasses >= 2);
let grand = 0, gn = 0;
for (const c of multi) for (const pid in c.passVals) { grand += c.passVals[pid]; gn++; }
grand /= gn;
let ssBetween = 0, ssWithin = 0;
for (const c of multi) {
  const vals = Object.values(c.passVals), cm = mean(vals);
  ssBetween += vals.length * (cm - grand) * (cm - grand);
  for (const v of vals) ssWithin += (v - cm) * (v - cm);
}
const icc = ssBetween / (ssBetween + ssWithin);

// Also test PEAK (p90) chaos per cell — a patch that spikes chaos when hit may localise better
// than the cell median, which smears momentary bursts (cf. the delta-dB worst-chop finding).
let gP = 0, gnP = 0;
for (const c of multi) for (const pid in c.passPeak) { gP += c.passPeak[pid]; gnP++; }
gP /= gnP;
let sbP = 0, swP = 0;
for (const c of multi) { const vals = Object.values(c.passPeak), cm = mean(vals); sbP += vals.length * (cm - gP) * (cm - gP); for (const v of vals) swP += (v - cm) * (v - cm); }
const iccPeak = sbP / (sbP + swP);

function spearman(xs, ys) {
  const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((p, q2) => p[0] - q2[0]); const r = []; idx.forEach((e, i) => r[e[1]] = i); return r; };
  const rx = rank(xs), ry = rank(ys), n = xs.length; let d = 0;
  for (let i = 0; i < n; i++) d += (rx[i] - ry[i]) ** 2;
  return 1 - 6 * d / (n * (n * n - 1));
}
const odd = ["jc1", "jc3", "jc5"], even = ["jc2", "jc4"];
const shx = [], shy = [];
for (const c of cellList) {
  const o = odd.filter((p) => c.passVals[p] != null).map((p) => c.passVals[p]);
  const e = even.filter((p) => c.passVals[p] != null).map((p) => c.passVals[p]);
  if (o.length && e.length) { shx.push(mean(o)); shy.push(mean(e)); }
}
const splitR = spearman(shx, shy);

console.log("=== Aperiodic-CHAOS aggregation over 5 JC passes (band " + BAND + ", cell " + CELL + "m) ===");
console.log("chaos points per pass:", PASSES.map((p) => p.id + "=" + passPts[p.id].length).join(" "));
console.log("chaotic threshold (p75):", ROUGH_TAU.toFixed(2), "dB | serious-burst (p95):", CHOP_TAU.toFixed(2), "dB");
console.log("total cells:", cellList.length, "| coverage:", Object.keys(cov).sort().map((k) => k + "p:" + cov[k]).join(" "));
console.log("");
console.log("REPRODUCIBILITY (does the same location read chaotic across independent passes?)");
console.log("  ICC (between-cell / total, cells>=2, n=" + multi.length + "):", icc.toFixed(3),
  icc > 0.5 ? "-> STRONG location signal" : icc > 0.3 ? "-> moderate" : "-> weak");
console.log("  ICC on PEAK (p90) chaos per cell:", iccPeak.toFixed(3), "(median smears momentary bursts)");
console.log("  split-half Spearman (odd {jc1,3,5} vs even {jc2,4}, n=" + shx.length + " cells):", splitR.toFixed(3));
console.log("  (compare delta-dB loudness: ICC 0.63, split-half 0.61)");
console.log("");

const confident = cellList.filter((c) => c.nPasses >= 3 && c.nRough >= 2).sort((a, b) => (b.nRough - a.nRough) || (b.cellMedian - a.cellMedian));
console.log("CONFIDENT CHAOS SPOTS (>=3 passes present, >=2 call it chaotic) — top 12 of " + confident.length + ":");
console.log("  lat        lon          agree   medianChaos  per-pass chaos [jc1 jc2 jc3 jc4 jc5]");
for (const c of confident.slice(0, 12)) {
  const pv = PASSES.map((p) => c.passVals[p.id] != null ? c.passVals[p.id].toFixed(2) : "  . ").join(" ");
  console.log("  " + c.lat.toFixed(5) + "  " + c.lon.toFixed(5) + "   " + c.nRough + "/" + c.nPasses + "     " + c.cellMedian.toFixed(2).padStart(5) + "       [" + pv + "]");
}

fs.mkdirSync("out/score-agg", { recursive: true });
fs.writeFileSync("out/score-agg/chaos-cells.json", JSON.stringify({
  cell_m: CELL, band: BAND, rough_tau: ROUGH_TAU, chop_tau: CHOP_TAU, icc, splitR,
  cells: cellList.map((c) => ({
    lat: +c.lat.toFixed(6), lon: +c.lon.toFixed(6), nPasses: c.nPasses,
    nRough: c.nRough, med: +c.cellMedian.toFixed(3), peak: +c.peakMax.toFixed(3), nChop: c.nChop
  }))
}));
console.log("\nwrote out/score-agg/chaos-cells.json (" + cellList.length + " cells)");
