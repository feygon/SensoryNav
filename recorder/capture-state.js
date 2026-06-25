// recorder/capture-state.js
"use strict";

const TRANSITIONS = {
  idle: { start: "requesting_permissions" },
  requesting_permissions: { granted: "recording", denied: "error" },
  recording: { foreground_lost: "recording", stream_lost: "error", stop: "stopped" },
  stopped: { reset: "idle" },
  error: { reset: "idle" }
};

function nextState(current, event) {
  const row = TRANSITIONS[current];
  if (!row || !Object.prototype.hasOwnProperty.call(row, event)) {
    return null;
  }
  return row[event];
}

const exported = { nextState };
if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
if (typeof window !== "undefined") { window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported); }
