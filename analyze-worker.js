// analyze-worker.js — runs the spectral-chaos analysis off the main thread so a long
// capture doesn't freeze the page. Loads the SAME pipeline modules the Node scorer uses
// (they self-export to self.SensoryNavScore in a worker context).
"use strict";
importScripts("harness/audio/wav-decoder.js", "harness/score/spectral-chaos.js");

self.onmessage = function (e) {
  try {
    const S = self.SensoryNavScore;
    const dec = S.decodeWav(new Uint8Array(e.data.wav)); // { samples, sampleRate, sampleCount }
    const squelch = S.computeSpectralChaos(dec.samples, dec.sampleRate);
    self.postMessage({ ok: true, sampleRate: dec.sampleRate, durationSec: dec.sampleCount / dec.sampleRate, squelch: squelch });
  } catch (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};
