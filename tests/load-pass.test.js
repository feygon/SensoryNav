// tests/load-pass.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { encodeWav } = require("../recorder/wav-encoder");
const { loadPass } = require("../harness/audio/load-pass");

// Mismatch warning: sidecar sample_rate disagrees with the WAV header.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp1-"));
try {
  const wavBytes = encodeWav([new Float32Array(4096)], 4096, 48000);
  const wp = path.join(dir, "p.wav");
  const sp = path.join(dir, "p.json");
  fs.writeFileSync(wp, Buffer.from(wavBytes));
  fs.writeFileSync(sp, JSON.stringify({ sample_rate: 44100, audio_first_frame_ms: 5000 }));
  const res = loadPass(wp, sp);
  assert.ok(res.warnings.length > 0, "expected a sample_rate mismatch warning");
  assert.ok(res.warnings[0].includes("mismatch"));
  assert.strictEqual(res.sampleRate, 48000); // trusts the WAV
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Mechanics smoke test on the real captured pass: exactly 25 windows, no warnings.
const realWav = path.join(__dirname, "..", "data", "johnson-creek-pass-1-163508.wav");
const realJson = path.join(__dirname, "..", "data", "johnson-creek-pass-1-163508.json");
const real = loadPass(realWav, realJson);
assert.strictEqual(real.windows.length, 25);
assert.strictEqual(real.warnings.length, 0);
for (let i = 0; i < real.windows.length; i++) {
  assert.strictEqual(real.windows[i].window_id, "w" + i);
  assert.ok(Number.isFinite(real.windows[i].rms));
  assert.ok(Number.isFinite(real.windows[i].low_energy));
  if (i > 0) {
    assert.ok(real.windows[i].started_at_ms > real.windows[i - 1].started_at_ms);
  }
}

console.log("load-pass tests passed");
