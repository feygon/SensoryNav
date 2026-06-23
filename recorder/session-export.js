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

function buildSession(input) {
  return {
    session_id: input.session_id,
    created_at_ms: input.created_at_ms,
    created_at: new Date(input.created_at_ms).toISOString(),
    calibration_status: input.calibration_status,
    score_formula_version: SCORE_FORMULA_VERSION,
    user_agent: input.user_agent || null,
    baseline: input.baseline,
    audio_windows: input.audio_windows || [],
    gps_samples: input.gps_samples || [],
    located_samples: input.located_samples || []
  };
}

function validateSession(session) {
  const errors = [];
  for (const key of REQUIRED_KEYS) {
    if (session[key] === undefined || session[key] === null) {
      errors.push(`missing required field: ${key}`);
    }
  }
  if (session.score_formula_version && session.score_formula_version !== SCORE_FORMULA_VERSION) {
    errors.push(`unexpected score_formula_version: ${session.score_formula_version}`);
  }
  for (const arrayKey of ["audio_windows", "gps_samples", "located_samples"]) {
    if (session[arrayKey] !== undefined && !Array.isArray(session[arrayKey])) {
      errors.push(`${arrayKey} must be an array`);
    }
  }
  if (JSON.stringify(session).includes("raw_audio")) {
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
