// recorder/audio-scoring.js
const { CONSTANTS } = require("./constants");

function bandForFrequency(freq) {
  const { low, mid, high } = CONSTANTS.BANDS;
  if (freq >= low[0] && freq < low[1]) return "low";
  if (freq >= mid[0] && freq < mid[1]) return "mid";
  if (freq >= high[0] && freq < high[1]) return "high";
  return null;
}

function bandEnergiesFromSpectrum(freqDataDb, sampleRate, fftSize) {
  const binCount = Math.floor(fftSize / 2);
  const hzPerBin = sampleRate / fftSize;
  const bands = { low: 0, mid: 0, high: 0 };
  const limit = Math.min(binCount, freqDataDb.length);
  for (let i = 0; i < limit; i++) {
    const band = bandForFrequency(i * hzPerBin);
    if (band) {
      bands[band] += Math.pow(10, freqDataDb[i] / 10); // dB -> linear power
    }
  }
  return bands;
}

function averageWindowEnergies(frameEnergies) {
  if (!frameEnergies.length) {
    return { low: 0, mid: 0, high: 0 };
  }
  const total = frameEnergies.reduce(
    (acc, frame) => ({
      low: acc.low + frame.low,
      mid: acc.mid + frame.mid,
      high: acc.high + frame.high
    }),
    { low: 0, mid: 0, high: 0 }
  );
  const n = frameEnergies.length;
  return { low: total.low / n, mid: total.mid / n, high: total.high / n };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roughnessScoreRaw(windowEnergies, baseline) {
  const floor = baseline.effective_floor;
  const delta = (energy, base) => Math.max(0, energy / base - 1);
  const lowDelta = delta(windowEnergies.low, floor.low);
  const midDelta = delta(windowEnergies.mid, floor.mid);
  const highDelta = delta(windowEnergies.high, floor.high);
  const { low, mid, high } = CONSTANTS.WEIGHTS;
  const raw = low * lowDelta + mid * midDelta + high * highDelta;
  return clamp(raw * CONSTANTS.SCORE_SCALE, 0, 100);
}

function roughnessScore(windowEnergies, baseline) {
  return Math.round(roughnessScoreRaw(windowEnergies, baseline));
}

const exported = { bandEnergiesFromSpectrum, averageWindowEnergies, bandForFrequency, roughnessScore, roughnessScoreRaw };

if (typeof module !== "undefined" && module.exports) {
  module.exports = exported;
}
if (typeof window !== "undefined") {
  window.SensoryNavCore = Object.assign(window.SensoryNavCore || {}, exported);
}
