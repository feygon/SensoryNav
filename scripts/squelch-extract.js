// scripts/squelch-extract.js
// Per-pass extractor: decodes the raw WAV, runs the NEW spectral-chaos DSP (subbass/low/
// mid/high tonality-chaos ribbons), joins it against the existing scored-window pipeline
// (speed/lat/lon/reliability from SP1+SP2) to fit a speed-conditioned baseline, detects
// sub-bass chaos events, and extracts starter tags per event. Writes squelch-clean.json
// (the ribbon series, for the timeline + cross-pass squelch aggregation) and tags-clean.json
// (event list with per-tag {value,confidence}, for the tag-discrimination research loop).
// Usage: node scripts/squelch-extract.js <sidecar.json> <outDir>
"use strict";
const fs = require("fs");
const path = require("path");
const { decodeWav } = require("../harness/audio/wav-decoder");
const { loadPass } = require("../harness/audio/load-pass");
const { buildMotionTrack } = require("../harness/motion/motion-track");
const { computeSpectralChaos } = require("../harness/score/spectral-chaos");
const { fitBaseline, floorAt } = require("../harness/score/baseline");
const { windowReliability } = require("../harness/score/reliability");
const { detectEvents } = require("../harness/tags/events");
const { extractTags } = require("../harness/tags/extract");
const { loadRegistry } = require("../harness/tags/schema");

const LEVEL_NORM_DB = 20;
const WINDOW_DURATION_S = 1.0; // SP1 windows are 1s (recorder/constants.js WINDOW_DURATION_MS)

// Nearest-in-time lookup into a series sorted ascending by a time field (binary search).
// Used for every cross-series join in this file: subbass series is 0.25s-hop and does NOT
// share index alignment with the low/mid/high series (each band's FFT size N differs, so
// each band's series is truncated by a different amount at the start/end) or with the SP1
// scored windows (1s hop). Joining by nearest time, not by index, is what keeps this correct.
function nearestIndex(arr, t, getT) {
  if (!arr.length) return -1;
  let lo = 0, hi = arr.length - 1;
  if (t <= getT(arr[0])) return 0;
  if (t >= getT(arr[hi])) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (getT(arr[mid]) <= t) lo = mid; else hi = mid;
  }
  return (t - getT(arr[lo]) <= getT(arr[hi]) - t) ? lo : hi;
}
function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN;
}

// Build the scored-window series (speed/lat/lon/reliability) via the SAME pipeline
// run-scorer.js uses (loadPass + buildMotionTrack + windowReliability) — no reimplemented
// scoring. Each entry's `t` is seconds-from-WAV-start (matching computeSpectralChaos's `t`
// frame of reference) so it can be nearest-joined against the subbass/low/mid/high series.
function buildScoredWindows(sidecar, sc, params) {
  const wavPath = path.join(path.dirname(sc), sidecar.audio.wav_filename);
  const loaded = loadPass(wavPath, sc);
  const sp1 = loaded.windows;
  const sp2 = buildMotionTrack(sidecar.gps_samples, sp1.map((w) => ({ window_id: w.window_id, started_at_ms: w.started_at_ms })), params);
  const sp2By = new Map(sp2.map((r) => [r.window_id, r]));
  return sp1.map((w) => {
    const rec = sp2By.get(w.window_id);
    if (!rec) throw new Error("squelch-extract: window_id " + w.window_id + " missing in SP2 track");
    const { reliability } = windowReliability(w, rec, params);
    const t = (w.started_at_ms - sidecar.audio_first_frame_ms) / 1000 + WINDOW_DURATION_S / 2;
    return { t, speed: rec.speed_mps, lat: rec.lat, lon: rec.lon, low: w.low_energy, mid: w.mid_energy, high: w.high_energy, reliability };
  });
}

// Baseline samples: one per scored (SP1) window, attaching that window's nearest-in-time
// subbass energy from the spectral-chaos series. low/mid/high come straight from the SP1
// window (they're already at that window's native granularity — no join needed).
// CRITICAL: skip any window whose nearest subbass point is missing so fitBaseline never sees
// an undefined `subbass` (weightedQuantile is weight-based, not value-based, so an undefined
// value silently poisons the floor to NaN instead of throwing).
function buildBaselineSamples(scoredWindows, subbass) {
  const out = [];
  for (const w of scoredWindows) {
    const i = nearestIndex(subbass, w.t, (p) => p.t);
    if (i < 0) continue;
    const sb = subbass[i].energy;
    if (typeof sb !== "number" || !isFinite(sb)) continue;
    out.push({ speed: w.speed, subbass: sb, low: w.low, mid: w.mid, high: w.high, reliability: w.reliability });
  }
  return out;
}

function attackSlope(subbass, event) {
  const pts = subbass.slice(event.i_start, event.i_end + 1);
  if (pts.length < 2) return null; // not computable -> tag skipped
  let pk = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].chaos > pts[pk].chaos) pk = i;
  if (pk === 0) return null; // peak is the first point: no leading edge inside the event to measure
  const dt = pts[pk].t - pts[0].t;
  if (dt <= 0) return null;
  const slope = (pts[pk].chaos - pts[0].chaos) / dt; // chaos-units/sec
  // Normalise: the fastest possible rise is a full [0,1] chaos swing in one hop (0.25s) -> 4/s.
  const norm = slope / (1 / subbassHopSec(subbass));
  return norm < 0 ? 0 : norm > 1 ? 1 : norm;
}
function subbassHopSec(subbass) { return subbass.length > 1 ? subbass[1].t - subbass[0].t : 0.25; }

// ctx.valueFor: per-tag math (Task 7 comment / registry "detection.measure"). All four
// starter tags key off the sub-bass band, so this never needs the low/mid/high series for
// anything except the sub-bass-ratio denominator.
function makeValueFor(sq, baseline, eventCtx) {
  return function valueFor(name, event) {
    const c = eventCtx(event);
    const pts = sq.subbass.slice(event.i_start, event.i_end + 1);
    if (name === "tonality") return median(pts.map((p) => p.tonality));
    if (name === "level") {
      const dDb = median(pts.map((p) => p.level_db)) - floorAt(baseline, "subbass", c.speed);
      const v = dDb / LEVEL_NORM_DB;
      return v < 0 ? 0 : v > 1 ? 1 : v;
    }
    if (name === "sub-bass-ratio") {
      const ratios = pts.map((p) => {
        const j = nearestIndex(sq.low, p.t, (x) => x.t), k = nearestIndex(sq.mid, p.t, (x) => x.t), m = nearestIndex(sq.high, p.t, (x) => x.t);
        const lo = j >= 0 ? sq.low[j].energy : 0, mi = k >= 0 ? sq.mid[k].energy : 0, hi = m >= 0 ? sq.high[m].energy : 0;
        const total = p.energy + lo + mi + hi;
        return total > 0 ? p.energy / total : 0;
      });
      return median(ratios);
    }
    if (name === "onset-sharpness") return attackSlope(sq.subbass, event);
    return null;
  };
}

function main() {
  const sc = process.argv[2], outDir = process.argv[3];
  if (!sc || !outDir) { console.error("usage: node scripts/squelch-extract.js <sidecar.json> <outDir>"); process.exit(1); }

  const sidecar = JSON.parse(fs.readFileSync(sc, "utf8"));
  const dec = decodeWav(fs.readFileSync(path.join(path.dirname(sc), sidecar.audio.wav_filename)));
  const sq = computeSpectralChaos(dec.samples, dec.sampleRate);

  const scoredWindows = buildScoredWindows(sidecar, sc, {});
  const baselineSamples = buildBaselineSamples(scoredWindows, sq.subbass);
  const baseline = fitBaseline(baselineSamples, {});
  const floorCheck = floorAt(baseline, "subbass", baselineSamples[0].speed);
  if (!isFinite(floorCheck)) throw new Error("squelch-extract: subbass baseline floor is not finite — check baselineSamples for missing subbass energies");

  const events = detectEvents(sq.subbass);
  const registry = loadRegistry(path.join(__dirname, "..", "harness", "tags", "registry"));

  // No speech-flag is available in this pipeline (the 90b33a2 checkpoint has none, and the
  // only speech detector in the codebase — score-research.js's isTalking — is a research-tool
  // inline that isn't exposed as a reusable module). Not fabricated. All four starter tags
  // (tonality/level/sub-bass-ratio/onset-sharpness) key off the sub-bass band, which the
  // registry's own notes say speech contamination does not affect the way mid/high would, so
  // reliabilityFor is just the mapped window's reliability with no speech multiplier.
  const eventCtx = (event) => {
    const tMid = (event.t_start + event.t_end) / 2;
    const i = nearestIndex(scoredWindows, tMid, (w) => w.t);
    return scoredWindows[i];
  };
  const ctx = {
    registry,
    valueFor: makeValueFor(sq, baseline, eventCtx),
    reliabilityFor: (name, event) => eventCtx(event).reliability
  };

  const tagEvents = events.map((event) => {
    const w = eventCtx(event);
    const { tags, accel_gaps } = extractTags(event, ctx);
    return {
      t_start: event.t_start, t_end: event.t_end,
      lat: w.lat != null ? +w.lat.toFixed(6) : null,
      lon: w.lon != null ? +w.lon.toFixed(6) : null,
      speed_mps: w.speed,
      tags, accel_gaps
    };
  });

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "squelch-clean.json"), JSON.stringify(sq));
  fs.writeFileSync(path.join(outDir, "tags-clean.json"), JSON.stringify({ events: tagEvents }));

  console.log(path.basename(sc), "->", outDir,
    "| subbass", sq.subbass.length, "low", sq.low.length, "mid", sq.mid.length, "high", sq.high.length, "pts",
    "| events", tagEvents.length, "| subbass floor@sample0 speed:", floorCheck.toFixed(3));
}

main();
