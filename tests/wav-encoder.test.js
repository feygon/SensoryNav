// tests/wav-encoder.test.js
const assert = require("assert");
const { encodeWav, floatTo16BitPCM } = require("../recorder/wav-encoder");

// Conversion rule (exact, asymmetric).
assert.strictEqual(floatTo16BitPCM(1.0), 32767);
assert.strictEqual(floatTo16BitPCM(-1.0), -32768);
assert.strictEqual(floatTo16BitPCM(0.5), 16384);
assert.strictEqual(floatTo16BitPCM(-0.5), -16384);
assert.strictEqual(floatTo16BitPCM(0), 0);
assert.strictEqual(floatTo16BitPCM(1.5), 32767);   // clamp
assert.strictEqual(floatTo16BitPCM(-1.5), -32768); // clamp

function check(sampleRate) {
  const frames = [Float32Array.from([0, 0.5]), Float32Array.from([-0.5, -1.0])];
  const totalSamples = 4;
  const wav = encodeWav(frames, totalSamples, sampleRate);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (off) => String.fromCharCode(wav[off], wav[off + 1], wav[off + 2], wav[off + 3]);
  const dataSize = totalSamples * 2;

  assert.strictEqual(ascii(0), "RIFF");
  assert.strictEqual(view.getUint32(4, true), 36 + dataSize); // ChunkSize
  assert.strictEqual(ascii(8), "WAVE");
  assert.strictEqual(ascii(12), "fmt ");
  assert.strictEqual(view.getUint32(16, true), 16);           // Subchunk1Size
  assert.strictEqual(view.getUint16(20, true), 1);            // AudioFormat PCM
  assert.strictEqual(view.getUint16(22, true), 1);            // NumChannels
  assert.strictEqual(view.getUint32(24, true), sampleRate);   // SampleRate
  assert.strictEqual(view.getUint32(28, true), sampleRate * 2); // ByteRate
  assert.strictEqual(view.getUint16(32, true), 2);            // BlockAlign
  assert.strictEqual(view.getUint16(34, true), 16);           // BitsPerSample
  assert.strictEqual(ascii(36), "data");
  assert.strictEqual(view.getUint32(40, true), dataSize);     // Subchunk2Size
  assert.strictEqual(wav.byteLength, 44 + dataSize);
  // Payload values (LE int16) for samples [0, 0.5, -0.5, -1.0].
  assert.strictEqual(view.getInt16(44, true), 0);
  assert.strictEqual(view.getInt16(46, true), 16384);
  assert.strictEqual(view.getInt16(48, true), -16384);
  assert.strictEqual(view.getInt16(50, true), -32768);
}
check(48000);
check(44100); // parametrized over sample rates

console.log("wav-encoder tests passed");
