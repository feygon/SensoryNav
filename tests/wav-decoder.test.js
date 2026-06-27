// tests/wav-decoder.test.js
"use strict";
const assert = require("assert");
const { encodeWav } = require("../recorder/wav-encoder");
const { decodeWav } = require("../harness/audio/wav-decoder");

// Round-trip: encode known samples, decode, recover within int16 quantization.
function check(sampleRate) {
  const input = [0, 0.5, -0.5, 1.0, -1.0];
  const wav = encodeWav([Float32Array.from(input)], input.length, sampleRate);
  const decoded = decodeWav(wav);
  assert.strictEqual(decoded.sampleRate, sampleRate);
  assert.strictEqual(decoded.channels, 1);
  assert.strictEqual(decoded.bitDepth, 16);
  assert.strictEqual(decoded.sampleCount, input.length);
  for (let i = 0; i < input.length; i++) {
    assert.ok(Math.abs(decoded.samples[i] - input[i]) < 1e-4,
      `sample ${i}: ${decoded.samples[i]} vs ${input[i]}`);
  }
}
check(48000);
check(44100);

// Malformed headers throw specific messages.
const good = encodeWav([Float32Array.from([0, 0])], 2, 48000);
function corrupt(mutate) {
  const b = good.slice();
  mutate(new DataView(b.buffer), b);
  return b;
}
assert.throws(() => decodeWav(corrupt((v, b) => { b[0] = 0x58; })), /RIFF/);
assert.throws(() => decodeWav(corrupt((v) => v.setUint16(20, 3, true))), /PCM/);
assert.throws(() => decodeWav(corrupt((v) => v.setUint16(22, 2, true))), /mono/);
assert.throws(() => decodeWav(corrupt((v) => v.setUint16(34, 24, true))), /16-bit/);
assert.throws(() => decodeWav(corrupt((v) => v.setUint32(40, 0xffffff, true))), /exceeds|truncated/);
assert.throws(() => decodeWav(new Uint8Array(10)), /header/);

console.log("wav-decoder tests passed");
