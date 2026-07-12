"use strict";

const SCORE_FORMULA_VERSION = "auditory-roughness-v0";
const REQUIRED_KEYS = [
  "session_id",
  "created_at_ms",
  "calibration_status",
  "score_formula_version",
  "baseline",
  "audio_windows",
  "gps_samples",
  "located_samples"
];

const AUDIO_WINDOW_FIELDS = [
  "window_id", "started_at_ms", "duration_ms",
  "low_energy", "mid_energy", "high_energy",
  "low_delta", "mid_delta", "high_delta",
  "auditory_roughness_score"
];
const GPS_SAMPLE_FIELDS = [
  "sample_id", "captured_at_ms", "latitude", "longitude",
  "accuracy_meters", "speed_mps"
];
const LOCATED_SAMPLE_FIELDS = [
  "window_id", "gps_sample_id", "gps_captured_at_ms", "location_status",
  "latitude", "longitude", "auditory_roughness_score", "color"
];
const BASELINE_FIELDS = [
  "moving_duration_seconds", "low_median", "mid_median", "high_median",
  "energy_floor_min", "effective_floor"
];
const EFFECTIVE_FLOOR_FIELDS = ["low", "mid", "high"];

function pick(source, fields) {
  const result = {};
  for (const field of fields) {
    result[field] = source ? source[field] : undefined;
  }
  return result;
}

function projectAudioWindow(window) {
  return pick(window, AUDIO_WINDOW_FIELDS);
}

function projectGpsSample(sample) {
  return pick(sample, GPS_SAMPLE_FIELDS);
}

function projectLocatedSample(sample) {
  return pick(sample, LOCATED_SAMPLE_FIELDS);
}

function projectBaseline(baseline) {
  if (baseline === null || baseline === undefined) {
    return null;
  }
  const projected = pick(baseline, BASELINE_FIELDS);
  projected.effective_floor = pick(baseline.effective_floor, EFFECTIVE_FLOOR_FIELDS);
  return projected;
}

function buildSession(input) {
  return {
    session_id: input.session_id,
    created_at_ms: input.created_at_ms,
    created_at: new Date(input.created_at_ms).toISOString(),
    calibration_status: input.calibration_status,
    score_formula_version: SCORE_FORMULA_VERSION,
    user_agent: input.user_agent || null,
    baseline: projectBaseline(input.baseline),
    audio_windows: (input.audio_windows || []).map(projectAudioWindow),
    gps_samples: (input.gps_samples || []).map(projectGpsSample),
    located_samples: (input.located_samples || []).map(projectLocatedSample)
  };
}

function hasRawAudioKey(value, seen) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  seen = seen || new Set();
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => hasRawAudioKey(item, seen));
  }
  for (const key of Object.keys(value)) {
    if (key === "raw_audio") {
      return true;
    }
    if (hasRawAudioKey(value[key], seen)) {
      return true;
    }
  }
  return false;
}

function validateSession(session) {
  const errors = [];
  for (const key of REQUIRED_KEYS) {
    if (session[key] === undefined || session[key] === null) {
      errors.push(`missing required field: ${key}`);
    }
  }
  if (
    session.score_formula_version !== undefined &&
    session.score_formula_version !== null &&
    session.score_formula_version !== SCORE_FORMULA_VERSION
  ) {
    errors.push(`unexpected score_formula_version: ${session.score_formula_version}`);
  }
  for (const arrayKey of ["audio_windows", "gps_samples", "located_samples"]) {
    if (session[arrayKey] !== undefined && !Array.isArray(session[arrayKey])) {
      errors.push(`${arrayKey} must be an array`);
    }
  }
  if (hasRawAudioKey(session)) {
    errors.push("raw_audio must never be present in an export");
  }
  if (!["complete", "incomplete"].includes(session.calibration_status)) {
    errors.push(`invalid calibration_status: ${session.calibration_status}`);
  }
  return { valid: errors.length === 0, errors };
}

const exported = { buildSession, validateSession, SCORE_FORMULA_VERSION };

if (typeof module !== "undefined" && module.exports) {
  module.exports = exported;
}
if (typeof window !== "undefined") {
  window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported);
}
