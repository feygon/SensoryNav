// scripts/squelch-extract.js
// Per-pass extractor: decodes the raw WAV, runs the NEW spectral-chaos DSP (subbass/low/
// mid/high tonality-chaos ribbons), joins it against the existing scored-window pipeline
// (speed/lat/lon/reliability from SP1+SP2) to fit a speed-conditioned baseline, detects
// sub-bass chaos events, and extracts starter tags per event. Writes squelch-clean.json
// (the ribbon series, for the timeline + cross-pass squelch aggregation) and tags-clean.json
// (event list with per-tag {value,confidence}, for the tag-discrimination research loop).
// This is a thin I/O wrapper: the derivation lives in harness/score/squelch-derive.js
// (pure, worker-callable) so it can be reused by the on-device Worker.
// Usage: node scripts/squelch-extract.js <sidecar.json> <outDir>
"use strict";
const fs = require("fs");
const path = require("path");
const { buildFrontEnd } = require("../harness/score/score-frontend");
const { deriveSquelch } = require("../harness/score/squelch-derive");
const { loadRegistry } = require("../harness/tags/schema");

function main() {
  const sc = process.argv[2], outDir = process.argv[3];
  if (!sc || !outDir) { console.error("usage: node scripts/squelch-extract.js <sidecar.json> <outDir>"); process.exit(1); }

  const sidecar = JSON.parse(fs.readFileSync(sc, "utf8"));
  const wavBytes = fs.readFileSync(path.join(path.dirname(sc), sidecar.audio.wav_filename));
  const front = buildFrontEnd({ wavBytes, audioFirstFrameMs: sidecar.audio_first_frame_ms, gpsSamples: sidecar.gps_samples });
  const registry = loadRegistry(path.join(__dirname, "..", "harness", "tags", "registry"));

  const { squelch: sq, tags: tagsOut } = deriveSquelch(front, front.samples, front.sr, { registry });

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "squelch-clean.json"), JSON.stringify(sq));
  fs.writeFileSync(path.join(outDir, "tags-clean.json"), JSON.stringify(tagsOut));

  const floorCheck = sq.subbass_floor.find((f) => f != null);
  console.log(path.basename(sc), "->", outDir,
    "| subbass", sq.subbass.length, "low", sq.low.length, "mid", sq.mid.length, "high", sq.high.length, "pts",
    "| events", tagsOut.events.length, "| subbass floor@sample0 speed:", (floorCheck != null ? floorCheck.toFixed(3) : "n/a"));
}

main();
