// recorder/gps-track.js
"use strict";

function normalizeFix(position, sampleId) {
  const c = position.coords;
  return {
    sample_id: sampleId,
    captured_at_ms: position.timestamp,
    latitude: c.latitude,
    longitude: c.longitude,
    speed_mps: (c.speed === null || c.speed === undefined) ? null : c.speed,
    accuracy_meters: c.accuracy
  };
}

function observedFixHz(samples) {
  if (samples.length < 2) {
    return null;
  }
  const first = samples[0].captured_at_ms;
  const last = samples[samples.length - 1].captured_at_ms;
  const seconds = (last - first) / 1000;
  if (seconds <= 0) {
    return null;
  }
  return (samples.length - 1) / seconds;
}

const exported = { normalizeFix, observedFixHz };
if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
if (typeof window !== "undefined") { window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported); }
