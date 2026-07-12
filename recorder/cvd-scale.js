"use strict";

// Cividis-style control points (perceptually uniform, colorblind-safe),
// dark blue (smooth/low) -> muted yellow (rough/high).
const CONTROL_STOPS = Object.freeze([
  "#00224e",
  "#35456c",
  "#666970",
  "#948e6a",
  "#cabb56",
  "#ffea46"
]);

// Mid gray deliberately off the cividis ramp, so an invalid/unknown score is
// visually distinct from any real score (and never reads as "smoothest").
const NEUTRAL_COLOR = "#9e9e9e";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return "#" + rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, "0")).join("");
}

function colorForScore(score) {
  if (score === null || score === undefined) {
    return NEUTRAL_COLOR;
  }
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) {
    return NEUTRAL_COLOR;
  }
  const clamped = clamp(numeric, 0, 100);
  const segments = CONTROL_STOPS.length - 1;
  const position = (clamped / 100) * segments;
  const lowerIndex = Math.min(Math.floor(position), segments - 1);
  const fraction = position - lowerIndex;
  const lower = hexToRgb(CONTROL_STOPS[lowerIndex]);
  const upper = hexToRgb(CONTROL_STOPS[lowerIndex + 1]);
  return rgbToHex(lower.map((c, i) => c + (upper[i] - c) * fraction));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { colorForScore, CONTROL_STOPS, NEUTRAL_COLOR };
}
if (typeof window !== "undefined") {
  window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, { colorForScore, CONTROL_STOPS, NEUTRAL_COLOR });
}
