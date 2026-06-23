"use strict";

// Cividis-style control points (perceptually uniform, colorblind-safe),
// dark blue (smooth/low) -> muted yellow (rough/high).
const CONTROL_STOPS = [
  "#00224e",
  "#35456c",
  "#666970",
  "#948e6a",
  "#cabb56",
  "#ffea46"
];

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
  const clamped = clamp(Number(score) || 0, 0, 100);
  const segments = CONTROL_STOPS.length - 1;
  const position = (clamped / 100) * segments;
  const lowerIndex = Math.min(Math.floor(position), segments - 1);
  const fraction = position - lowerIndex;
  const lower = hexToRgb(CONTROL_STOPS[lowerIndex]);
  const upper = hexToRgb(CONTROL_STOPS[lowerIndex + 1]);
  return rgbToHex(lower.map((c, i) => c + (upper[i] - c) * fraction));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { colorForScore, CONTROL_STOPS };
}
if (typeof window !== "undefined") {
  window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, { colorForScore, CONTROL_STOPS });
}
