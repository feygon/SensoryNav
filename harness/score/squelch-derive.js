// harness/score/squelch-derive.js
// Pure, worker-callable squelch derivation: runs the spectral-chaos DSP (subbass/low/mid/
// high tonality-chaos ribbons), joins it against the SP1+SP2 scored-window series (speed/
// lat/lon/reliability) already computed by buildFrontEnd (Task 6) to fit a speed-conditioned
// baseline, detects sub-bass chaos events, and extracts starter tags per event. Produces the
// exact `squelch`/`tags` objects that scripts/squelch-extract.js writes to squelch-clean.json /
// tags-clean.json. Extracted verbatim from scripts/squelch-extract.js (Task 9) so the
// derivation is reusable from a Worker; the script itself is now a thin I/O wrapper around
// deriveSquelch(). Task C4 carved the chaos<->scored-window alignment into the pure joinWindows()
// core, and de-closured the two tag-value fusions (makeValueFor/makeReliabilityFor) into pure
// valueFor(name,event,ctx)/reliabilityFor(name,event,ctx), so both are reusable from a future
// realtime path and testable in isolation with a synthetic ctx.
// @unit-begin
// unit:        squelch-derive
// causality:   compose
// state:       none
// mutates:     none
// contract:    deriveSquelch(front,samples,sr,opts{registry}) -> {squelch,tags{events[]}}
//              joinWindows(chaosSeries,scoredWindows,floors) -> rows[{t,chaos,tonality,level_db,floor_db,speed,reliability,low_conf}] — pure
//              valueFor(name,event,ctx{bands,bandN,floorAt,window}) -> number|null — pure
//              reliabilityFor(name,event,ctx{bands,bandN,floorAt,window}) -> number — pure
// deps:        score/spectral-chaos, score/baseline, score/reliability, tags/events, tags/extract
// realtime:    needs-streaming-variant
// tested-by:   tests/squelch-derive.test.js, tests/join-windows.test.js, tests/tag-value.test.js
// @unit-end
"use strict";
var D = (typeof require !== "undefined") ? {
  computeSpectralChaos: require("./spectral-chaos").computeSpectralChaos,
  fitBaseline: require("./baseline").fitBaseline,
  floorAt: require("./baseline").floorAt,
  windowReliability: require("./reliability").windowReliability,
  detectEvents: require("../tags/events").detectEvents,
  extractTags: require("../tags/extract").extractTags
} : self.SensoryNavScore;

const LEVEL_NORM_DB = 20;
const WINDOW_DURATION_S = 1.0; // SP1 windows are 1s (recorder/constants.js WINDOW_DURATION_MS)

// Nearest-in-time lookup into a series sorted ascending by a time field (binary search).
// Used for every cross-series join in this module: subbass series is 0.25s-hop and does NOT
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

// joinWindows: pure chaos<->scored-window alignment. Nearest-in-time-joins the fine-grained
// (0.25s hop) chaosSeries (e.g. sq.subbass: t/chaos/tonality/level_db/low_conf) against the
// coarser (1s hop) scoredWindows series (t/speed/reliability), attaching a pre-computed
// per-scoredWindow floor (`floors[i]`, aligned 1:1 with scoredWindows — callers resolve it via
// D.floorAt against whatever baseline is in scope, so this core stays baseline-agnostic and pure).
// One row per chaosSeries point. This is the join scoredWindows-derivation logic that
// computeSubbassFloor used inline pre-carve; it is now a standalone reusable core (see spec §7).
function joinWindows(chaosSeries, scoredWindows, floors) {
  return chaosSeries.map((p) => {
    const i = nearestIndex(scoredWindows, p.t, (w) => w.t);
    const w = i >= 0 ? scoredWindows[i] : null;
    return {
      t: p.t,
      chaos: p.chaos,
      tonality: p.tonality,
      level_db: p.level_db,
      floor_db: i >= 0 ? floors[i] : null,
      speed: w ? w.speed : null,
      reliability: w ? w.reliability : null,
      low_conf: p.low_conf
    };
  });
}

// Build the scored-window series (speed/lat/lon/reliability) from the SAME SP1/SP2 buildFrontEnd
// already computed — no re-decode, no re-window. Each entry's `t` is seconds-from-WAV-start
// (matching computeSpectralChaos's `t` frame of reference) so it can be nearest-joined against
// the subbass/low/mid/high series. sp1[0].started_at_ms is the WAV-start reference: sp1 windows
// are built as started_at_ms = audioFirstFrameMs + i*1000, so subtracting sp1[0]'s value cancels
// audioFirstFrameMs exactly and leaves i*1000ms, matching squelch-extract.js's original
// `(w.started_at_ms - sidecar.audio_first_frame_ms) / 1000` byte-for-byte.
function buildScoredWindows(front, params) {
  const { sp1, sp2By } = front;
  const t0 = sp1.length ? sp1[0].started_at_ms : 0;
  return sp1.map((w) => {
    const rec = sp2By.get(w.window_id);
    if (!rec) throw new Error("squelch-derive: window_id " + w.window_id + " missing in SP2 track");
    const { reliability } = D.windowReliability(w, rec, params);
    const t = (w.started_at_ms - t0) / 1000 + WINDOW_DURATION_S / 2;
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

// Real, reliability-weighted per-run sub-bass floor (RAW ENERGY, not dB — the `floor_db` field
// name on joinWindows's row is the general contract; this pipeline's floors are raw energy),
// aligned 1:1 with `subbass`, for the timeline to consume directly instead of re-fitting its own
// (the timeline previously derived a second, unweighted baseline locally, which could silently
// diverge from the floor the "level" tag already uses). Built on joinWindows: one floor is fit
// per scoredWindow (not per subbass point — same speed lookup, resolved once and reused via the
// join's nearest-index instead of recomputed per point).
function computeSubbassFloor(subbass, scoredWindows, baseline) {
  const floors = scoredWindows.map((w) => D.floorAt(baseline, "subbass", w.speed));
  return joinWindows(subbass, scoredWindows, floors).map((row) => (isFinite(row.floor_db) ? row.floor_db : null));
}

function subbassHopSec(subbass) { return subbass.length > 1 ? subbass[1].t - subbass[0].t : 0.25; }
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

// valueFor: per-tag math (registry "detection.measure"), pure — de-closured from the pre-carve
// makeValueFor(sq,baseline,eventCtx) closure (Task C4 / spec §7). All four starter tags key off
// the sub-bass band, so this never needs the low/mid/high series for anything except the
// sub-bass-ratio denominator. ctx.bands/ctx.bandN carry the closed-over band series + per-band
// FFT size N (bandN needed to normalize each band's raw `energy` — Sigma|FFT|^2, which scales
// ~N^2 — to comparable POWER before the sub-bass-ratio: subbass uses N=16384 vs high's N=512, a
// (16384/512)^2 ~ 1024x raw-energy inflation that otherwise pins the ratio near 1.0 regardless of
// actual sub-bass dominance); ctx.floorAt/ctx.window carry the closed-over baseline + per-event
// scored-window lookup.
function valueFor(name, event, ctx) {
  const pts = ctx.bands.subbass.slice(event.i_start, event.i_end + 1);
  if (name === "tonality") return median(pts.map((p) => p.tonality));
  if (name === "level") {
    if (!pts.length) return null;
    const floor = ctx.floorAt("subbass", ctx.window.speed);
    if (!isFinite(floor) || floor <= 0) return null;
    const dDb = 10 * Math.log10(median(pts.map((p) => p.energy)) / floor);
    const v = dDb / LEVEL_NORM_DB;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
  if (name === "sub-bass-ratio") {
    if (!pts.length) return null;
    const ratios = pts.map((p) => {
      const j = nearestIndex(ctx.bands.low, p.t, (x) => x.t), k = nearestIndex(ctx.bands.mid, p.t, (x) => x.t), m = nearestIndex(ctx.bands.high, p.t, (x) => x.t);
      const subPower = p.energy / (ctx.bandN.subbass * ctx.bandN.subbass);
      const loPower = j >= 0 ? ctx.bands.low[j].energy / (ctx.bandN.low * ctx.bandN.low) : 0;
      const miPower = k >= 0 ? ctx.bands.mid[k].energy / (ctx.bandN.mid * ctx.bandN.mid) : 0;
      const hiPower = m >= 0 ? ctx.bands.high[m].energy / (ctx.bandN.high * ctx.bandN.high) : 0;
      const total = subPower + loPower + miPower + hiPower;
      return total > 0 ? subPower / total : null;
    }).filter((r) => r != null);
    return ratios.length ? median(ratios) : null;
  }
  if (name === "onset-sharpness") return attackSlope(ctx.bands.subbass, event);
  return null;
}

// windowForEvent: the nearest scored window (speed/lat/lon/reliability) to the event's midpoint.
// No speech-flag is available in this pipeline (the 90b33a2 checkpoint has none, and the only
// speech detector in the codebase — score-research.js's isTalking — is a research-tool inline
// that isn't exposed as a reusable module). Not fabricated. All four starter tags
// (tonality/level/sub-bass-ratio/onset-sharpness) key off the sub-bass band, which the registry's
// own notes say speech contamination does not affect the way mid/high would, so reliabilityFor is
// just the mapped window's reliability with no speech multiplier.
function windowForEvent(scoredWindows, event) {
  const tMid = (event.t_start + event.t_end) / 2;
  const i = nearestIndex(scoredWindows, tMid, (w) => w.t);
  return scoredWindows[i];
}
// reliabilityFor: pure — de-closured from the pre-carve makeReliabilityFor(sq,eventCtx) closure.
// Belt-and-suspenders on the near-silence guard: detectEvents (harness/tags/events.js) already
// refuses to let a low_conf point seed or extend an event, so this should rarely fire in
// practice. It's defensive because a merge can still pull an "off" low_conf point INTO an
// event's [i_start,i_end] span between two on-runs (mergeGapS), so any tag whose value derives
// from a low_conf window gets its confidence forced to 0 rather than silently trusting a
// near-silence reading.
function reliabilityFor(name, event, ctx) {
  const pts = ctx.bands.subbass.slice(event.i_start, event.i_end + 1);
  if (pts.some((p) => p.low_conf)) return 0;
  return ctx.window.reliability;
}

function buildTagEvents(events, sq, baseline, scoredWindows, registry) {
  // Per-pass: the band series + per-band FFT-N + the baseline floor lookup never change across
  // events, so they're built once outside the loop (spec §7: "ctx.bands/bandN/floorAt are
  // per-pass, but ctx.window is per-event — do not build one static ctx for the whole pass").
  const bandN = {};
  for (const b of sq.params.bands) bandN[b.key] = b.N;
  const bands = { subbass: sq.subbass, low: sq.low, mid: sq.mid, high: sq.high };
  const floorAt = (band, speed) => D.floorAt(baseline, band, speed);
  return events.map((event) => {
    const w = windowForEvent(scoredWindows, event);
    const ctx = { bands, bandN, floorAt, window: w };
    // extractTags calls ctx.valueFor(name,event)/ctx.reliabilityFor(name,event) (2-arg contract,
    // harness/tags/extract.js); these thin per-event wrappers close over the per-event fusion
    // `ctx` above just to adapt arity — the fusion math itself lives entirely in the pure,
    // exported valueFor/reliabilityFor(name,event,ctx).
    const tagsCtx = {
      registry,
      valueFor: (name, ev) => valueFor(name, ev, ctx),
      reliabilityFor: (name, ev) => reliabilityFor(name, ev, ctx)
    };
    const { tags, accel_gaps } = D.extractTags(event, tagsCtx);
    return {
      t_start: event.t_start, t_end: event.t_end,
      lat: w.lat != null ? +w.lat.toFixed(6) : null,
      lon: w.lon != null ? +w.lon.toFixed(6) : null,
      speed_mps: w.speed,
      tags, accel_gaps
    };
  });
}

// deriveSquelch(front, samples, sr, opts) -> { squelch, tags }
// front: buildFrontEnd()'s result ({ samples, sr, sp1, frames, sp2, sp2By }) — sp1/sp2 are
// consumed as-is; SP1/SP2 are NOT re-decoded or re-run here.
// samples/sr: passed straight to computeSpectralChaos (normally front.samples/front.sr).
// opts.registry: the already-parsed tag registry object (see harness/tags/schema.js loadRegistry).
function deriveSquelch(front, samples, sr, opts) {
  const o = opts || {};
  const sq = D.computeSpectralChaos(samples, sr);

  const scoredWindows = buildScoredWindows(front, {});
  const baselineSamples = buildBaselineSamples(scoredWindows, sq.subbass);
  if (!baselineSamples.length) throw new Error("squelch-derive: no baseline samples");
  const baseline = D.fitBaseline(baselineSamples, {});
  const floorCheck = D.floorAt(baseline, "subbass", baselineSamples[0].speed);
  if (!isFinite(floorCheck)) throw new Error("squelch-derive: subbass baseline floor is not finite — check baselineSamples for missing subbass energies");

  const events = D.detectEvents(sq.subbass);
  const tagEvents = buildTagEvents(events, sq, baseline, scoredWindows, o.registry);

  sq.subbass_floor = computeSubbassFloor(sq.subbass, scoredWindows, baseline);

  return { squelch: sq, tags: { events: tagEvents } };
}

// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { deriveSquelch, joinWindows, valueFor, reliabilityFor };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
