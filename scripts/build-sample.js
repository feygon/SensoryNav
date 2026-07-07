// scripts/build-sample.js
// Build the PUBLIC sample dataset for the GitHub Pages dashboard from a local scored pass.
// This is the client→public boundary in miniature: it produces a DEIDENTIFIED, trimmed,
// audio-free projection of the pipeline JSON that is safe to publish.
//
// Transformations (the privacy guarantees, as code):
//   - trim to the first CUT_S seconds (drop the tail)                 [less trace published]
//   - strip lat/lon from every record and event                       [no GPS trace]
//   - rebase started_at_ms so the first window is t=0                  [no wall-clock "when"]
//   - carry NO audio (the pipeline JSON never held any; asserted)      [no audio]
// The timeline is time-based and does not plot GPS, so stripping lat/lon does not change it.
//
// Usage: node scripts/build-sample.js [srcDir=out/score-jc4] [outDir=sample/data] [cutSeconds=580]
"use strict";
const fs = require("fs");
const path = require("path");

const srcDir = process.argv[2] || "out/score-jc4";
const outDir = process.argv[3] || "sample/data";
const CUT_S = Number(process.argv[4]) || 580;
fs.mkdirSync(outDir, { recursive: true });

const read = (f) => JSON.parse(fs.readFileSync(path.join(srcDir, f), "utf8"));
const write = (f, o) => fs.writeFileSync(path.join(outDir, f), JSON.stringify(o));
const assertNoAudio = (o, where) => {
  const s = JSON.stringify(o);
  if (/wav|\baudio\b|samples|pcm/i.test(s)) throw new Error("refusing to publish: possible audio reference in " + where);
};

// ---- scored-clean.json: strip lat/lon, rebase time, trim ----
const scored = read("scored-clean.json");
const t0 = scored[0].started_at_ms;
const scoredOut = scored
  .filter((r) => (r.started_at_ms - t0) / 1000 < CUT_S)
  .map((r) => {
    const o = Object.assign({}, r);
    o.started_at_ms = r.started_at_ms - t0; // rebase to 0 (drop wall-clock epoch)
    delete o.lat; delete o.lon;             // drop GPS
    return o;
  });
assertNoAudio(scoredOut, "scored");
write("scored-clean.json", scoredOut);

// ---- squelch-clean.json: no GPS present; trim every band series + subbass_floor ----
const sq = read("squelch-clean.json");
const bands = ["subbass", "low", "mid", "high"];
let keepN = null;
for (const b of bands) {
  if (!Array.isArray(sq[b])) continue;
  const kept = sq[b].filter((p) => p.t < CUT_S);
  if (b === "subbass") keepN = kept.length;
  sq[b] = kept;
}
if (Array.isArray(sq.subbass_floor) && keepN != null) sq.subbass_floor = sq.subbass_floor.slice(0, keepN);
assertNoAudio(sq, "squelch");
write("squelch-clean.json", sq);

// ---- tags-clean.json: strip lat/lon from events, trim ----
const tags = read("tags-clean.json");
tags.events = (tags.events || [])
  .filter((e) => e.t_end < CUT_S)
  .map((e) => { const o = Object.assign({}, e); delete o.lat; delete o.lon; return o; });
assertNoAudio(tags, "tags");
write("tags-clean.json", tags);

// ---- highres-clean.json: audio-frame arrays, no GPS; trim all parallel arrays ----
try {
  const hr = read("highres-clean.json");
  const dt = hr.dt || (1 / 46.9);
  const base = hr.t0 || 0;
  const cutIdx = Math.max(0, Math.floor((CUT_S - base) / dt));
  for (const k of ["r", "rdb", "lo", "mi", "hi", "floLo", "floMi", "floHi", "speech"]) {
    if (Array.isArray(hr[k])) hr[k] = hr[k].slice(0, cutIdx);
  }
  assertNoAudio(hr, "highres");
  write("highres-clean.json", hr);
} catch (e) { console.log("highres skipped:", e.message); }

console.log("sample built ->", outDir, "| scored", scoredOut.length, "windows (<" + CUT_S + "s),",
  "subbass", sq.subbass.length, "pts, events", tags.events.length, "| GPS stripped, time rebased, no audio");
