// tests/audio-scoring.test.js
const assert = require("assert");
const { bandEnergiesFromSpectrum, averageWindowEnergies, bandForFrequency, roughnessScore } = require("../recorder/audio-scoring");

const sampleRate = 48000;
const fftSize = 2048;
const binCount = fftSize / 2;
const hzPerBin = sampleRate / fftSize; // ~23.4 Hz

// Build a spectrum that is quiet (-120 dB) everywhere except loud (-10 dB)
// in the mid band [250, 1000).
const spectrum = new Float32Array(binCount).fill(-120);
for (let i = 0; i < binCount; i++) {
  const freq = i * hzPerBin;
  if (freq >= 250 && freq < 1000) {
    spectrum[i] = -10;
  }
}

const energies = bandEnergiesFromSpectrum(spectrum, sampleRate, fftSize);
assert.ok(energies.mid > energies.low, "mid should exceed low");
assert.ok(energies.mid > energies.high, "mid should exceed high");

// A bin centered exactly on 250 Hz belongs to the higher (mid) band.
const edgeBin = Math.round(250 / hzPerBin);
assert.ok(Math.abs(edgeBin * hzPerBin - 250) < hzPerBin, "sanity: edge bin near 250");

// Direct boundary table for bandForFrequency: lower-inclusive, upper-exclusive,
// with an edge frequency belonging to the higher band (e.g. 250 -> mid).
const boundaryCases = [
  [80, "low"],
  [79.9, null],
  [249.999, "low"],
  [250, "mid"],
  [999.999, "mid"],
  [1000, "high"],
  [3999.999, "high"],
  [4000, null]
];
for (const [freq, expected] of boundaryCases) {
  assert.strictEqual(
    bandForFrequency(freq),
    expected,
    `bandForFrequency(${freq}) should be ${expected}`
  );
}

// Averaging two frames returns the per-band mean.
const avg = averageWindowEnergies([
  { low: 2, mid: 4, high: 6 },
  { low: 4, mid: 8, high: 10 }
]);
assert.deepStrictEqual(avg, { low: 3, mid: 6, high: 8 });

// Empty frame list does not divide by zero.
assert.deepStrictEqual(averageWindowEnergies([]), { low: 0, mid: 0, high: 0 });

const baseline = {
  effective_floor: { low: 10, mid: 10, high: 10 }
};

// Energy at baseline -> all deltas 0 -> score 0.
assert.strictEqual(roughnessScore({ low: 10, mid: 10, high: 10 }, baseline), 0);

// Energy below baseline still clamps deltas at 0 -> score 0.
assert.strictEqual(roughnessScore({ low: 1, mid: 1, high: 1 }, baseline), 0);

// Loud low band drives a high score; result stays within [0,100].
const loud = roughnessScore({ low: 1000, mid: 1000, high: 1000 }, baseline);
assert.ok(loud > 0 && loud <= 100, "loud score in range");
assert.strictEqual(loud, 100);

// A silent-baseline floor (1e-6) does not blow the score past 100.
const flooredBaseline = { effective_floor: { low: 1e-6, mid: 1e-6, high: 1e-6 } };
assert.strictEqual(roughnessScore({ low: 5, mid: 5, high: 5 }, flooredBaseline), 100);

console.log("audio-scoring band tests passed");
