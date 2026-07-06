// scripts/squelch-extract.js
// Per-pass aperiodic-chaos extractor. Writes squelch-clean.json (low/mid/high ribbon series)
// for the timeline ribbon and the cross-pass squelch aggregation. Offline, uses the raw WAV.
// Usage: node scripts/squelch-extract.js <sidecar.json> <outDir>
"use strict";
const fs = require("fs");
const path = require("path");
const { decodeWav } = require("../harness/audio/wav-decoder");
const { computeSpectralChaos } = require("./lib/squelch");

const sc = process.argv[2], outDir = process.argv[3];
if (!sc || !outDir) { console.error("usage: node scripts/squelch-extract.js <sidecar.json> <outDir>"); process.exit(1); }

const sidecar = JSON.parse(fs.readFileSync(sc, "utf8"));
const dec = decodeWav(fs.readFileSync(path.join(path.dirname(sc), sidecar.audio.wav_filename)));
const sq = computeSpectralChaos(dec.samples, dec.sampleRate);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "squelch-clean.json"), JSON.stringify(sq));
console.log(path.basename(sc), "->", outDir, "| low", sq.low.length, "mid", sq.mid.length, "high", sq.high.length, "pts");
