// harness/score/baseline.js
"use strict";
const { weightedQuantile } = require("./metrics");

const DEFAULTS = { SPEED_BIN_MPS: 2.0, FLOOR_Q: 0.10, MIN_BIN_SAMPLES: 20, EPS_FLOOR: 1e-6 };
const BANDS = ["low", "mid", "high"];

function fitBand(reliable, band, p) {
  // global null-model floor
  const global = Math.max(p.EPS_FLOOR, weightedQuantile(reliable.map((s) => s[band]), reliable.map((s) => s.reliability), p.FLOOR_Q));

  // bucket by speed, then greedily accumulate buckets (in speed order) into qualifying bins
  const byBin = new Map();
  for (const s of reliable) {
    const k = Math.floor(s.speed / p.SPEED_BIN_MPS);
    if (!byBin.has(k)) byBin.set(k, []);
    byBin.get(k).push(s);
  }
  const keys = Array.from(byBin.keys()).sort((a, b) => a - b);
  const points = [];
  let buf = [];
  const flush = () => {
    const wsum = buf.reduce((s, x) => s + x.reliability, 0);
    const repSpeed = wsum > 0 ? buf.reduce((s, x) => s + x.reliability * x.speed, 0) / wsum : buf[0].speed;
    const floor = Math.max(p.EPS_FLOOR, weightedQuantile(buf.map((x) => x[band]), buf.map((x) => x.reliability), p.FLOOR_Q));
    points.push({ speed: repSpeed, floor });
    buf = [];
  };
  for (const k of keys) {
    buf = buf.concat(byBin.get(k));
    if (buf.length >= p.MIN_BIN_SAMPLES) flush();
  }
  // sub-min speed tail is dropped; global floor covers those speeds
  return { points: points.sort((a, b) => a.speed - b.speed), global, meta: { qualified_bins: points.length, fell_back_to_global: points.length === 0, n_samples: reliable.length } };
}

function fitBaseline(samples, params) {
  const p = Object.assign({}, DEFAULTS, params || {});
  const reliable = samples.filter((s) => s.reliability > 0);
  const out = {};
  for (const band of BANDS) {
    if (!reliable.length) throw new Error("baseline: no reliable samples for band " + band);
    out[band] = fitBand(reliable, band, p);
  }
  return out;
}

function floorAt(baseline, band, speed) {
  const pts = baseline[band].points;
  if (pts.length === 0) return baseline[band].global;
  if (pts.length === 1) return pts[0].floor;
  if (speed <= pts[0].speed) return pts[0].floor;
  if (speed >= pts[pts.length - 1].speed) return pts[pts.length - 1].floor;
  for (let i = 0; i < pts.length - 1; i++) {
    if (speed >= pts[i].speed && speed < pts[i + 1].speed) {
      const frac = (speed - pts[i].speed) / (pts[i + 1].speed - pts[i].speed);
      return pts[i].floor + frac * (pts[i + 1].floor - pts[i].floor);
    }
  }
}

function globalFloorAt(baseline, band) { return baseline[band].global; }
function baselineMeta(baseline) { return { low: baseline.low.meta, mid: baseline.mid.meta, high: baseline.high.meta }; }

module.exports = { fitBaseline, floorAt, globalFloorAt, baselineMeta };
