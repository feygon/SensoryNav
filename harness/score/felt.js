// harness/score/felt.js
"use strict";
const { CONSTANTS } = require("../../recorder/constants");
const WINDOW_DURATION_MS = CONSTANTS.WINDOW_DURATION_MS;

function loadFelt(obj) {
  if (!obj || obj.schema !== "sensorynav-felt-v1") throw new Error("felt: schema must be sensorynav-felt-v1");
  if (!Array.isArray(obj.spans)) throw new Error("felt: spans must be an array");
  if (!Array.isArray(obj.events)) throw new Error("felt: events must be an array");
  for (const s of obj.spans) {
    if (!Number.isFinite(s.start_ms) || !Number.isFinite(s.end_ms)) throw new Error("felt: span needs finite start_ms/end_ms");
    if (s.end_ms <= s.start_ms) throw new Error("felt: span end_ms must exceed start_ms");
    if (!Number.isFinite(s.magnitude)) throw new Error("felt: span magnitude must be finite");
  }
  for (const e of obj.events) {
    if (!Number.isFinite(e.at_ms)) throw new Error("felt: event needs finite at_ms");
    if (!Number.isFinite(e.magnitude)) throw new Error("felt: event magnitude must be finite");
  }
  return { spans: obj.spans, events: obj.events };
}

function mapFeltToWindows(felt, windows) {
  return windows.map((w) => {
    const start = w.started_at_ms;
    const end = w.started_at_ms + (w.duration_ms || WINDOW_DURATION_MS);
    let present = false, mag = null;
    for (const s of felt.spans) {
      if (s.start_ms < end && s.end_ms > start) { present = true; mag = mag === null ? s.magnitude : Math.max(mag, s.magnitude); }
    }
    for (const e of felt.events) {
      if (e.at_ms >= start && e.at_ms < end) { present = true; mag = mag === null ? e.magnitude : Math.max(mag, e.magnitude); }
    }
    return { felt_present: present, felt_magnitude: present ? mag : null };
  });
}

module.exports = { loadFelt, mapFeltToWindows };
