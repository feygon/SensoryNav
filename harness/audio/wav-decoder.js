// harness/audio/wav-decoder.js
"use strict";

function readAscii(view, offset, length) {
  let s = "";
  for (let i = 0; i < length; i++) {
    s += String.fromCharCode(view.getUint8(offset + i));
  }
  return s;
}

function decodeWav(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.byteLength < 44) {
    throw new Error("unsupported WAV: file shorter than 44-byte header");
  }
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (readAscii(view, 0, 4) !== "RIFF") throw new Error("unsupported WAV: missing RIFF");
  if (readAscii(view, 8, 4) !== "WAVE") throw new Error("unsupported WAV: missing WAVE");
  if (readAscii(view, 12, 4) !== "fmt ") throw new Error("unsupported WAV: missing fmt ");
  if (view.getUint16(20, true) !== 1) throw new Error("unsupported WAV: expected PCM");
  const channels = view.getUint16(22, true);
  if (channels !== 1) throw new Error("unsupported WAV: expected mono");
  const sampleRate = view.getUint32(24, true);
  const bitDepth = view.getUint16(34, true);
  if (bitDepth !== 16) throw new Error("unsupported WAV: expected 16-bit");
  if (readAscii(view, 36, 4) !== "data") throw new Error("unsupported WAV: missing data chunk at offset 36");
  const dataSize = view.getUint32(40, true);
  if (44 + dataSize > u8.byteLength) {
    throw new Error("unsupported WAV: data size exceeds file length (truncated)");
  }
  const sampleCount = Math.floor(dataSize / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const int16 = view.getInt16(44 + i * 2, true);
    samples[i] = int16 < 0 ? int16 / 0x8000 : int16 / 0x7fff;
  }
  return { sampleRate, channels, bitDepth, sampleCount, samples };
}

// Dual-mode: Node (tests, pipeline) via module.exports; browser/worker via self.SensoryNavScore.
{
  const exported = { decodeWav };
  if (typeof module !== "undefined" && module.exports) { module.exports = exported; }
  if (typeof self !== "undefined") { self.SensoryNavScore = Object.assign(self.SensoryNavScore || {}, exported); }
}
