// harness/score/speech-detect.js
// Talking/speech detector, extracted verbatim from scripts/score-research.js so the on-device
// worker and the (thin) research scorer share ONE detector. Feeds BOTH the baseline
// talking-exclusion (windows where isTalking(i) is true are dropped from the speed-conditioned
// baseline fit) and the pink speech ribbon (speechRanges -> highres-clean.json's `speech`).
// @unit-begin
// unit:        speech-detect
// causality:   causal
// state:       none
// mutates:     none
// contract:    detectSpeech(frames,sr) -> {speechCount,isTalking(i)->bool,speechRanges}
// deps:        score/roughness-db
// realtime:    reuse-as-is
// tested-by:   tests/speech-detect.test.js
// @unit-end
"use strict";
var { toDb } = (typeof require !== "undefined") ? require("./roughness-db") : self.SensoryNavScore;

// Talking signature (tuned on the seat run): mid+high co-elevated for >= SPEECH_FRAMES frames/sec.
const HI = -40, MID = -35, SPEECH_FRAMES = 3;

// detectSpeech(frames, sr) -> { speechCount, isTalking(i), speechRanges }
// `frames` are STFT frames ({ centerSample, energies: { low, mid, high } }); `sr` is the sample
// rate used to bucket frames into 1-second windows (same bucketing as SP1's window_id).
function detectSpeech(frames, sr) {
  const dB = toDb; // shared power->dB (same 1e-12 floor); used for the speech-flag test
  const speechCount = {};
  for (const f of frames) {
    const w = Math.floor(f.centerSample / sr);
    if (!speechCount[w]) speechCount[w] = 0;
    if (dB(f.energies.high) > HI && dB(f.energies.mid) > MID) speechCount[w]++;
  }
  const isTalking = (i) => (speechCount[i] || 0) >= SPEECH_FRAMES;

  const flagged = Object.keys(speechCount).map(Number).filter(isTalking).sort((a, b) => a - b);
  const speechRanges = [];
  for (const w of flagged) {
    if (speechRanges.length && w === speechRanges[speechRanges.length - 1][1]) speechRanges[speechRanges.length - 1][1] = w + 1;
    else speechRanges.push([w, w + 1]);
  }

  return { speechCount, isTalking, speechRanges };
}

// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { detectSpeech, HI, MID, SPEECH_FRAMES };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
