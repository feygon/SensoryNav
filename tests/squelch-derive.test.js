// tests/squelch-derive.test.js
// Byte-identity gate for the Task 9 extraction: deriveSquelch(front, samples, sr, opts) must
// reproduce the exact squelch-clean.json / tags-clean.json that scripts/squelch-extract.js
// produced BEFORE the extraction (snapshotted under .superpowers/sdd/task9-ref/ — not the live
// out/score-jc4/ files, which the wrapper overwrites on every run).
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildFrontEnd } = require("../harness/score/score-frontend.js");
const { deriveSquelch } = require("../harness/score/squelch-derive.js");
const { loadRegistry } = require("../harness/tags/schema.js");

const sc = "data/johnson-creek-pass-4-181806.json";
const sidecar = JSON.parse(fs.readFileSync(sc, "utf8"));
const wavBytes = fs.readFileSync(path.join(path.dirname(sc), sidecar.audio.wav_filename));
const front = buildFrontEnd({ wavBytes, audioFirstFrameMs: sidecar.audio_first_frame_ms, gpsSamples: sidecar.gps_samples });
const registry = loadRegistry(path.join(__dirname, "..", "harness", "tags", "registry"));
const { squelch, tags } = deriveSquelch(front, front.samples, front.sr, { registry });

const refSquelch = fs.readFileSync(path.join(".superpowers", "sdd", "task9-ref", "squelch-clean.json"), "utf8");
const refTags = fs.readFileSync(path.join(".superpowers", "sdd", "task9-ref", "tags-clean.json"), "utf8");

assert.strictEqual(JSON.stringify(squelch), refSquelch, "squelch-clean identical");
assert.strictEqual(JSON.stringify(tags), refTags, "tags-clean identical");
console.log("squelch-derive.test.js OK");
