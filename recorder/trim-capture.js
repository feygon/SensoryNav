// recorder/trim-capture.js
"use strict";

// Optional deidentifying trim applied AT DOWNLOAD: remove the first and/or last N
// seconds of a capture — the audio samples AND the GPS fixes in those windows — so the
// start/end of a trip (often near home) is never written to disk. Audio and GPS share one
// epoch-ms clock: `audioFirstFrameMs` anchors the audio, each fix carries `captured_at_ms`.
// Trimming shifts the audio anchor and filters GPS by the same kept time window, so the two
// stay aligned. Returns null if the requested trim would leave nothing — the caller must then
// warn and NOT save (saving the untrimmed data would leak what the user asked to remove).
function trimCapture(payload, opts) {
  const sr = payload.sampleRate;
  const dropFirstN = Math.round((opts.dropFirstSec || 0) * sr);
  const dropLastN = Math.round((opts.dropLastSec || 0) * sr);
  const total = payload.totalSamples;
  const keepStart = dropFirstN;
  const keepEnd = total - dropLastN;
  if (keepEnd <= keepStart) { return null; } // nothing would remain

  // flatten the audio frames into one buffer, then slice the kept window
  const flat = new Float32Array(total);
  let o = 0;
  for (const f of payload.frames) { if (!f) { continue; } flat.set(f, o); o += f.length; }
  const trimmed = flat.slice(keepStart, keepEnd);

  const removedFirstMs = (dropFirstN / sr) * 1000;
  const newAudioFirstFrameMs = payload.audioFirstFrameMs + removedFirstMs;
  const newRecordingStartMs = payload.recordingStartMs + removedFirstMs;
  const newAudioEndMs = newAudioFirstFrameMs + (trimmed.length / sr) * 1000;

  // keep GPS in the same window as the kept audio: [start inclusive, end exclusive).
  // A side that wasn't trimmed keeps all of its fixes (no bound), so removing only the
  // last 30 s never drops early fixes and vice-versa.
  const lo = dropFirstN > 0 ? newAudioFirstFrameMs : -Infinity;
  const hi = dropLastN > 0 ? newAudioEndMs : Infinity;
  const gpsSamples = (payload.gpsSamples || []).filter((fx) => fx.captured_at_ms >= lo && fx.captured_at_ms < hi);

  return {
    frames: [trimmed],
    totalSamples: trimmed.length,
    sampleRate: sr,
    recordingStartMs: newRecordingStartMs,
    audioFirstFrameMs: newAudioFirstFrameMs,
    gpsSamples: gpsSamples
  };
}

// Block-scope `exported` so multiple recorder modules loaded as classic
// <script> tags in one global scope don't collide (each `const exported`).
{
  const exported = { trimCapture };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof window !== "undefined") { window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported); }
}
