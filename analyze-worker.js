// analyze-worker.js — runs the FULL on-device scoring pipeline off the main thread so a long
// capture doesn't freeze the page. Loads the SAME pipeline modules the Node scorer uses (they
// self-export to self.SensoryNavCore / self.SensoryNavScore in a worker context — no `require`,
// no `window`, only `self`). Order matters: every module below is loaded strictly after its
// dependencies (recorder/* core primitives first, then audio/motion leaves, then the SP3 score
// derivations that compose them last).
"use strict";
importScripts(
  // recorder core: CONSTANTS + band-energy/roughness primitives, attached to self.SensoryNavCore.
  "recorder/constants.js",
  "recorder/audio-scoring.js",
  // SP1 audio front-end (wav decode -> FFT -> per-window band energies).
  "harness/audio/wav-decoder.js",
  "harness/audio/fft.js",
  "harness/audio/audio-windows.js",
  // SP2 motion track (GPS fixes -> Kalman-smoothed speed/heading per window).
  "harness/motion/linalg.js",
  "harness/motion/geo-project.js",
  "harness/motion/kalman-smoother.js",
  "harness/motion/motion-track.js",
  // SP3 score primitives (stats, baseline fit, reliability, dB roughness, batch validation, chaos DSP).
  "harness/score/metrics.js",
  "harness/score/baseline.js",
  "harness/score/reliability.js",
  "harness/score/roughness-db.js",
  "harness/score/validate.js",
  "harness/score/spectral-chaos.js",
  // Tag registry schema + event/tag extraction.
  "harness/tags/schema.js",
  "harness/tags/events.js",
  "harness/tags/extract.js",
  // Composition layer: shared front-end, speech detector, research scorer, squelch derivation.
  "harness/score/score-frontend.js",
  "harness/score/speech-detect.js",
  "harness/score/research-scorer.js",
  "harness/score/squelch-derive.js"
);

self.onmessage = function (e) {
  try {
    const S = self.SensoryNavScore;
    const { wav, sidecar, registry } = e.data; // wav: transferred ArrayBuffer; registry: pre-parsed object
    const front = S.buildFrontEnd({
      wavBytes: new Uint8Array(wav),
      audioFirstFrameMs: sidecar.audio_first_frame_ms,
      gpsSamples: sidecar.gps_samples
    });
    const speech = S.detectSpeech(front.frames, front.sr);
    const { scored, hires } = S.scoreResearch(Object.assign({}, front, { speech }), {});
    const { squelch, tags } = S.deriveSquelch(front, front.samples, front.sr, { registry });
    self.postMessage({ ok: true, scored, hires, squelch, tags });
  } catch (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};
