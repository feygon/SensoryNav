"use strict";

const CONSTANTS = Object.freeze({
  FFT_SIZE: 2048,
  SMOOTHING_TIME_CONSTANT: 0,
  ASSUMED_SAMPLE_RATE_HZ: 48000,
  WINDOW_DURATION_MS: 1000,
  ENERGY_FLOOR_MIN: 1e-6,
  PAIR_MAX_SKEW_SECONDS: 5,
  WEIGHTS: Object.freeze({ low: 0.45, mid: 0.4, high: 0.15 }),
  SCORE_SCALE: 50,
  BANDS: Object.freeze({
    low: Object.freeze([80, 250]),
    mid: Object.freeze([250, 1000]),
    high: Object.freeze([1000, 4000])
  })
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CONSTANTS };
}
if (typeof window !== "undefined") {
  window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, { CONSTANTS });
}
