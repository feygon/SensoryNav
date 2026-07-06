// scripts/verify-stop-quiet.js
// REQ-1 acceptance harness: "a stop goes quiet."
//
// Joins the sub-bass tonality ribbon (squelch-clean.json) to per-window speed
// (scored-clean.json) by nearest-second timestamp, then checks:
//   (a) median(tonality | idle, speed<0.5)  - median(tonality | rough, speed>=8) >= 0.15
//   (b) the idle and rough IQRs (p25,p75) do not overlap (idle p25 > rough p75)
//   (c) zero chaos-events (tags-clean.json) overlap any verified idle-stop window
//
// Usage: node scripts/verify-stop-quiet.js <outDir>
// Exits 0 on REQ-1 PASS, 1 on REQ-1 FAIL (or on missing/malformed input).
"use strict";
const fs = require("fs");
const path = require("path");

const IDLE_SPEED_MPS = 0.5;
const ROUGH_SPEED_MPS = 8;
const MIN_GAP = 0.15;
// SP1 windows are 1s (recorder/constants.js WINDOW_DURATION_MS); scored-clean.json's
// started_at_ms is ~1 Hz, so each window covers [t, t + WINDOW_DURATION_S).
const WINDOW_DURATION_S = 1.0;

function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN;
}
function pct(arr, p) {
  const s = arr.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor(p * (s.length - 1))] : NaN;
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

function main() {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error("usage: node scripts/verify-stop-quiet.js <outDir>");
    process.exit(1);
  }

  const scoredPath = path.join(outDir, "scored-clean.json");
  const squelchPath = path.join(outDir, "squelch-clean.json");
  const tagsPath = path.join(outDir, "tags-clean.json");
  const scored = JSON.parse(fs.readFileSync(scoredPath, "utf8"));
  const squelch = JSON.parse(fs.readFileSync(squelchPath, "utf8"));
  const tags = JSON.parse(fs.readFileSync(tagsPath, "utf8"));

  if (!scored.length) { console.error("scored-clean.json is empty"); process.exit(1); }
  const t0 = scored[0].started_at_ms;

  // Per-second speed lookup: scored windows are ~1 Hz, so Math.round(t) is a safe key.
  const speedByRoundedT = new Map();
  const idleWindows = []; // [t_start, t_end) for every window with speed < IDLE_SPEED_MPS
  for (const w of scored) {
    const t = (w.started_at_ms - t0) / 1000;
    const rt = Math.round(t);
    if (!speedByRoundedT.has(rt)) speedByRoundedT.set(rt, w.speed_mps);
    if (w.speed_mps < IDLE_SPEED_MPS) idleWindows.push([t, t + WINDOW_DURATION_S]);
  }

  // Join sub-bass tonality points to speed by nearest (rounded) second.
  const idleTonality = [];
  const roughTonality = [];
  for (const p of squelch.subbass) {
    const speed = speedByRoundedT.get(Math.round(p.t));
    if (speed === undefined) continue;
    if (speed < IDLE_SPEED_MPS) idleTonality.push(p.tonality);
    else if (speed >= ROUGH_SPEED_MPS) roughTonality.push(p.tonality);
  }

  const idleMedian = median(idleTonality);
  const roughMedian = median(roughTonality);
  const idleP25 = pct(idleTonality, 0.25), idleP75 = pct(idleTonality, 0.75);
  const roughP25 = pct(roughTonality, 0.25), roughP75 = pct(roughTonality, 0.75);
  const gap = idleMedian - roughMedian;
  const nonOverlapping = idleP25 > roughP75;

  // Zero-idle-events clause: count chaos events (top-10%-chaos, per detectEvents) whose
  // [t_start,t_end] overlaps any verified idle-stop window.
  const idleEvents = (tags.events || []).filter((e) =>
    idleWindows.some(([ws, we]) => overlaps(e.t_start, e.t_end, ws, we))
  );

  const roughWindowCount = scored.filter((w) => w.speed_mps >= ROUGH_SPEED_MPS).length;
  console.log("REQ-1 acceptance: a stop goes quiet");
  console.log("  idle windows (speed<%s): %d   rough windows (speed>=%s): %d", IDLE_SPEED_MPS, idleWindows.length, ROUGH_SPEED_MPS, roughWindowCount);
  console.log("  idle sub-bass tonality points: %d   rough sub-bass tonality points: %d", idleTonality.length, roughTonality.length);
  console.log("  idle  median=%s  IQR=[%s, %s]", fmt(idleMedian), fmt(idleP25), fmt(idleP75));
  console.log("  rough median=%s  IQR=[%s, %s]", fmt(roughMedian), fmt(roughP25), fmt(roughP75));
  console.log("  gap (idle - rough median) = %s   (need >= %s)", fmt(gap), MIN_GAP);
  console.log("  non-overlapping IQRs (idle p25 > rough p75): %s", nonOverlapping);
  console.log("  idle-window events (chaos events overlapping an idle window): %d   (need 0)", idleEvents.length);
  if (idleEvents.length) {
    for (const e of idleEvents.slice(0, 10)) console.log("    event t=[%s,%s]", fmt(e.t_start), fmt(e.t_end));
  }

  const gapOk = isFinite(gap) && gap >= MIN_GAP;
  const iqrOk = isFinite(idleP25) && isFinite(roughP75) && nonOverlapping;
  const eventsOk = idleEvents.length === 0;
  const pass = gapOk && iqrOk && eventsOk;

  console.log(pass ? "REQ-1 PASS" : "REQ-1 FAIL");
  if (!pass) {
    console.log("  failed clause(s): %s", [
      !gapOk && "gap>=0.15",
      !iqrOk && "non-overlapping IQRs",
      !eventsOk && "0 idle events"
    ].filter(Boolean).join(", "));
  }
  process.exit(pass ? 0 : 1);
}
function fmt(x) { return isFinite(x) ? x.toFixed(3) : String(x); }

main();
