// analyze-worker.js — runs the FULL on-device scoring pipeline off the main thread so a long
// capture doesn't freeze the page. It loads the SAME pipeline modules the Node scorer uses.
//
// Why not `importScripts`: importScripts runs every script in the worker's ONE shared global
// scope, but these ~20 modules are independent (Node-style) files that each declare their own
// top-level helpers (`median`, `BANDS`, `DEFAULTS`, `CONSTANTS`, …). Concatenated into one scope
// they collide (`const` redeclaration SyntaxError; worse, two same-named `function`s silently
// shadow each other). Instead we fetch each module's source and run it in its OWN function scope
// via `new Function`, so top-level declarations stay module-local. Each module still publishes its
// API onto `self.SensoryNavCore` / `self.SensoryNavScore` (self is the shared worker global), which
// later modules read through their `(typeof require) ? require(...) : self.SensoryNav*` guards.
// (The eval'd code is our own first-party source served from our origin — not third-party. If a
// strict `unsafe-eval`-blocking CSP is ever added, switch to ES-module worker imports.)
"use strict";

// Dependency order: a module appears AFTER every module it reads from self.
var MODULES = [
  "recorder/constants.js",
  "recorder/audio-scoring.js",
  "harness/audio/wav-decoder.js",
  "harness/audio/fft.js",
  "harness/audio/audio-windows.js",
  "harness/motion/linalg.js",
  "harness/motion/geo-project.js",
  "harness/motion/kalman-smoother.js",
  "harness/motion/motion-track.js",
  "harness/score/metrics.js",
  "harness/score/baseline.js",
  "harness/score/reliability.js",
  "harness/score/roughness-db.js",
  "harness/score/validate.js",
  "harness/score/spectral-chaos.js",
  "harness/tags/schema.js",
  "harness/tags/events.js",
  "harness/tags/extract.js",
  "harness/score/score-frontend.js",
  "harness/score/speech-detect.js",
  "harness/score/research-scorer.js",
  "harness/score/squelch-derive.js"
];

// Fetch all sources (parallel; Promise.all preserves array order), then execute each in its own
// function scope IN ORDER so dependencies publish onto self before dependents run.
var ready = Promise.all(MODULES.map(function (u) {
  return fetch(u).then(function (r) {
    if (!r.ok) throw new Error(u + " -> HTTP " + r.status);
    return r.text();
  }).then(function (src) { return { u: u, src: src }; });
})).then(function (mods) {
  mods.forEach(function (m) {
    try {
      // new Function(body): the module's top-level const/let/function are LOCAL to this call, so
      // nothing leaks into the worker global scope; `self` inside resolves to the worker global.
      (new Function(m.src))();
    } catch (e) {
      throw new Error("loading " + m.u + ": " + (e && e.message ? e.message : String(e)));
    }
  });
});

self.onmessage = function (e) {
  ready.then(function () {
    var S = self.SensoryNavScore;
    var d = e.data; // { wav: transferred ArrayBuffer, sidecar: object, registry: pre-parsed object }
    var front = S.buildFrontEnd({
      wavBytes: new Uint8Array(d.wav),
      audioFirstFrameMs: d.sidecar.audio_first_frame_ms,
      gpsSamples: d.sidecar.gps_samples
    });
    var speech = S.detectSpeech(front.frames, front.sr);
    var research = S.scoreResearch(Object.assign({}, front, { speech: speech }), {});
    var sq = S.deriveSquelch(front, front.samples, front.sr, { registry: d.registry });
    self.postMessage({ ok: true, scored: research.scored, hires: research.hires, squelch: sq.squelch, tags: sq.tags });
  }).catch(function (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  });
};
