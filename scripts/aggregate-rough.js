// scripts/aggregate-rough.js
// Aggregate rough spots across repeated Johnson Creek passes. Each pass drives the same
// road, so a REAL rough spot recurs at the same GPS cell across independent passes while a
// one-off spike does not. We grid-bin clean windows (~cellSize m), take each pass's median
// roughness_db per cell, then measure (a) reproducibility across passes and (b) per-cell
// confidence = how many passes independently call the cell rough.
// Usage: node scripts/aggregate-rough.js [cellSizeMeters]  (default 25)
"use strict";
const fs = require("fs");

const CELL = Number(process.argv[2]) || 25;
const PASSES = [
  { id: "jc1", file: "out/score-jc1/scored-clean.json" },
  { id: "jc2", file: "out/score-jc2/scored-clean.json" },
  { id: "jc3", file: "out/score-seat/scored-clean.json" },
  { id: "jc4", file: "out/score-jc4/scored-clean.json" },
  { id: "jc5", file: "out/score-jc5/scored-clean.json" }
];
const MLAT = 111000, MLON = 78700; // metres per degree at ~45.46N
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };
const median = (a) => q(a, 0.5);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

// Load clean windows (reliability > 0 drops talking + zero-rel; require a real position).
const passWindows = {};
const allRough = [];
for (const p of PASSES) {
  const rows = JSON.parse(fs.readFileSync(p.file, "utf8"))
    .filter((r) => r.reliability > 0 && Number.isFinite(r.lat) && Number.isFinite(r.roughness_db));
  passWindows[p.id] = rows;
  for (const r of rows) allRough.push(r.roughness_db);
}
// Data-driven thresholds: p75 = "rough" (consistent-field detection on medians);
// p95 = "serious chop" (peak detection — a spot at least one pass hit hard).
const ROUGH_TAU = q(allRough, 0.75);
const CHOP_TAU = q(allRough, 0.95);

// Grid key and cell centroid.
const key = (lat, lon) => Math.round(lat * MLAT / CELL) + "_" + Math.round(lon * MLON / CELL);

// cells[key][passId] = [roughness_db values in that cell for that pass]
const cells = {};
for (const p of PASSES) {
  for (const r of passWindows[p.id]) {
    const k = key(r.lat, r.lon);
    if (!cells[k]) cells[k] = { lat: 0, lon: 0, n: 0, byPass: {} };
    const c = cells[k];
    c.lat += r.lat; c.lon += r.lon; c.n++;
    (c.byPass[p.id] = c.byPass[p.id] || []).push(r.roughness_db);
  }
}
// Per-cell: each pass contributes a median (stable field) AND a p90 peak (worst chop it
// recorded here). Median drives the reproducibility/consistency measures; the peak drives
// worst-chop detection, which matters where you DWELL (many windows/cell dilute the median).
const cellList = [];
for (const k in cells) {
  const c = cells[k];
  const passVals = {}, passPeak = {};
  for (const pid in c.byPass) { passVals[pid] = median(c.byPass[pid]); passPeak[pid] = q(c.byPass[pid], 0.9); }
  const passIds = Object.keys(passVals);
  const vals = passIds.map((pid) => passVals[pid]);
  const peaks = passIds.map((pid) => passPeak[pid]);
  cellList.push({
    key: k, lat: c.lat / c.n, lon: c.lon / c.n,
    nPasses: passIds.length, passVals, passPeak, cellMedian: median(vals),
    nRough: vals.filter((v) => v > ROUGH_TAU).length,
    peakMax: Math.max.apply(null, peaks),                  // worst chop any single pass hit
    nChop: peaks.filter((v) => v > CHOP_TAU).length        // how many passes hit serious chop
  });
}

// (a) Coverage: how many cells were visited by k passes.
const cov = {};
for (const c of cellList) cov[c.nPasses] = (cov[c.nPasses] || 0) + 1;

// (b) Reproducibility via ICC-like variance decomposition over cells with >=2 passes.
// between-cell variance vs within-cell (residual) variance of the pass-median values.
const multi = cellList.filter((c) => c.nPasses >= 2);
let grand = 0, gn = 0;
for (const c of multi) for (const pid in c.passVals) { grand += c.passVals[pid]; gn++; }
grand /= gn;
let ssBetween = 0, ssWithin = 0;
for (const c of multi) {
  const vals = Object.values(c.passVals);
  const cm = mean(vals);
  ssBetween += vals.length * (cm - grand) * (cm - grand);
  for (const v of vals) ssWithin += (v - cm) * (v - cm);
}
const icc = ssBetween / (ssBetween + ssWithin);

// (c) Split-half check: mean roughness of odd vs even passes over shared cells (Spearman).
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

// Report ---------------------------------------------------------------
console.log("=== Rough-spot aggregation over 5 JC passes (cell " + CELL + "m) ===");
console.log("clean windows per pass:", PASSES.map((p) => p.id + "=" + passWindows[p.id].length).join(" "));
console.log("rough threshold (p75 of clean window roughness_db):", ROUGH_TAU.toFixed(2), "dB");
console.log("serious-chop threshold (p95):", CHOP_TAU.toFixed(2), "dB");
console.log("total cells:", cellList.length, "| coverage by #passes:",
  Object.keys(cov).sort().map((k) => k + "p:" + cov[k]).join(" "));
console.log("");
console.log("REPRODUCIBILITY (do the same locations read rough across independent passes?)");
console.log("  ICC (between-cell / total variance, cells>=2 passes, n=" + multi.length + "):", icc.toFixed(3),
  icc > 0.5 ? "-> STRONG location signal" : icc > 0.3 ? "-> moderate" : "-> weak");
console.log("  split-half Spearman (odd {jc1,3,5} vs even {jc2,4} means, n=" + shx.length + " shared cells):", splitR.toFixed(3));
console.log("");

// Confident rough spots: visited by >=3 passes, ranked by agreement then magnitude.
const confident = cellList
  .filter((c) => c.nPasses >= 3 && c.nRough >= 2)
  .sort((a, b) => (b.nRough - a.nRough) || (b.cellMedian - a.cellMedian));
console.log("CONFIDENT ROUGH SPOTS (>=3 passes present, >=2 call it rough) — top 15 of " + confident.length + ":");
console.log("  lat        lon          agree   mediandB   per-pass dB");
for (const c of confident.slice(0, 15)) {
  const pv = PASSES.map((p) => c.passVals[p.id] != null ? c.passVals[p.id].toFixed(1) : " . ").join(" ");
  console.log("  " + c.lat.toFixed(5) + "  " + c.lon.toFixed(5) + "   " + c.nRough + "/" + c.nPasses + "     " + c.cellMedian.toFixed(1).padStart(5) + "      [" + pv + "]  (jc1 jc2 jc3 jc4 jc5)");
}

// Worst-chop spots the consistency rule misses: high peak, low agreement (typically only
// the pass(es) that crawled slowly enough sensed it). These are the low-speed turnoff etc.
const worstChop = cellList
  .filter((c) => c.peakMax > CHOP_TAU && c.nRough < 3)
  .sort((a, b) => b.peakMax - a.peakMax);
console.log("\nWORST-CHOP spots (peak > " + CHOP_TAU.toFixed(1) + " dB but < 3 passes consistently rough) — top 10 of " + worstChop.length + ":");
console.log("  lat        lon          peakdB  chop/passes  per-pass PEAK dB");
for (const c of worstChop.slice(0, 10)) {
  const pv = PASSES.map((p) => c.passPeak[p.id] != null ? c.passPeak[p.id].toFixed(1) : " . ").join(" ");
  console.log("  " + c.lat.toFixed(5) + "  " + c.lon.toFixed(5) + "   " + c.peakMax.toFixed(1).padStart(5) + "   " + c.nChop + "/" + c.nPasses + "        [" + pv + "]");
}

// Persist the aggregate for the map view.
fs.mkdirSync("out/score-agg", { recursive: true });
fs.writeFileSync("out/score-agg/rough-cells.json", JSON.stringify({
  cell_m: CELL, rough_tau: ROUGH_TAU, chop_tau: CHOP_TAU, icc, splitR,
  cells: cellList.map((c) => ({
    lat: +c.lat.toFixed(6), lon: +c.lon.toFixed(6), nPasses: c.nPasses,
    nRough: c.nRough, med: +c.cellMedian.toFixed(2), peak: +c.peakMax.toFixed(2), nChop: c.nChop
  }))
}));
console.log("\nwrote out/score-agg/rough-cells.json (" + cellList.length + " cells)");
